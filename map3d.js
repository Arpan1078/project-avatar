/* =====================================================================
   map3d.js: the 3D map for the Firewatch dashboard (CesiumJS + Cesium ion)

   How it fits together:
   - index.html calls Map3D.init(...) once. That creates ONE Cesium viewer
     and every map object (fires, homes, water, roads, wind...).
   - Every time the dashboard state changes, index.html calls
     Map3D.update(mapState) with a description of what the map should show
     for the current scenario and step (see "MAP STATE" below). That only
     changes existing objects (positions, sizes, show/hide). Nothing is rebuilt.
   - Map3D.resetView() flies the camera back to the scenario's starting view.

   MAP STATE (built in index.html, one per scenario step):
     {
       layers:      { spread, houses, water, stations, power, burns, risk, wind }  chip on/off
       view:        'district' | 'burn'          which CAMERAS preset to use
       wind:        { towardDeg, mph }           direction the wind blows TO, speed
       fires: {
         A: { place, acres, cones, card } | null    fire with forecast cones
         B: { place, acres, card } | null           a second fire (e.g. the planned burn)
       }
         place = a key of PLACES; card = { tone: 'orange'|'cream', title, sub }
         (sub 'lineDistance' = live distance of the fire head from the power line)
       firebreak, reporter, route, lineFault, burnArea:  true/false
       homesInPath: a key of HOME_GROUPS or null (those homes turn orange)
       homesCard:   { group, title, sub } | null
       goes:        GOES detections from satellite.js (drawn as ~2 km squares)
       firms:       FIRMS VIIRS hotspots from satellite.js (drawn as ~375 m squares + ring)
     }

   HOW TO MOVE THINGS
   Every feature is placed in MILES EAST and MILES NORTH of the Cottonwood
   Creek fire start, written as [east, north]. Negative east = west,
   negative north = south.
   - To move the whole district somewhere else, change ORIGIN only.
   - To move one feature, change its [east, north] pair in section 2.
   Fire shapes and the firebreak are built in the WIND FRAME: "along" =
   miles downwind of the fire's start point, "across" = miles to the right.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Anchor point and unit conversion ---------- */

  // The Cottonwood Creek fire start (where the power line drops into the grass).
  // Real terrain: Red Hills / Gyp Hills, western Barber County, Kansas.
  // Creek valleys here sit around 520 m with ridges at 560 to 600 m.
  const ORIGIN = { lat: 37.200, lon: -98.985 };

  const METERS_PER_MILE = 1609.344;
  const METERS_PER_DEG_LAT = 111320;

  // [east, north] in miles  ->  [lon, lat] in degrees.
  // A flat approximation; accurate to well under 1% over a 25-mile district.
  function lonLat(p) {
    const lat = ORIGIN.lat + (p[1] * METERS_PER_MILE) / METERS_PER_DEG_LAT;
    const lon = ORIGIN.lon + (p[0] * METERS_PER_MILE) /
      (METERS_PER_DEG_LAT * Math.cos(ORIGIN.lat * Math.PI / 180));
    return [lon, lat];
  }
  // [east, north] in miles -> Cesium position (height 0; entities are
  // clamped to the terrain, so the height is ignored).
  function pos(p) {
    const [lon, lat] = lonLat(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat);
  }
  const posList = list => list.map(pos);


  /* ---------- 2. Map features (all in miles [east, north] of the fire start) ---------- */

  // District boundary, roughly 24 x 19 mi, so about 450 sq mi.
  const DISTRICT_CORNERS = [[-10.0, 8.2], [14.0, 8.6], [14.3, -10.9], [-9.8, -10.5]];

  // Oil-lease power line, running WSW to ENE through the fire start.
  const POWER_LINE = {
    from: [-9.6, -0.96],
    to:   [13.8,  1.38],
    poleEveryMi: 1,          // one pole marker per mile
    riskHalfWidthMi: 0.55    // "Fire risk today" band, each side of the line
  };

  // Fire station: 11 mi straight-line SE of the fire start,
  // so the fire start is 11 mi NW of the station (7.78 = 11 / sqrt 2).
  const STATION = [7.78, -7.78];
  const MUTUAL_AID = [-9.3, -5.6];   // neighboring department, near the west edge

  // Gravel route from the station to the back of the fire (shown from 2:04).
  // Winds NW along ridge and creek roads. About 12 road miles.
  const ROUTE = [
    STATION, [6.80, -7.78], [6.55, -7.20], [6.10, -6.70], [5.70, -6.05],
    [5.05, -5.40], [4.45, -4.70], [3.95, -4.20], [3.50, -3.60], [3.50, -2.00],
    [2.80, -1.75], [2.10, -1.40], [1.40, -1.10], [0.80, -0.90], [0.40, -0.55],
    [0.15, -0.20]
  ];

  // Homes. HOME_GROUPS below says which ones turn orange ("in the path").
  const HOMES = [
    [0.48, 2.45],     // 0  \
    [0.95, 2.02],     // 1   > 3 homes ~2.2 to 2.5 mi downwind (NNE) of the
    [0.62, 2.20],     // 2  /  Cottonwood Creek fire start (1 = the rancher)
    [5.80, -1.60],    // 3
    [-5.60, 0.40],    // 4
    [10.50, 4.00],    // 5
    [-7.60, 4.60],    // 6
    [5.90, -4.40],    // 7  \  2 homes ~1.2 and ~1.6 mi NE (downwind) of the
    [6.20, -4.15]     // 8  /  planned-burn escape
  ];
  const HOME_GROUPS = { fire: [0, 1, 2], escape: [7, 8] };

  // Water sources.
  const STOCK_POND = { at: [-0.55, 1.15], semiMajorM: 130, semiMinorM: 85 };
  const TANK = [-2.4, 0.75];
  const WATER_TRUCK = [1.5, -0.3];

  // Neighbor who sends the photo at 1:59. A dashed line runs to the fire.
  const REPORTER = [3.1, 0.55];

  // Permitted burns from the weekend (both out).
  const BURNS = [
    { at: [6.6, -3.4],  radiusMi: 0.45, label: 'Permitted burn, Sat (out)' },
    { at: [-4.4, -3.6], radiusMi: 0.35, label: 'Permitted burn, Sun (out)' }
  ];

  // "Planned burn" scenario: the registered burn area. A half-mile square
  // (160 acres) of pasture about 4 mi NW of the fire station, just SW of the
  // gravel road, so an escape to the NE "jumps the road".
  const SECTION_22 = {
    center: [4.6, -5.6],
    halfMi: 0.25,                          // 0.5 mi x 0.5 mi = 160 acres
    label: 'Registered burn: Section 22, 10:00 am to 2:00 pm'
  };

  // Where each fire starts (a fire grows downwind from its start point).
  const PLACES = {
    line:   [0, 0],                                                        // Cottonwood Creek fire
    burn:   [SECTION_22.center[0] - 0.18, SECTION_22.center[1] - 0.18],     // lit in the SW of Section 22
    escape: [SECTION_22.center[0] + 0.42, SECTION_22.center[1] + 0.42]      // 0.6 mi NE of the section center, across the road
  };

  // Wind (defaults; each scenario sets its own direction and speed).
  // The fire shapes, forecast cones, streaks and compass all follow the
  // direction set here, so they always agree.
  const WIND = {
    towardDeg: 20,           // direction the wind blows TO (clockwise from north)
    referenceMph: 35,        // streaks move at speedMiPerSec at this wind speed
    // Streak animation (miles and seconds). Map speed is sped up so motion is
    // visible at district scale: a streak crosses the district in ~50 s at 35 mph.
    speedMiPerSec: 0.45,
    spacingAcrossMi: 1.5,    // streak grid spacing across the wind...
    spacingAlongMi: 2.1,     // ...and along it (each streak is jittered randomly)
    lengthMi: 0.7,
    width: 2,
    alpha: 0.4,              // peak opacity at the head; keep low so the fire and labels stay in front
    liftM: 35,               // height above the terrain
    // Gusts: every 5 to 10 s a cluster of faster, brighter streaks fades in and out.
    gustCount: 26, gustSpeedFactor: 1.9, gustLengthMi: 1.1, gustWidth: 2.5,
    gustAlpha: 0.75, gustSeconds: 2.6, gustEveryMin: 5, gustEveryMax: 10, gustRadiusMi: 3.5
  };

  // Fire shape. The fire is stretched downwind: its back stays at its start
  // point, its head runs with the wind. Bigger fires get more stretched.
  // At 600 acres it is about 1.6 mi long and 0.7 mi wide.
  const FIRE = {
    minAcres: 0.5,      // so a just-started fire is still visible
    ratioSmall: 1.8,    // length / width of a tiny fire
    ratioLarge: 2.2,    // length / width at 600 acres and up
    tailFraction: 0.1,  // how far the fire backs up behind its start (share of half-length)
    headBulge: 0.22,    // >0 makes the head wider and the back narrower (teardrop)
    points: 140,        // perimeter points
    noiseSeed: 11,      // change for a differently shaped (but still stable) perimeter
    growSeconds: 0.8,   // how long a fire takes to grow to the next step's size
    embers: 110,        // max glowing ember dots inside a burned area
    smokePuffs: 36      // smoke billboards drifting downwind from a head
  };

  // Fire path forecast cones. They start at the HEAD of fire A and point
  // downwind. The facts panel says the head moves 2 to 3 mph, so ~1.25 mi per 30 min.
  // widen/extraMi: half-width at the far edge = fire half-width * widen + extraMi.
  const CONES = [
    { key: 'c60', label: 'in 60 min', aheadMi: 2.5,  widen: 2.4, extraMi: 0.6, fill: 0.08, edge: 0.45, z: 2 },
    { key: 'c30', label: 'in 30 min', aheadMi: 1.25, widen: 1.6, extraMi: 0.3, fill: 0.14, edge: 0.7,  z: 3 }
  ];

  // Firebreak the rancher discs (Cottonwood Creek fire, from 1:59). WIND FRAME:
  // it runs across the fire's path, perpendicular to the wind, between the fire
  // head (~1.5 mi downwind at 2:22) and the 3 homes (~2.2 to 2.5 mi downwind).
  const FIREBREAK_WIND = { alongMi: 1.85, halfLengthMi: 0.75, wobbleMi: 0.025 };

  // Starting cameras, looking downwind, tilted 45 degrees down.
  //   district: the fire, the station and the area the fire spreads into
  //             (fits on a 1440 x 900 screen in Simple and Full view).
  //   burn:     closer view of Section 22, the escape and the homes downwind.
  const CAMERAS = {
    district: { target: [3.5, -2.8], headingDeg: 20, pitchDeg: -45, rangeM: 32000 },
    burn:     { target: [5.1, -5.6], headingDeg: 30, pitchDeg: -45, rangeM: 12500 }
  };

  // Scene look.
  const LOOK = {
    // Used ONLY to place the sun for terrain shading (a low afternoon sun
    // brings out the hills). It is not the scenario clock.
    sunTimeUtc: '2026-03-12T21:30:00Z',
    // Raise to 1.5 or 2 to make the hills taller. Leave at 1 if fire shapes
    // or lines look clipped on ridges.
    verticalExaggeration: 1.0,
    imageryBrightness: 0.55,
    imageryContrast: 1.15,
    imagerySaturation: 0.7
  };

  // Small text labels are hidden when the camera is farther than this from them.
  const SMALL_LABEL_MAX_DISTANCE_M = 48000;


  /* ---------- 3. Colors ---------- */

  const HEX = {
    fire: '#F26B2E', fireSoft: '#F2A65A', fireEdge: '#FF4A1C', ember: '#FF8A3D',
    cream: '#EDE3CF', muted: '#A89C88',
    water: '#6EA8D6', waterText: '#9CC4E4', brk: '#E8B04A', power: '#C9B98F',
    burn: '#6E665C', bg: '#15120F'
  };
  const col = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
  // GOES pixel color by fire mask: low = yellow, medium = amber, high = orange,
  // processed / saturated = red (cloud-contaminated = muted amber).
  const GOES_MASK_COLOR = { 15: '#F2D13A', 14: '#F2A93A', 13: '#F26B2E', 10: '#E0352B', 11: '#E0352B', 12: '#B9A27A' };
  const NO_TOKEN_TITLE = 'Add your Cesium ion token to config.js';


  /* ---------- 4. Geometry helpers ---------- */

  const rad = d => d * Math.PI / 180;

  // Current wind direction (sin/cos of the bearing the wind blows toward).
  let SIN_B = 0, COS_B = 1;
  function setBearing(deg) {
    WIND.towardDeg = deg;
    SIN_B = Math.sin(rad(deg));
    COS_B = Math.cos(rad(deg));
  }
  setBearing(WIND.towardDeg);

  // Wind frame -> [east, north]. along = miles downwind, across = miles to
  // the right of the wind. Optional origin offsets the result.
  function fireFrame(along, across, origin) {
    const e = along * SIN_B + across * COS_B, n = along * COS_B - across * SIN_B;
    return origin ? [origin[0] + e, origin[1] + n] : [e, n];
  }
  // [east, north] -> wind frame [along, across].
  const toWindFrame = p => [p[0] * SIN_B + p[1] * COS_B, p[0] * COS_B - p[1] * SIN_B];

  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const closed = pts => pts.concat([pts[0]]);
  const centerOf = pts => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

  function circle(center, rMi, n = 48) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n;
      pts.push([center[0] + rMi * Math.cos(th), center[1] + rMi * Math.sin(th)]);
    }
    return pts;
  }

  // Small seeded random generator, so "random" shapes are the same every load.
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Perimeter "bumpiness": a fixed sum of sine waves around the fire.
  // Fixed per angle, so the outline keeps its shape and just grows each step.
  const PERIMETER_NOISE = (() => {
    const rnd = seeded(FIRE.noiseSeed), waves = [];
    for (let k = 3; k <= 11; k++) waves.push({ k, amp: (0.1 / Math.pow(k, 0.8)) * (0.6 + 0.8 * rnd()), ph: rnd() * 6.283 });
    for (let k = 17; k <= 29; k += 3) waves.push({ k, amp: 0.012 * (0.5 + rnd()), ph: rnd() * 6.283 });
    return waves;
  })();
  function bump(th) {
    let m = 1;
    for (const w of PERIMETER_NOISE) m += w.amp * Math.sin(w.k * th + w.ph);
    return m;
  }
  const BUMP = Array.from({ length: FIRE.points }, (_, i) => bump((2 * Math.PI * i) / FIRE.points));

  // Fire size from acres. a = half-length, b = half-width, c = center
  // distance downwind of the start (all miles).
  function fireSize(acres) {
    const ac = Math.max(parseFloat(acres) || 0, FIRE.minAcres);
    const t = Math.min(1, Math.max(0, Math.log(ac / FIRE.minAcres) / Math.log(600 / FIRE.minAcres)));
    const ratio = FIRE.ratioSmall + (FIRE.ratioLarge - FIRE.ratioSmall) * t;
    const a = Math.sqrt((ac / 640) * ratio / Math.PI);   // 640 acres per sq mi
    return { a, b: a / ratio, c: a * (1 - FIRE.tailFraction), acres: ac };
  }

  // A point of the fire shape in the wind frame. th = angle (0 = head),
  // r = 1 on the perimeter, 0 at the center.
  function fireLocal(s, th, r, m) {
    const ct = Math.cos(th);
    return [s.c + s.a * ct * m * r, s.b * Math.sin(th) * (1 + FIRE.headBulge * ct) * m * r];
  }

  // Full fire geometry for a size and start point: outline, head point, center.
  function fireGeometry(s, origin) {
    const local = [];
    let head = [-1e9, 0];
    for (let i = 0; i < FIRE.points; i++) {
      const p = fireLocal(s, (2 * Math.PI * i) / FIRE.points, 1, BUMP[i]);
      local.push(p);
      if (p[0] > head[0]) head = p;
    }
    return {
      s, origin,
      outline: local.map(p => fireFrame(p[0], p[1], origin)),
      headW: head,                                 // head in the wind frame [along, across]
      head: fireFrame(head[0], head[1], origin),   // head in [east, north]
      center: fireFrame(s.c, 0, origin)
    };
  }

  // Forecast cone from the fire head out to a curved front edge.
  function coneGeometry(g, cone) {
    const [h0, hc] = g.headW, o = g.origin;
    const base = Math.max(g.s.b * 0.5, 0.04);
    const far = h0 + cone.aheadMi;
    const hw = g.s.b * cone.widen + cone.extraMi;
    const front = [];
    for (let j = 0; j <= 12; j++) {
      const u = -1 + j / 6;                       // -1 .. 1 across the front
      front.push(fireFrame(far - 0.25 * hw * u * u, hc + hw * u, o));
    }
    const left = fireFrame(h0, hc - base, o), right = fireFrame(h0, hc + base, o);
    return {
      fill: [left].concat(front, [right]),
      edge: [left].concat(front, [right]),   // open: no line across the fire head
      tip: fireFrame(far + 0.08, hc, o)      // label spot just past the outer edge
    };
  }

  // Perpendicular distance (miles) from a point to the power line.
  function distanceToPowerLine(p) {
    const [x1, y1] = POWER_LINE.from, [x2, y2] = POWER_LINE.to;
    return Math.abs((x2 - x1) * (y1 - p[1]) - (x1 - p[0]) * (y2 - y1)) / Math.hypot(x2 - x1, y2 - y1);
  }

  function insideDistrict(p) {
    let inside = false;
    const c = DISTRICT_CORNERS;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      if ((c[i][1] > p[1]) !== (c[j][1] > p[1]) &&
          p[0] < ((c[j][0] - c[i][0]) * (p[1] - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) inside = !inside;
    }
    return inside;
  }

  // Firebreak points for the current wind direction (in front of the line fire).
  function firebreakPoints() {
    const f = FIREBREAK_WIND, pts = [];
    for (let i = 0; i <= 8; i++) {
      pts.push(fireFrame(f.alongMi + f.wobbleMi * Math.sin(i * 1.7), -f.halfLengthMi + (2 * f.halfLengthMi * i) / 8, PLACES.line));
    }
    return pts;
  }

  const SECTION_22_CORNERS = (() => {
    const [x, y] = SECTION_22.center, h = SECTION_22.halfMi;
    return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
  })();


  /* ---------- 5. Marker icons and textures (drawn on canvas) ---------- */

  function canvas(w, h, draw, scale = 2) {
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    g.scale(scale, scale);
    draw(g);
    return c;
  }
  const squareIcon = (size, fill, stroke, lw) => canvas(size + lw * 2, size + lw * 2, g => {
    if (fill) { g.fillStyle = fill; g.fillRect(lw, lw, size, size); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(lw, lw, size, size); }
  });
  const ringIcon = (r, stroke, lw) => canvas(r * 2 + lw * 2, r * 2 + lw * 2, g => {
    g.strokeStyle = stroke; g.lineWidth = lw;
    g.beginPath(); g.arc(r + lw, r + lw, r, 0, Math.PI * 2); g.stroke();
  });
  const rectIcon = (w, h, fill, stroke) => canvas(w + 2, h + 2, g => {
    g.fillStyle = fill; g.fillRect(1, 1, w, h);
    g.strokeStyle = stroke; g.lineWidth = 1; g.strokeRect(1, 1, w, h);
  });

  // Burned-area fill: dark char with soft gray smoke mottling and a few faint red specks.
  function smokyTexture() {
    const rnd = seeded(5);
    return canvas(256, 256, g => {
      g.fillStyle = 'rgba(14, 11, 9, 0.93)';
      g.fillRect(0, 0, 256, 256);
      const blob = (x, y, r, rgba) => {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (let i = 0; i < 70; i++) blob(rnd() * 256, rnd() * 256, 12 + rnd() * 40, `rgba(96, 88, 80, ${0.05 + rnd() * 0.12})`);
      for (let i = 0; i < 30; i++) blob(rnd() * 256, rnd() * 256, 6 + rnd() * 18, `rgba(0, 0, 0, ${0.2 + rnd() * 0.3})`);
      for (let i = 0; i < 40; i++) blob(rnd() * 256, rnd() * 256, 1.5 + rnd() * 3, `rgba(255, 90, 40, ${0.08 + rnd() * 0.15})`);
    }, 1);
  }

  // Soft round smoke puff.
  function smokePuffTexture() {
    const rnd = seeded(9);
    return canvas(128, 128, g => {
      for (let i = 0; i < 14; i++) {
        const x = 64 + (rnd() - 0.5) * 50, y = 64 + (rnd() - 0.5) * 50, r = 26 + rnd() * 30;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      }
    }, 1);
  }


  /* ---------- 6. Viewer, terrain heights and entities ---------- */

  let viewer = null;
  let ready = false;
  let pending = null;       // last update() call made before the viewer was ready
  let cur = null;           // last applied map state
  let curView = null;
  let targetHeightM = 550;  // replaced by a terrain sample at startup
  let msgEl = null;
  let compassEl = null;     // wind compass card (HTML, over the map)
  let mapRoot = null;       // the .map element (for HTML labels)

  const layers = {};        // parent entity per "Show on map" chip
  const E = {};             // entities that change with the scenario or step
  const slots = {};         // fire slots A and B (see section 7)

  function add(opts) { return viewer.entities.add(opts); }

  // Tiny placeholder shape for entities whose real geometry is set later.
  const PLACEHOLDER = [[0, 0], [0.01, 0], [0, 0.01]];

  // Shared settings for markers pinned to the ground and drawn over hills.
  const ON_GROUND = () => ({
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  });
  function billboard(image) {
    return Object.assign(ON_GROUND(), { image, scale: 0.5 });
  }
  function groundLine(points, color, width, dash, z = 0) {
    return {
      positions: posList(points),
      clampToGround: true,
      width,
      zIndex: z,
      material: dash
        ? new Cesium.PolylineDashMaterialProperty({ color, gapColor: Cesium.Color.TRANSPARENT, dashLength: dash.length, dashPattern: dash.pattern ?? 255 })
        : color
    };
  }

  // Terrain heights on a 0.5-mile grid over the district, sampled once.
  // Wind streaks, embers and smoke read heights from this grid (cheap).
  const HGRID = { e0: -10.5, n0: -11.5, step: 0.5, cols: 51, rows: 42 };
  let heights = null;
  async function sampleHeights(terrainProvider) {
    const pts = [];
    for (let r = 0; r < HGRID.rows; r++) for (let c = 0; c < HGRID.cols; c++) {
      const [lon, lat] = lonLat([HGRID.e0 + c * HGRID.step, HGRID.n0 + r * HGRID.step]);
      pts.push(Cesium.Cartographic.fromDegrees(lon, lat));
    }
    let out = null;
    try { out = await Cesium.sampleTerrainMostDetailed(terrainProvider, pts); }
    catch (e) {
      try { out = await Cesium.sampleTerrain(terrainProvider, 11, pts); } catch (e2) { /* keep flat */ }
    }
    if (out) {
      heights = Float32Array.from(out, q => (Number.isFinite(q.height) ? q.height : targetHeightM));
      for (const id in slots) slots[id].emberA = NaN;   // re-seat embers on the real terrain
    }
  }
  function heightAt(e, n) {
    if (!heights) return targetHeightM;
    const x = Math.min(Math.max((e - HGRID.e0) / HGRID.step, 0), HGRID.cols - 1.001);
    const y = Math.min(Math.max((n - HGRID.n0) / HGRID.step, 0), HGRID.rows - 1.001);
    const c = Math.floor(x), r = Math.floor(y), fx_ = x - c, fy = y - r, i = r * HGRID.cols + c;
    return (heights[i] * (1 - fx_) + heights[i + 1] * fx_) * (1 - fy) +
           (heights[i + HGRID.cols] * (1 - fx_) + heights[i + HGRID.cols + 1] * fx_) * fy;
  }
  // [east, north] -> Cesium position `liftM` meters above the (grid) terrain.
  function airPos(p, liftM, result) {
    const [lon, lat] = lonLat(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat, heightAt(p[0], p[1]) * LOOK.verticalExaggeration + liftM, undefined, result);
  }

  function buildEntities() {
    // Parent entity per chip: hiding the parent hides all its children.
    for (const key of ['spread', 'houses', 'water', 'stations', 'power', 'burns', 'risk', 'sat']) {
      layers[key] = add({ id: 'layer-' + key });
    }
    // Groups switched by the scenario / step, not by a chip.
    E.breakGroup = add({ id: 'step-firebreak' });
    E.reporterGroup = add({ id: 'step-reporter' });
    E.burnAreaGroup = add({ id: 'burn-area', parent: layers.burns });

    // --- District boundary (always on) ---
    add({ polyline: groundLine(closed(DISTRICT_CORNERS), col(HEX.cream, 0.55), 2, { length: 16 }) });

    // --- Fire risk today: band along the power line ---
    const dx = POWER_LINE.to[0] - POWER_LINE.from[0], dy = POWER_LINE.to[1] - POWER_LINE.from[1];
    const len = Math.hypot(dx, dy);
    const nx = (-dy / len) * POWER_LINE.riskHalfWidthMi, ny = (dx / len) * POWER_LINE.riskHalfWidthMi;
    const north = [[POWER_LINE.from[0] + nx, POWER_LINE.from[1] + ny], [POWER_LINE.to[0] + nx, POWER_LINE.to[1] + ny]];
    const south = [[POWER_LINE.from[0] - nx, POWER_LINE.from[1] - ny], [POWER_LINE.to[0] - nx, POWER_LINE.to[1] - ny]];
    add({ parent: layers.risk, polygon: { hierarchy: posList([north[0], north[1], south[1], south[0]]), material: col(HEX.brk, 0.13), zIndex: 0 } });
    add({ parent: layers.risk, polyline: groundLine(north, col(HEX.brk, 0.4), 1.5, { length: 8 }) });
    add({ parent: layers.risk, polyline: groundLine(south, col(HEX.brk, 0.4), 1.5, { length: 8 }) });
    E.riskLabelAt = lerp(south[0], south[1], 0.72);

    // --- Permitted burns ---
    for (const b of BURNS) {
      add({ parent: layers.burns, position: pos(b.at), ellipse: { semiMajorAxis: b.radiusMi * METERS_PER_MILE, semiMinorAxis: b.radiusMi * METERS_PER_MILE, material: col(HEX.burn, 0.35), zIndex: 1 } });
      add({ parent: layers.burns, polyline: groundLine(closed(circle(b.at, b.radiusMi)), col(HEX.muted), 1.5, { length: 8 }) });
    }
    // Registered burn area (Planned burn scenario): gray dashed square.
    add({ parent: E.burnAreaGroup, polygon: { hierarchy: posList(SECTION_22_CORNERS), material: col(HEX.burn, 0.22), zIndex: 1 } });
    add({ parent: E.burnAreaGroup, polyline: groundLine(closed(SECTION_22_CORNERS), col('#C9C2B6'), 2, { length: 10 }, 1) });

    // --- Power line with pole markers ---
    add({ parent: layers.power, polyline: groundLine([POWER_LINE.from, POWER_LINE.to], col(HEX.power), 2) });
    const poles = Math.floor(len / POWER_LINE.poleEveryMi);
    for (let i = 1; i < poles; i++) {
      add({ parent: layers.power, position: pos(lerp(POWER_LINE.from, POWER_LINE.to, (i * POWER_LINE.poleEveryMi) / len)),
        point: Object.assign(ON_GROUND(), { pixelSize: 5, color: col(HEX.power), outlineColor: col(HEX.bg), outlineWidth: 1 }) });
    }

    // --- Fire stations and route ---
    add({ parent: layers.stations, position: pos(STATION), billboard: billboard(squareIcon(18, HEX.cream, null, 1)) });
    add({ parent: layers.stations, position: pos(MUTUAL_AID), billboard: billboard(squareIcon(12, null, HEX.cream, 1.5)) });
    E.route = add({ parent: layers.stations, polyline: groundLine(ROUTE, col(HEX.cream, 0.95), 3, { length: 12, pattern: 0xF0F0 }, 2) });

    // --- Homes (orange when in the path, see HOME_GROUPS) ---
    E.homeIcons = { path: squareIcon(9, HEX.fireSoft, HEX.fire, 1.5), safe: squareIcon(9, HEX.cream, HEX.cream, 1.5) };
    E.homes = HOMES.map(h => add({ parent: layers.houses, position: pos(h), billboard: billboard(E.homeIcons.safe) }));
    E.homesPath = undefined;

    // --- Firebreak (Cottonwood Creek fire), across the wind ahead of the fire ---
    E.firebreak = add({ parent: E.breakGroup, polyline: groundLine(firebreakPoints(), col(HEX.brk), 4, { length: 18, pattern: 0xFFF0 }, 3) });

    // --- Water ---
    add({ parent: layers.water, position: pos(STOCK_POND.at), ellipse: { semiMajorAxis: STOCK_POND.semiMajorM, semiMinorAxis: STOCK_POND.semiMinorM, material: col(HEX.water, 0.8), zIndex: 7 } });
    add({ parent: layers.water, position: pos(WATER_TRUCK), billboard: billboard(rectIcon(16, 9, HEX.water, HEX.waterText)) });
    add({ parent: layers.water, position: pos(TANK), billboard: billboard(ringIcon(6, HEX.water, 2)) });

    // --- Neighbor photo report (Cottonwood Creek fire, from 1:59) ---
    E.reporterLine = add({ parent: E.reporterGroup, polyline: groundLine([REPORTER, [0, 0]], col(HEX.cream, 0.85), 1.5, { length: 8 }, 4) });
    add({ parent: E.reporterGroup, position: pos(REPORTER), point: Object.assign(ON_GROUND(), { pixelSize: 11, color: col(HEX.cream), outlineColor: col(HEX.bg), outlineWidth: 1 }) });

    // --- Satellite detections: fixed pools, filled from the map state ---
    // GOES: big translucent squares (coarse, ~2 km). FIRMS VIIRS: small bright
    // squares (~375 m) with a white ring, so they read as sharper and more precise.
    E.goes = [];
    for (let i = 0; i < 8; i++) {
      E.goes.push({
        fill: add({ parent: layers.sat, show: false, polygon: { hierarchy: posList(PLACEHOLDER), material: col(HEX.fire, 0.2), zIndex: 1 } }),
        edge: add({ parent: layers.sat, show: false, polyline: { positions: posList(PLACEHOLDER), clampToGround: true, width: 1.5, zIndex: 5, material: col(HEX.fire, 0.95) } }),
        key: ''
      });
    }
    E.firms = [];
    for (let i = 0; i < 6; i++) {
      E.firms.push({
        fill: add({ parent: layers.sat, show: false, polygon: { hierarchy: posList(PLACEHOLDER), material: col('#FFE08A', 0.9), zIndex: 9 } }),
        dot: add({ parent: layers.sat, show: false, position: pos([0, 0]),
          point: Object.assign(ON_GROUND(), { pixelSize: 7, color: col('#FFD23F'), outlineColor: col('#FFFFFF'), outlineWidth: 2 }) }),
        key: ''
      });
    }

    // --- Where the power line came down / tripped ---
    E.faultDot = add({ position: pos(PLACES.line), point: Object.assign(ON_GROUND(), { pixelSize: 6, color: col(HEX.fireSoft), outlineColor: col(HEX.bg), outlineWidth: 1 }) });
  }

  function applyState(u) {
    cur = u;
    for (const key in layers) layers[key].show = !!u.layers[key];
    setWindVisible(u.layers.wind !== false);

    // Wind direction and speed. A new direction re-shapes fires, cones and the firebreak.
    if (u.wind && u.wind.towardDeg !== WIND.towardDeg) {
      setBearing(u.wind.towardDeg);
      wind.domain = windDomain();
      E.firebreak.polyline.positions = posList(firebreakPoints());
      for (const id in slots) slots[id].reshape = true;
      wind.lastHeading = NaN;
    }
    if (u.wind) wind.speedFactor = u.wind.mph / WIND.referenceMph;

    setFire(slots.A, u.fires.A);
    setFire(slots.B, u.fires.B);

    E.breakGroup.show = !!u.firebreak;
    E.reporterGroup.show = !!u.reporter;
    E.route.show = !!u.route;
    E.faultDot.show = !!u.lineFault;
    E.burnAreaGroup.show = !!u.burnArea;

    if (u.homesInPath !== E.homesPath) {
      E.homesPath = u.homesInPath;
      const inPath = new Set(HOME_GROUPS[u.homesInPath] || []);
      E.homes.forEach((h, i) => { h.billboard.image = inPath.has(i) ? E.homeIcons.path : E.homeIcons.safe; });
    }

    setSatellite(u.goes || [], u.firms || []);

    if (u.view !== curView) {
      const first = curView === null;
      curView = u.view;
      resetView(first ? 0 : 1.5);
    }
  }


  /* ---------- 6b. Satellite detections (GOES pixels, FIRMS hotspots) ---------- */

  // Square of `sizeM` meters centered on a lat/lon, as Cesium positions.
  function squareAround(lat, lon, sizeM) {
    const dLat = sizeM / 2 / METERS_PER_DEG_LAT;
    const dLon = sizeM / 2 / (METERS_PER_DEG_LAT * Math.cos(lat * Math.PI / 180));
    return Cesium.Cartesian3.fromDegreesArray([lon - dLon, lat - dLat, lon + dLon, lat - dLat, lon + dLon, lat + dLat, lon - dLon, lat + dLat]);
  }
  const describe = o => (window.Satellite ? window.Satellite.describe(o) : '');
  const goesSizeM = () => (window.Satellite ? window.Satellite.GOES_PIXEL_M : 2000);
  const viirsSizeM = () => (window.Satellite ? window.Satellite.VIIRS_PIXEL_M : 375);

  function setSatellite(goes, firms) {
    satInfo.goes = goes;     // remembered for the hover / click hit test
    satInfo.firms = firms;
    E.goes.forEach((g, i) => {
      const d = goes[i];
      g.fill.show = g.edge.show = !!d;
      if (!d) return;
      const key = [d.latitude, d.longitude, d.fire_mask, d.frp_mw, d.scan_time].join();
      if (key === g.key) return;
      g.key = key;
      const sq = squareAround(d.latitude, d.longitude, goesSizeM());
      const c = GOES_MASK_COLOR[d.fire_mask] || HEX.fire;
      g.fill.polygon.hierarchy = new Cesium.PolygonHierarchy(sq);
      g.fill.polygon.material = col(c, 0.2);
      g.edge.polyline.positions = sq.concat([sq[0]]);
      g.edge.polyline.material = col(c, 0.95);
    });
    E.firms.forEach((f, i) => {
      const h = firms[i];
      f.fill.show = f.dot.show = !!h;
      if (!h) return;
      const key = [h.latitude, h.longitude, h.acq_date, h.acq_time].join();
      if (key === f.key) return;
      f.key = key;
      f.fill.polygon.hierarchy = new Cesium.PolygonHierarchy(squareAround(h.latitude, h.longitude, viirsSizeM()));
      f.dot.position = Cesium.Cartesian3.fromDegrees(h.longitude, h.latitude);
    });
    if (satInfo.el && !satInfo.el.hidden) { satInfo.el.hidden = true; satInfo.pinned = false; }   // data changed: close the info card
  }

  // Hover (mouse) or click (touch) a GOES square / FIRMS point to see its fields in plain words.
  // Hit test on the ground (not object picking), so fires, cones or smoke drawn
  // on top of a square never block it.
  const satInfo = { el: null, pinned: false, lastMove: 0, goes: [], firms: [] };

  function satAt(p) {
    if (!cur || !cur.layers.sat) return null;
    const scene = viewer.scene;
    // FIRMS first (small, on top): within ~10 px of the hotspot on screen.
    for (const h of satInfo.firms) {
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, groundPosLL(h.latitude, h.longitude), scratchWin);
      if (w && Math.hypot(w.x - p.x, w.y - p.y) < 10) return describe(h);
    }
    // GOES: is the ground point under the cursor inside a pixel square?
    const hit = scene.globe.pick(scene.camera.getPickRay(p), scene);
    if (!hit) return null;
    const c = Cesium.Cartographic.fromCartesian(hit);
    const lat = Cesium.Math.toDegrees(c.latitude), lon = Cesium.Math.toDegrees(c.longitude);
    const half = goesSizeM() / 2;
    for (const d of satInfo.goes) {
      const dy = (lat - d.latitude) * METERS_PER_DEG_LAT;
      const dx = (lon - d.longitude) * METERS_PER_DEG_LAT * Math.cos(d.latitude * Math.PI / 180);
      if (Math.abs(dx) <= half && Math.abs(dy) <= half) return describe(d);
    }
    return null;
  }

  function buildSatInfo() {
    satInfo.el = document.createElement('div');
    satInfo.el.className = 'satinfo';
    satInfo.el.hidden = true;
    mapRoot.appendChild(satInfo.el);
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const showAt = (p, click) => {
      const text = satAt(p);
      if (text) {
        satInfo.el.textContent = text;
        satInfo.el.hidden = false;
        const W = viewer.scene.canvas.clientWidth;
        const w = satInfo.el.offsetWidth;
        satInfo.el.style.left = Math.min(p.x + 14, W - w - 8) + 'px';
        satInfo.el.style.top = (p.y + 14) + 'px';
      } else if (click || !satInfo.pinned) {
        satInfo.el.hidden = true;
      }
      if (click) satInfo.pinned = !!text;
    };
    handler.setInputAction(m => {
      if (satInfo.pinned) return;
      const now = performance.now();
      if (now - satInfo.lastMove < 60) return;
      satInfo.lastMove = now;
      showAt(m.endPosition, false);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(c => showAt(c.position, true), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    viewer.scene.canvas.addEventListener('mouseleave', () => { if (!satInfo.pinned) satInfo.el.hidden = true; });
  }


  /* ---------- 7. Fires: shape, growth, glowing edge, embers, smoke ---------- */

  // A fire "slot" is one complete fire (fill, glowing edge, head glow, embers,
  // smoke, and for slot A the forecast cones). Slot A is the main fire
  // (Cottonwood Creek, or the escape); slot B is a second fire (the planned burn).
  function makeFireSlot(id, withCones) {
    const sl = {
      id, withCones, on: false, placeKey: null, origin: [0, 0], spec: null,
      size: null, from: null, to: null, t0: 0, lastGeomT: 0, geom: null, reshape: false,
      emberA: NaN, emberCount: 0, embers: [], smoke: [], cones: {}
    };
    sl.group = add({ id: 'fire-' + id, show: false });
    sl.headGlow = add({ parent: sl.group, position: pos([0, 0]), ellipse: { semiMajorAxis: 1, semiMinorAxis: 1, material: col(HEX.fireEdge, 0.14), zIndex: 4 } });
    sl.fill = add({ parent: sl.group, polygon: { hierarchy: posList(PLACEHOLDER), zIndex: 6,
      material: new Cesium.ImageMaterialProperty({ image: smokyTexture(), transparent: true }) } });
    // Edge: a wide soft glow under a thin bright core line.
    sl.glow = add({ parent: sl.group, polyline: { positions: posList(PLACEHOLDER), clampToGround: true, width: 16, zIndex: 10,
      material: new Cesium.PolylineGlowMaterialProperty({ color: col(HEX.fireEdge, 0.85), glowPower: 0.2, taperPower: 1 }) } });
    sl.core = add({ parent: sl.group, polyline: groundLine(PLACEHOLDER, col(HEX.fireEdge), 2.5, null, 11) });

    if (withCones) {
      for (const c of CONES) {
        sl.cones[c.key] = {
          fill: add({ parent: layers.spread, show: false, polygon: { hierarchy: posList(PLACEHOLDER), material: col(HEX.fire, c.fill), zIndex: c.z } }),
          edge: add({ parent: layers.spread, show: false, polyline: groundLine(PLACEHOLDER, col(HEX.fire, c.edge), 1.5, { length: 12 }, 1) }),
          tip: [0, 0], pts: null
        };
      }
    }

    // Embers: fixed spots inside the fire shape (denser near the edge).
    const rnd = seeded(id === 'A' ? 23 : 31);
    sl.emberColl = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    sl.emberColl.show = false;
    for (let i = 0; i < FIRE.embers; i++) {
      const th = rnd() * 2 * Math.PI;
      sl.embers.push({
        th,
        r: 0.96 * Math.pow(rnd(), 0.3),    // biased toward 1: denser near the edge
        m: bump(th),
        phase: rnd() * 6.283,
        speed: 2 + rnd() * 5,
        hot: rnd() < 0.3,
        point: sl.emberColl.add({
          pixelSize: 2 + rnd() * 1.5, color: col(HEX.ember), outlineColor: col(HEX.fireEdge, 0.3), outlineWidth: 1.5, show: false,
          // Smaller and fainter from far away, so a small fire is not just an orange blob.
          scaleByDistance: new Cesium.NearFarScalar(2000, 1.6, 35000, 0.45),
          translucencyByDistance: new Cesium.NearFarScalar(2000, 1, 45000, 0.45)
        })
      });
    }
    // Smoke puffs.
    const puff = smokePuffTexture();
    sl.smokeColl = viewer.scene.primitives.add(new Cesium.BillboardCollection());
    sl.smokeColl.show = false;
    for (let i = 0; i < FIRE.smokePuffs; i++) {
      sl.smoke.push({ i, rot: rnd() * 6.283, bb: sl.smokeColl.add({ image: puff, sizeInMeters: true, width: 10, height: 10, color: new Cesium.Color(0.62, 0.6, 0.57, 0), show: false }) });
    }
    return sl;
  }

  function buildFires() {
    slots.A = makeFireSlot('A', true);
    slots.B = makeFireSlot('B', false);
    viewer.scene.preUpdate.addEventListener(fireTick);
  }

  // Show / hide / resize one fire slot from its map-state spec.
  function setFire(sl, spec) {
    sl.spec = spec;
    if (!spec) {
      if (sl.on) {
        sl.on = false;
        sl.group.show = false;
        for (const k in sl.cones) sl.cones[k].fill.show = sl.cones[k].edge.show = false;
        sl.emberColl.show = false;
        sl.smokeColl.show = false;
      }
      return;
    }
    const target = fireSize(spec.acres);
    const now = performance.now() / 1000;
    if (!sl.on || sl.placeKey !== spec.place || !sl.size) {
      // New fire (or moved): appear at its size straight away.
      sl.placeKey = spec.place;
      sl.origin = PLACES[spec.place];
      sl.from = sl.to = sl.size = target;
      sl.t0 = now - FIRE.growSeconds;
      sl.geom = fireGeometry(target, sl.origin);
      setFireGeometry(sl, sl.geom);
      sl.emberA = NaN;
    } else if (target.acres !== sl.to.acres) {
      sl.from = sl.size;       // grow (or shrink, going Back) from the current size
      sl.to = target;
      sl.t0 = now;
      sl.lastGeomT = 0;
    }
    sl.on = true;
    sl.group.show = true;
    sl.emberColl.show = true;
    sl.smokeColl.show = true;
    for (const k in sl.cones) sl.cones[k].fill.show = sl.cones[k].edge.show = !!spec.cones;
  }

  // Update the ground shapes of one fire (fill, edge, head glow, cones).
  function setFireGeometry(sl, g) {
    sl.fill.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(g.outline));
    const ring = posList(closed(g.outline));
    sl.glow.polyline.positions = ring;
    sl.core.polyline.positions = ring;

    const glowR = (0.08 + g.s.b * 0.7) * METERS_PER_MILE;
    sl.headGlow.position = pos(fireFrame(g.headW[0] - g.s.a * 0.15, g.headW[1], g.origin));
    sl.headGlow.ellipse.semiMajorAxis = glowR;
    sl.headGlow.ellipse.semiMinorAxis = glowR;

    for (const c of CONES) {
      if (!sl.cones[c.key]) continue;
      const cg = coneGeometry(g, c);
      sl.cones[c.key].fill.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(cg.fill));
      sl.cones[c.key].edge.polyline.positions = posList(cg.edge);
      sl.cones[c.key].tip = cg.tip;
      sl.cones[c.key].pts = cg.fill;
    }
    if (sl.id === 'A') E.reporterLine.polyline.positions = posList([REPORTER, g.center]);
  }

  const scratchColor = new Cesium.Color();
  // Cheap hash -> 0..1, used for per-puff randomness that changes each cycle.
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const ease = t => t * t * (3 - 2 * t);

  function fireTick() {
    const now = performance.now() / 1000;
    for (const id in slots) {
      const sl = slots[id];
      if (sl.on) tickFire(sl, now);
    }
  }

  function tickFire(sl, now) {
    // 1. Grow smoothly from the previous step's size to this step's size.
    const p = Math.min(1, (now - sl.t0) / FIRE.growSeconds);
    const e = ease(p);
    const s = {
      a: sl.from.a + (sl.to.a - sl.from.a) * e,
      b: sl.from.b + (sl.to.b - sl.from.b) * e,
      c: sl.from.c + (sl.to.c - sl.from.c) * e,
      acres: sl.from.acres + (sl.to.acres - sl.from.acres) * e
    };
    sl.size = s;
    sl.geom = fireGeometry(s, sl.origin);
    // Ground shapes are rebuilt at most ~7 times per growth (they are costly).
    if (sl.reshape || (sl.from !== sl.to && (p >= 1 || now - sl.lastGeomT > 0.13))) {
      setFireGeometry(sl, sl.geom);
      sl.lastGeomT = now;
      if (p >= 1) sl.from = sl.to;
      if (sl.reshape) { sl.reshape = false; sl.emberA = NaN; }
    }

    // 2. Embers: fixed spots inside the fire shape, scaled with it, flickering.
    const visible = Math.round(Math.min(FIRE.embers, 4 + Math.sqrt(s.acres) * 4.2));
    const reseat = s.a !== sl.emberA || visible !== sl.emberCount;   // only when the fire changed size
    for (let i = 0; i < sl.embers.length; i++) {
      const em = sl.embers[i];
      const on = i < visible;
      em.point.show = on;
      if (!on) continue;
      if (reseat) {
        const l = fireLocal(s, em.th, em.r, em.m);
        em.point.position = airPos(fireFrame(l[0], l[1], sl.origin), 4);
      }
      const f = 0.5 + 0.5 * Math.sin(now * em.speed + em.phase);
      const g = 0.7 + 0.3 * Math.sin(now * em.speed * 2.3 + em.phase * 1.7);
      Cesium.Color.fromCssColorString(em.hot ? '#FFC07A' : HEX.ember, scratchColor);
      scratchColor.alpha = 0.35 + 0.65 * f * g;
      em.point.color = scratchColor;
    }
    sl.emberA = s.a;
    sl.emberCount = visible;

    // 3. Smoke: puffs rise from the head and drift downwind, growing and fading.
    const life = 9;
    const intensity = Math.min(1, 0.2 + s.acres / 150);
    const scale = 0.25 + 0.75 * Math.min(1, s.a / 0.8);
    const [h0, hc] = sl.geom.headW;
    for (const pf of sl.smoke) {
      const age = now + (pf.i * life) / sl.smoke.length;
      const cycle = Math.floor(age / life);
      const q = (age % life) / life;                     // 0..1 through this puff's life
      const across = hc + (hash(pf.i, cycle) - 0.5) * 1.6 * s.b * (1 + 2 * q);
      const along = h0 - s.a * 0.3 + q * (0.6 + 1.8 * scale);
      const sizeM = (0.2 + 1.2 * q) * scale * METERS_PER_MILE;
      pf.bb.position = airPos(fireFrame(along, across, sl.origin), 120 + 650 * q);
      pf.bb.width = pf.bb.height = sizeM;
      pf.bb.rotation = pf.rot + q * 0.6;
      pf.bb.color = new Cesium.Color(0.52, 0.5, 0.47, 0.34 * intensity * Math.pow(Math.sin(Math.PI * q), 1.2));
      pf.bb.show = true;
    }
  }


  /* ---------- 8. Labels: HTML callout cards and small text labels ---------- */

  // All map text is HTML laid over the 3D canvas. Every frame each label is
  // projected to the screen, hidden if its point is off screen, behind
  // terrain or (small labels) too far away, and placed so nothing overlaps.
  //   kind 'card':  bold title + subtitle, leader line down to the point.
  //                 Cards are never dropped; they are nudged apart instead.
  //   kind 'tag':   small quiet label next to its point. Dropped if there is no room.
  const labels = { root: null, svg: null, items: [], lastOcclusion: 0 };

  function buildLabels() {
    const root = document.createElement('div');
    root.className = 'maplabels';
    root.innerHTML = '<svg aria-hidden="true"></svg>';
    mapRoot.insertBefore(root, mapRoot.children[1] || null);
    labels.root = root;
    labels.svg = root.querySelector('svg');

    const L = c => c.layers;
    const fireCard = id => ({
      text: () => {
        const sl = slots[id], c = sl.spec && sl.spec.card;
        if (!c) return null;
        return { tone: c.tone || 'orange', title: c.title, sub: c.sub === 'lineDistance' ? headText(sl) : c.sub };
      },
      at: () => (slots[id].on && slots[id].geom ? slots[id].geom.head : null)
    });

    // Cards, in placement priority order. pref = where the card sits relative to its point.
    card(Object.assign({ id: 'fireA', pref: ['left', 'up', 'right'], show: c => !!c.fires.A }, fireCard('A')));
    card(Object.assign({ id: 'fireB', pref: ['left', 'up', 'right'], show: c => !!c.fires.B }, fireCard('B')));
    card({ id: 'homes', pref: ['right', 'up', 'left'],
      show: c => L(c).houses && !!c.homesCard,
      text: () => ({ tone: 'cream', title: cur.homesCard.title, sub: cur.homesCard.sub }),
      at: () => centerOf(HOME_GROUPS[cur.homesCard.group].map(i => HOMES[i])) });
    card({ id: 'station', pref: ['up', 'left', 'right'], show: c => L(c).stations,
      text: () => ({ tone: 'cream', title: 'Cottonwood Creek station', sub: '18 on the roster, 5 who can leave work' }),
      at: () => STATION });

    // Small labels, highest priority first.
    const conesOn = c => L(c).spread && !!c.fires.A && !!c.fires.A.cones;
    tag({ text: 'in 30 min', tone: 'fire', at: () => slots.A.cones.c30.tip, show: conesOn, pref: ['up', 'right', 'left', 'down'], far: 70000 });
    tag({ text: 'in 60 min', tone: 'fire', at: () => slots.A.cones.c60.tip, show: conesOn, pref: ['up', 'left', 'right', 'down'], far: 70000 });
    tag({ text: SECTION_22.label, tone: 'muted', at: () => [SECTION_22.center[0] - SECTION_22.halfMi, SECTION_22.center[1] - SECTION_22.halfMi],
      show: c => L(c).burns && c.burnArea, pref: ['down', 'left', 'up'], far: 70000 });
    tag({ text: 'Firebreak', tone: 'brk', at: () => firebreakPoints()[0], alt: () => firebreakPoints()[8], show: c => c.firebreak, pref: ['left', 'down', 'right', 'up'], far: 70000 });
    tag({ text: 'Neighbor photo, 1:59', tone: 'cream', at: () => REPORTER, show: c => c.reporter, pref: ['right', 'down', 'up'] });
    tag({ text: 'Lease water truck', tone: 'water', at: () => WATER_TRUCK, show: c => L(c).water, pref: ['right', 'down', 'left'] });
    tag({ text: 'Stock pond', tone: 'water', at: () => STOCK_POND.at, show: c => L(c).water, pref: ['left', 'down', 'up'] });
    tag({ text: 'Tank', tone: 'water', at: () => TANK, show: c => L(c).water, pref: ['left', 'down', 'right'] });
    tag({ text: '11 mi of gravel to the fire', tone: 'muted', at: () => ROUTE[7], show: c => L(c).stations && c.route, pref: ['left', 'right', 'down'] });
    tag({ text: 'Oil-lease power line', tone: 'power', at: () => lerp(POWER_LINE.from, POWER_LINE.to, 0.25), show: c => L(c).power, pref: ['down', 'up'] });
    tag({ text: 'Mutual aid, 30 to 40 min', tone: 'muted', at: () => MUTUAL_AID, show: c => L(c).stations, pref: ['right', 'down', 'up'] });
    tag({ text: 'High risk today: power line over dry grass', tone: 'brk', at: () => E.riskLabelAt, show: c => L(c).risk, pref: ['down', 'up'] });
    for (const b of BURNS) tag({ text: b.label, tone: 'muted', at: () => [b.at[0], b.at[1] - b.radiusMi], show: c => L(c).burns, pref: ['down', 'right', 'left'] });

    viewer.scene.postRender.addEventListener(layoutLabels);
  }

  function headText(sl) {
    if (!sl.geom) return '';
    const d = distanceToPowerLine(sl.geom.head);
    return d < 0.05 ? 'At the power line' : d.toFixed(1) + ' miles from the line';
  }

  function card(o) {
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = '<b></b><span></span>';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '3');
    labels.svg.append(line, dot);
    labels.root.appendChild(el);
    labels.items.push(Object.assign({ kind: 'card', el, line, dot, titleEl: el.querySelector('b'), subEl: el.querySelector('span'), key: null, size: null, shown: false }, o));
  }
  function tag(o) {
    const el = document.createElement('div');
    el.className = 'maptag ' + o.tone;
    el.textContent = o.text;
    labels.root.appendChild(el);
    labels.items.push(Object.assign({ kind: 'tag', el, size: null, shown: false, far: SMALL_LABEL_MAX_DISTANCE_M }, o));
  }

  // Refresh a card's text and color (re-measured only when something changed).
  function setCardText(it) {
    const t = it.text();
    if (!t) return false;
    const key = t.tone + '|' + t.title + '|' + t.sub;
    if (key !== it.key) {
      it.key = key;
      it.el.className = 'callout ' + t.tone;
      it.line.setAttribute('class', 'leader ' + t.tone);
      it.dot.setAttribute('class', 'leaderdot ' + t.tone);
      it.titleEl.textContent = t.title;
      it.subEl.textContent = t.sub || '';
      it.size = null;
    }
    return true;
  }

  const scratchCarto = new Cesium.Cartographic();
  const scratchWin = new Cesium.Cartesian2();

  // Ground position of a map point, using loaded terrain when available.
  function groundPos(p) {
    const [lon, lat] = lonLat(p);
    Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
    let h = viewer.scene.globe.getHeight(scratchCarto);
    if (h === undefined) h = heightAt(p[0], p[1]) * LOOK.verticalExaggeration;
    return Cesium.Cartesian3.fromDegrees(lon, lat, h);
  }

  function groundPosLL(lat, lon) {
    Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
    const h = viewer.scene.globe.getHeight(scratchCarto);
    return Cesium.Cartesian3.fromDegrees(lon, lat, h === undefined ? targetHeightM : h);
  }

  function setShown(it, on) {
    if (it.shown === on) return;
    it.shown = on;
    it.el.style.display = on ? 'block' : 'none';
    if (it.line) { it.line.style.display = on ? '' : 'none'; it.dot.style.display = on ? '' : 'none'; }
  }

  const overlaps = (a, b, pad) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

  function layoutLabels() {
    if (!cur) return;
    const scene = viewer.scene, cam = scene.camera;
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const now = performance.now();
    const checkOcclusion = now - labels.lastOcclusion > 300;
    if (checkOcclusion) labels.lastOcclusion = now;

    // 1. Project every label's point.
    const live = [];
    for (const it of labels.items) {
      let p = it.show(cur) ? it.at() : null;
      if (p && it.kind === 'card' && !setCardText(it)) p = null;
      if (!p) { setShown(it, false); continue; }
      const world = groundPos(p);
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world, scratchWin);
      const dist = Cesium.Cartesian3.distance(cam.positionWC, world);
      if (!win || win.x < 2 || win.y < 2 || win.x > W - 2 || win.y > H - 2 || (it.kind === 'tag' && dist > it.far)) { setShown(it, false); continue; }
      if (checkOcclusion) {
        // Hidden behind a hill? Cast a ray from the camera to the point.
        const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(world, cam.positionWC, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const hit = scene.globe.pick(new Cesium.Ray(cam.positionWC, dir), scene);
        // Tolerance grows with distance so points lying ON the ground are not hidden by rounding.
        it.occluded = !!hit && Cesium.Cartesian3.distance(cam.positionWC, hit) < dist - (80 + dist * 0.03);
      }
      if (it.occluded) { setShown(it, false); continue; }
      live.push({ it, x: win.x, y: win.y });
    }

    // 2. Things labels must not cover: on-map controls and every label's own point.
    const rootRect = labels.root.getBoundingClientRect();
    const blocks = [];
    for (const sel of ['.resetview', '#windCompass', '#cesiumCredits', '.confcard', '.outcome']) {
      const el = mapRoot.querySelector(sel);
      if (!el || el.hidden || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blocks.push({ x: r.left - rootRect.left, y: r.top - rootRect.top, w: r.width, h: r.height });
    }
    const dots = live.map(l => ({ x: l.x - 5, y: l.y - 5, w: 10, h: 10, owner: l.it }));
    // Cards must not cover the fires or the forecast cones.
    const keepOut = [];
    for (const id in slots) if (slots[id].on && slots[id].geom) keepOut.push(screenBox(slots[id].geom.outline.filter((_, i) => i % 10 === 0)));
    if (cur.layers.spread && cur.fires.A && cur.fires.A.cones && slots.A.cones.c60.pts) keepOut.push(screenBox(slots.A.cones.c60.pts));
    const clearOfFire = box => !keepOut.some(b => b && overlaps(box, b, 4));
    const placed = [];
    const free = (box, owner, pad) =>
      box.x >= 4 && box.y >= 4 && box.x + box.w <= W - 4 && box.y + box.h <= H - 4 &&
      !placed.some(b => overlaps(box, b, pad)) && !blocks.some(b => overlaps(box, b, 4)) &&
      !dots.some(d => d.owner !== owner && overlaps(box, d, 1));

    // 3. Cards first (in priority order); search outward until they fit.
    for (const l of live.filter(l => l.it.kind === 'card')) {
      const it = l.it;
      const size = measure(it);
      // Nearest free spot wins, preferred sides first.
      let box = null;
      search:
      for (let d = 0; d <= 260; d += 8) {
        for (const side of it.pref) {
          for (const dy of side === 'up' ? [0] : [0, -26, 26, -52]) {
            const b = cardBox(side, l.x, l.y + dy, size, d);
            if (free(b, it, 6) && clearOfFire(b)) { box = b; break search; }
          }
        }
      }
      if (!box) { box = cardBox(it.pref[0], l.x, l.y, size, 0); box.x = Math.min(Math.max(box.x, 4), W - size.w - 4); box.y = Math.max(box.y, 4); }
      placed.push(box);
      place(it, box);
      // Leader: from the point to the nearest spot on the card's edge.
      const ex = Math.min(Math.max(l.x, box.x + 6), box.x + box.w - 6);
      const ey = Math.min(Math.max(l.y, box.y), box.y + box.h);
      setAttrs(it.line, { x1: l.x.toFixed(1), y1: l.y.toFixed(1), x2: ex.toFixed(1), y2: ey.toFixed(1) });
      setAttrs(it.dot, { cx: l.x.toFixed(1), cy: l.y.toFixed(1) });
    }

    // 4. Small labels: try each preferred side; drop the label if none fits.
    for (const l of live.filter(l => l.it.kind === 'tag')) {
      const it = l.it, size = measure(it);
      let box = findTagBox(it, l.x, l.y, size, free);
      if (!box && it.alt) {                                   // e.g. the other end of the firebreak
        const w = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, groundPos(it.alt()), scratchWin);
        if (w) box = findTagBox(it, w.x, w.y, size, free);
      }
      if (!box) { setShown(it, false); continue; }
      placed.push(box);
      place(it, box);
    }
  }

  function measure(it) {
    if (!it.size) {
      const wasShown = it.shown;
      it.el.style.display = 'block';
      it.size = { w: it.el.offsetWidth, h: it.el.offsetHeight };
      if (!wasShown) it.el.style.display = 'none';
    }
    return it.size;
  }
  // Card position for a side; d = extra distance when nudging away from the point.
  function cardBox(side, x, y, s, d) {
    if (side === 'left')  return { x: x - s.w - 20 - d, y: y - s.h - 6, w: s.w, h: s.h };
    if (side === 'right') return { x: x + 20 + d, y: y - s.h - 6, w: s.w, h: s.h };
    return { x: x - s.w / 2, y: y - s.h - 26 - d, w: s.w, h: s.h };   // up
  }
  // Screen bounding box of some map points (null if none are on screen).
  function screenBox(points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, groundPos(p), scratchWin);
      if (!w) continue;
      x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x); y1 = Math.max(y1, w.y);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function findTagBox(it, x, y, size, free) {
    for (const shift of [0, -12, 12, -24, 24]) {            // slide along the side if blocked
      for (const side of it.pref) {
        const b = tagBox(side, x, y, size);
        if (side === 'up' || side === 'down') b.x += shift * 2; else b.y += shift;
        if (free(b, it, 3)) return b;
      }
    }
    return null;
  }
  function tagBox(side, x, y, s) {
    if (side === 'right') return { x: x + 9, y: y - s.h / 2, w: s.w, h: s.h };
    if (side === 'left')  return { x: x - 9 - s.w, y: y - s.h / 2, w: s.w, h: s.h };
    if (side === 'down')  return { x: x - s.w / 2, y: y + 8, w: s.w, h: s.h };
    return { x: x - s.w / 2, y: y - 8 - s.h, w: s.w, h: s.h };          // up
  }
  function place(it, box) {
    const t = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
    if (it.el.style.transform !== t) it.el.style.transform = t;
    setShown(it, true);
  }
  function setAttrs(el, attrs) {
    for (const k in attrs) if (el.getAttribute(k) !== attrs[k]) el.setAttribute(k, attrs[k]);
  }


  /* ---------- 9. Wind streaks and compass ---------- */

  // The streaks are a fixed pool of polylines in ONE PolylineCollection.
  // Each frame we only move them; nothing is created or destroyed.
  const wind = {
    on: true, collection: null, streaks: [], gusts: [], domain: null, span: 20,
    normalMat: null, gustMat: null,
    t0: 0, lastT: 0, travel: 0, speedFactor: 1,
    nextGust: 0, gustStart: -1,
    lastHeading: NaN
  };

  // Fading-tail material: transparent at the tail, brightest at the head.
  // (st.s runs 0 -> 1 along a polyline, tail -> head.)
  function streakMaterial(alpha) {
    return new Cesium.Material({
      translucent: true,
      fabric: {
        uniforms: { color: new Cesium.Color(0.93, 0.91, 0.86, alpha) },
        source: [
          'czm_material czm_getMaterial(czm_materialInput materialInput) {',
          '  czm_material m = czm_getDefaultMaterial(materialInput);',
          '  float s = materialInput.st.s;',
          '  m.diffuse = color.rgb;',
          '  m.alpha = color.a * pow(s, 1.5);',
          '  return m;',
          '}'
        ].join('\n')
      }
    });
  }

  // District bounding box in the wind frame (used to place gust clusters).
  function windDomain() {
    const w = DISTRICT_CORNERS.map(toWindFrame);
    const al = w.map(q => q[0]), ac = w.map(q => q[1]);
    return { aMin: Math.min(...al) - 1, aMax: Math.max(...al) + 1, cMin: Math.min(...ac), cMax: Math.max(...ac) };
  }

  function buildWind() {
    // The streak grid is a square around the district, so it covers the
    // district whichever way the wind blows.
    const span = Math.max(...DISTRICT_CORNERS.map(p => Math.hypot(p[0], p[1]))) + 1;
    wind.span = span;
    wind.domain = windDomain();
    wind.normalMat = streakMaterial(WIND.alpha);
    wind.gustMat = streakMaterial(0);
    wind.collection = viewer.scene.primitives.add(new Cesium.PolylineCollection());

    // Evenly spaced grid with random jitter, so it looks natural.
    for (let ac = -span; ac < span; ac += WIND.spacingAcrossMi) {
      for (let al = -span; al < span; al += WIND.spacingAlongMi) {
        wind.streaks.push({
          across: ac + Math.random() * WIND.spacingAcrossMi,
          along0: al + Math.random() * WIND.spacingAlongMi,
          speed: WIND.speedMiPerSec * (0.85 + Math.random() * 0.3),
          len: WIND.lengthMi * (0.75 + Math.random() * 0.5),
          phase: Math.random() * Math.PI * 2,
          line: wind.collection.add({ width: WIND.width, material: wind.normalMat, show: false })
        });
      }
    }
    for (let i = 0; i < WIND.gustCount; i++) {
      wind.gusts.push({
        across: 0, along0: 0, phase: Math.random() * Math.PI * 2,
        speed: WIND.speedMiPerSec * WIND.gustSpeedFactor * (0.9 + Math.random() * 0.2),
        len: WIND.gustLengthMi * (0.8 + Math.random() * 0.4),
        line: wind.collection.add({ width: WIND.gustWidth, material: wind.gustMat, show: false })
      });
    }
    wind.t0 = wind.lastT = performance.now() / 1000;
    wind.nextGust = 3;
    viewer.scene.preUpdate.addEventListener(windTick);
    viewer.scene.postRender.addEventListener(updateCompass);
  }

  // Place one streak. `travel` = how far the air has moved so far (scaled by
  // wind speed), so a change of speed never makes streaks jump. Streaks wrap
  // around within +-span; hidden if any part is outside the district.
  function placeStreak(s, travel, t, span) {
    const raw = s.along0 + s.speed * travel + span;
    const head = (((raw % (2 * span)) + 2 * span) % (2 * span)) - span;
    const across = s.across + 0.08 * Math.sin(t * 0.6 + s.phase);   // gentle sway
    const hp = fireFrame(head, across), tp = fireFrame(head - s.len, across);
    const show = insideDistrict(hp) && insideDistrict(tp);
    s.line.show = show;
    if (show) s.line.positions = [airPos(tp, WIND.liftM), airPos(hp, WIND.liftM)];
  }

  function startGust(t) {
    // Pick a random spot inside the district and scatter gust streaks around it.
    const D = wind.domain;
    let center = [0, 0];
    for (let k = 0; k < 20; k++) {
      const c = [D.aMin + Math.random() * (D.aMax - D.aMin), D.cMin + Math.random() * (D.cMax - D.cMin)];
      if (insideDistrict(fireFrame(c[0], c[1]))) { center = c; break; }
    }
    for (const g of wind.gusts) {
      g.across = center[1] + (Math.random() - 0.5) * 2 * WIND.gustRadiusMi;
      g.along0 = center[0] + (Math.random() - 0.5) * 2 * WIND.gustRadiusMi - g.speed * wind.travel;
    }
    wind.gustStart = t;
    wind.nextGust = t + WIND.gustEveryMin + Math.random() * (WIND.gustEveryMax - WIND.gustEveryMin);
  }

  function windTick() {
    const nowS = performance.now() / 1000;
    const t = nowS - wind.t0;
    wind.travel += (nowS - wind.lastT) * wind.speedFactor;
    wind.lastT = nowS;
    if (!wind.on) return;
    for (const s of wind.streaks) placeStreak(s, wind.travel, t, wind.span);

    if (t >= wind.nextGust) startGust(t);
    const p = wind.gustStart < 0 ? 1 : (t - wind.gustStart) / WIND.gustSeconds;
    const gustOn = p < 1;
    wind.gustMat.uniforms.color.alpha = gustOn ? WIND.gustAlpha * Math.sin(Math.PI * p) : 0;  // fade in, then out
    for (const g of wind.gusts) {
      if (gustOn) placeStreak(g, wind.travel, t, 1e6); else g.line.show = false;
    }
  }

  // Compass: rotate the arrow and the N mark to match the camera heading.
  function updateCompass() {
    if (!compassEl || compassEl.hidden) return;
    const h = Cesium.Math.toDegrees(viewer.camera.heading);
    if (Math.abs(h - wind.lastHeading) < 0.1) return;
    wind.lastHeading = h;
    compassEl.querySelector('[data-wind="arrow"]').setAttribute('transform', 'rotate(' + (WIND.towardDeg - h).toFixed(1) + ' 28 28)');
    compassEl.querySelector('[data-wind="north"]').setAttribute('transform', 'rotate(' + (-h).toFixed(1) + ' 28 28)');
  }

  function setWindVisible(on) {
    wind.on = on;
    if (wind.collection) wind.collection.show = on;
    if (compassEl && compassEl.hidden === on) {
      compassEl.hidden = !on;
      wind.lastHeading = NaN;   // force a redraw of the arrow when shown again
    }
  }


  /* ---------- 10. Camera ---------- */

  function resetView(duration = 1.5) {
    if (!ready) return;
    const cam = CAMERAS[curView] || CAMERAS.district;
    const [lon, lat] = lonLat(cam.target);
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, targetHeightM);
    viewer.camera.cancelFlight();
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 0), {
      offset: new Cesium.HeadingPitchRange(rad(cam.headingDeg), rad(cam.pitchDeg), cam.rangeM),
      duration
    });
  }


  /* ---------- 11. Messages over the map (missing token, loading, errors) ---------- */

  function showMsg(title, detail, loading) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.classList.toggle('loading', !!loading);
    msgEl.innerHTML = `<div class="mapmsg-title">${title}</div>${detail ? `<div class="mapmsg-detail">${detail}</div>` : ''}`;
  }
  function hideMsg() { if (msgEl) msgEl.hidden = true; }


  /* ---------- 12. Startup ---------- */

  async function init({ container, credits, message, compass }) {
    msgEl = message;
    compassEl = compass;
    mapRoot = container.parentElement;

    if (!window.Cesium) {
      showMsg('The 3D map library did not load', 'Check your internet connection and reload. CesiumJS loads from cdn.jsdelivr.net.');
      return;
    }
    const token = String(window.CESIUM_ION_TOKEN || '').trim();
    if (!token || token === 'PASTE_YOUR_TOKEN_HERE') {
      showMsg(NO_TOKEN_TITLE, 'Copy <code>config.example.js</code> to <code>config.js</code>, paste your token from ion.cesium.com/tokens, then reload.');
      return;
    }
    Cesium.Ion.defaultAccessToken = token;
    showMsg('Loading 3D map…', '', true);

    // Loading terrain first also checks the token: Cesium ion answers 401 if it is wrong.
    let terrainProvider;
    try {
      terrainProvider = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true });
    } catch (err) {
      console.error('Cesium World Terrain failed to load:', err);
      if (err && (err.statusCode === 401 || err.statusCode === 403)) {
        showMsg(NO_TOKEN_TITLE, 'Cesium ion rejected the token in <code>config.js</code>. It may be mistyped, expired or deleted. Copy it again from ion.cesium.com/tokens and reload.');
      } else {
        showMsg('Could not reach Cesium ion', 'Check your internet connection and reload. If it keeps failing, check the token in <code>config.js</code>.');
      }
      return;
    }

    // Card and label sizes are measured, so the fonts must be loaded first.
    try { await Promise.all([document.fonts.load('600 14px Barlow'), document.fonts.load('500 12px Barlow')]); } catch (e) { /* fall back */ }

    try {
      viewer = new Cesium.Viewer(container, {
        terrainProvider,
        baseLayer: Cesium.ImageryLayer.fromWorldImagery({ style: Cesium.IonWorldImageryStyle.AERIAL }),
        // No default Cesium UI.
        animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        infoBox: false, selectionIndicator: false, fullscreenButton: false,
        // Credits go into our own small box (they must stay visible).
        creditContainer: credits
      });
    } catch (err) {
      console.error('Cesium viewer failed to start:', err);
      showMsg('This browser could not start the 3D map', 'The 3D map needs WebGL. Try an up-to-date Chrome, Edge or Firefox with hardware acceleration on.');
      return;
    }

    // Clicking or double-clicking an entity would select or zoom to it; turn that off.
    const handler = viewer.cesiumWidget.screenSpaceEventHandler;
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Dark, lit terrain to match the dashboard.
    const scene = viewer.scene;
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.baseColor = col(HEX.bg);
    scene.backgroundColor = col(HEX.bg);
    scene.verticalExaggeration = LOOK.verticalExaggeration;
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(LOOK.sunTimeUtc);
    viewer.clock.shouldAnimate = false;
    const imagery = viewer.imageryLayers.get(0);
    imagery.brightness = LOOK.imageryBrightness;
    imagery.contrast = LOOK.imageryContrast;
    imagery.saturation = LOOK.imagerySaturation;

    // Keep the camera from zooming into the dirt or out to space.
    scene.screenSpaceCameraController.minimumZoomDistance = 300;
    scene.screenSpaceCameraController.maximumZoomDistance = 150000;

    // Ground height at the camera target, so the starting view is centered on the hills.
    try {
      const [lon, lat] = lonLat(CAMERAS.district.target);
      const [s] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [Cesium.Cartographic.fromDegrees(lon, lat)]);
      if (s && Number.isFinite(s.height)) targetHeightM = s.height;
    } catch (e) { /* keep the default height */ }

    buildEntities();
    buildFires();
    buildWind();
    buildLabels();
    buildSatInfo();
    sampleHeights(terrainProvider);   // async; effects use a flat height until it finishes
    ready = true;
    // Show the latest dashboard state (render() runs before the map is ready).
    applyState(pending || { layers: {}, view: 'district', wind: { towardDeg: 20, mph: 35 }, fires: { A: null, B: null } });
    pending = null;
    hideMsg();
  }

  // Called by index.html on every render. Cheap: only touches existing objects.
  function update(u) {
    if (!ready) { pending = u; return; }
    applyState(u);
  }

  window.Map3D = { init, update, resetView: () => resetView(1.5) };
})();
