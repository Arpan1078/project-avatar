/* =====================================================================
   map3d.js: the 3D map for the Firewatch dashboard (CesiumJS + Cesium ion)

   How it fits together:
   - index.html calls Map3D.init(...) once. That creates ONE Cesium viewer
     and every map entity (fire, homes, water, roads...).
   - Every time the dashboard state changes, index.html calls
     Map3D.update({ k, acres, nSteps, layers }). That only changes existing
     entities (positions, sizes, show/hide). The viewer is never rebuilt.
   - Map3D.resetView() flies the camera back to the starting view.

   HOW TO MOVE THINGS
   Every feature is placed in MILES EAST and MILES NORTH of the fire start,
   written as [east, north]. Negative east = west, negative north = south.
   - To move the whole district somewhere else, change ORIGIN only.
   - To move one feature, change its [east, north] pair in section 2.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Anchor point and unit conversion ---------- */

  // The fire start (where the power line drops into the grass).
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

  // Homes. path: true = in the fire path (orange).
  // The 3 path homes sit about 2.2 to 2.5 mi downwind (NNE): inside the
  // 60-minute cone from 1:51 on, and outside the burned area at 2:22.
  const HOMES = [
    // label dy: pixels down (negative = up), so the two labels don't overlap.
    { at: [0.48, 2.45], path: true,  label: '3 homes in the fire path', labelColor: '#F2A65A', dy: -9 },
    { at: [0.95, 2.02], path: true,  label: 'Rancher, has a disc',      labelColor: '#EDE3CF', dy: 7 },
    { at: [0.62, 2.20], path: true },
    { at: [5.80, -1.60], path: false },
    { at: [-5.60, 0.40], path: false },
    { at: [10.50, 4.00], path: false },
    { at: [-7.60, 4.60], path: false }
  ];

  // Water sources.
  const STOCK_POND = { at: [-0.55, 1.15], semiMajorM: 130, semiMinorM: 85 };
  const TANK = [-2.4, 0.75];
  const WATER_TRUCK = [1.5, -0.3];

  // Firebreak the rancher discs, E-W across the fire's path (shown from 1:59).
  // Kept south of the homes and north of where the fire head is at 2:22.
  const FIREBREAK = [[-0.25, 1.71], [0.10, 1.67], [0.45, 1.70], [0.80, 1.66], [1.15, 1.69], [1.45, 1.67]];

  // Neighbor who sends the photo at 1:59. A dashed line runs to the fire.
  const REPORTER = [3.1, 0.55];

  // Permitted burns from the weekend (both out).
  const BURNS = [
    { at: [6.6, -3.4],  radiusMi: 0.45, label: 'Permitted burn, Sat (out)' },
    { at: [-4.4, -3.6], radiusMi: 0.35, label: 'Permitted burn, Sun (out)' }
  ];

  // Wind: from the south at 35 mph, gusts 55, blowing toward the NNE.
  // The fire spreads (and the forecast cones point) the same way: FIRE uses
  // WIND.towardDeg, so changing it here turns the streaks, compass AND cones.
  const WIND = {
    towardDeg: 20,           // direction the wind blows TO (clockwise from north)
    // Streak animation (miles and seconds). Map speed is sped up so motion is
    // visible at district scale: a streak crosses the district in ~50 s.
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

  // Fire shape. Acres come from STEPS in index.html. Wind is from the south
  // at 35 mph; the fire runs toward FIRE.bearingDeg (degrees clockwise from north).
  // Sizes: 15 acres at 1:52; 600 acres and ~1.5 mi long at 2:22.
  const FIRE = {
    bearingDeg: WIND.towardDeg,   // north-northeast, same as the wind
    minAcres: 0.5,      // so the 1:50 spark is still visible
    ratioStart: 1.5,    // length / width at the first step
    ratioEnd: 1.875,    // length / width at the last step (600 ac -> 1.5 mi x 0.8 mi)
    tailFraction: 0.15  // how far the fire backs up behind the start (share of half-length)
  };

  // Fire path forecast cones, measured from the fire head.
  // Facts panel says the head moves 2 to 3 mph, so ~1.25 mi per 30 min.
  const CONES = [
    { key: 'c60', label: 'in 60 min', aheadMi: 2.5,  widen: 2.6, extraMi: 0.7,  fill: 0.07, edge: 0.45, z: 2 },
    { key: 'c30', label: 'in 30 min', aheadMi: 1.25, widen: 1.8, extraMi: 0.35, fill: 0.14, edge: 0.7,  z: 3 }
  ];

  // Starting camera: looking NNE, tilted 45 degrees down, framing the fire,
  // the station and the area the fire spreads into.
  // The target sits between the fire and the station, so the station (near
  // edge) and the 60-minute cone (far edge) both fit on a 1440 x 900 screen.
  const CAMERA = {
    target: [3.5, -2.8],   // point the camera looks at (miles east/north)
    headingDeg: 20,        // direction the camera faces (clockwise from north)
    pitchDeg: -45,         // tilt (-90 = straight down)
    rangeM: 32000          // distance from the target, in meters (tested in Simple and Full view)
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


  /* ---------- 3. Colors and label style (same palette as the old SVG) ---------- */

  const HEX = {
    fire: '#F26B2E', fireSoft: '#F2A65A', cream: '#EDE3CF', muted: '#A89C88',
    water: '#6EA8D6', waterText: '#9CC4E4', brk: '#E8B04A', power: '#C9B98F',
    burn: '#6E665C', burned: '#0E0C0A', bg: '#15120F'
  };
  const col = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

  const FONT = '500 12px Barlow, sans-serif';
  const FONT_BOLD = '600 13px Barlow, sans-serif';
  const NO_TOKEN_TITLE = 'Add your Cesium ion token to config.js';


  /* ---------- 4. Small geometry helpers ---------- */

  const rad = d => d * Math.PI / 180;
  const SIN_B = Math.sin(rad(FIRE.bearingDeg));
  const COS_B = Math.cos(rad(FIRE.bearingDeg));

  // Point in the fire's own frame -> [east, north].
  // along = miles downwind from the start; across = miles to the right of the wind.
  function fireFrame(along, across) {
    return [along * SIN_B + across * COS_B, along * COS_B - across * SIN_B];
  }

  // Fire ellipse size for a step. a = half-length, b = half-width (miles),
  // c = center distance downwind, head = head distance downwind.
  function fireShape(acres, k, nSteps) {
    const ac = Math.max(parseFloat(acres) || 0, FIRE.minAcres);
    const t = nSteps > 1 ? k / (nSteps - 1) : 1;
    const ratio = FIRE.ratioStart + (FIRE.ratioEnd - FIRE.ratioStart) * t;
    const a = Math.sqrt((ac / 640) * ratio / Math.PI);   // 640 acres per sq mi
    const b = a / ratio;
    const c = a * (1 - FIRE.tailFraction);
    return { a, b, c, head: c + a };
  }

  // Egg-shaped outline: a little wider at the head, like a wind-driven fire.
  function fireOutline(f, n = 72) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n;
      pts.push(fireFrame(f.c + f.a * Math.cos(th), f.b * Math.sin(th) * (1 + 0.12 * Math.cos(th))));
    }
    return pts;
  }

  // Forecast cone: from the fire's flanks out to a curved front edge.
  function coneOutline(f, cone) {
    const far = f.head + cone.aheadMi;
    const hw = f.b * cone.widen + cone.extraMi;
    const pts = [fireFrame(f.c, -f.b)];
    for (let j = 0; j <= 10; j++) {
      const u = -1 + j / 5;                           // -1 .. 1 across the front
      pts.push(fireFrame(far - 0.3 * hw * u * u, hw * u));
    }
    pts.push(fireFrame(f.c, f.b));
    // Label at the left front corner (text drawn to its left, away from the homes).
    return { pts, labelAt: fireFrame(far - 0.3 * hw, -hw) };
  }

  function circle(center, rMi, n = 48) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n;
      pts.push([center[0] + rMi * Math.cos(th), center[1] + rMi * Math.sin(th)]);
    }
    return pts;
  }

  const closed = pts => pts.concat([pts[0]]);

  // Point a fraction t (0..1) of the way from p to q.
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];


  /* ---------- 5. Marker icons (drawn on canvas at 2x, shown at half size) ---------- */

  function icon(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext('2d');
    g.scale(2, 2);
    draw(g);
    return c;
  }
  const squareIcon = (size, fill, stroke, lw) => icon(size + lw * 2, size + lw * 2, g => {
    if (fill) { g.fillStyle = fill; g.fillRect(lw, lw, size, size); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(lw, lw, size, size); }
  });
  const ringIcon = (r, stroke, lw) => icon(r * 2 + lw * 2, r * 2 + lw * 2, g => {
    g.strokeStyle = stroke; g.lineWidth = lw;
    g.beginPath(); g.arc(r + lw, r + lw, r, 0, Math.PI * 2); g.stroke();
  });
  const rectIcon = (w, h, fill, stroke) => icon(w + 2, h + 2, g => {
    g.fillStyle = fill; g.fillRect(1, 1, w, h);
    g.strokeStyle = stroke; g.lineWidth = 1; g.strokeRect(1, 1, w, h);
  });


  /* ---------- 6. Viewer and entities ---------- */

  let viewer = null;
  let ready = false;
  let pending = null;       // last update() call made before the viewer was ready
  let lastStep = -1;
  let targetHeightM = 550;  // replaced by a terrain sample at startup
  let msgEl = null;

  let compassEl = null;     // wind compass card (HTML, over the map)
  const layers = {};        // parent entity per "Show on map" chip
  const E = {};             // entities that change per step

  function add(opts) { return viewer.entities.add(opts); }

  // Tiny placeholder shape for entities whose real geometry is set per step.
  const PLACEHOLDER = [[0, 0], [0.01, 0], [0, 0.01]];

  // Shared settings for anything pinned to the ground and drawn over hills.
  const ON_GROUND = () => ({
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY   // hills never hide it
  });

  function labelProps(text, opts = {}) {
    return Object.assign(ON_GROUND(), {
      text,
      font: opts.font || FONT,
      fillColor: col(opts.color || HEX.cream),
      showBackground: true,
      backgroundColor: col(HEX.bg, 0.82),
      backgroundPadding: new Cesium.Cartesian2(5, 2),
      // align: 'left' (text starts at the point, default), 'center' or 'right' (text ends at the point)
      horizontalOrigin: Cesium.HorizontalOrigin[(opts.align || 'left').toUpperCase()],
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(opts.dx ?? 12, opts.dy ?? 0)
    });
  }
  function addLabel(parent, at, text, opts) {
    return add({ parent, position: pos(at), label: labelProps(text, opts) });
  }
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

  function buildEntities() {
    // Parent entity per chip: hiding the parent hides all its children.
    for (const key of ['spread', 'houses', 'water', 'stations', 'power', 'burns', 'risk']) {
      layers[key] = add({ id: 'layer-' + key });
    }
    // Groups that depend on the time step, not on a chip.
    E.breakGroup = add({ id: 'step-firebreak' });
    E.reporterGroup = add({ id: 'step-reporter' });

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
    // Label on the south edge of the band, east of the fire (away from the fire labels).
    addLabel(layers.risk, lerp(south[0], south[1], 0.72), 'High risk today: power line over dry grass', { color: HEX.brk, align: 'center', dx: 0, dy: 14 });

    // --- Permitted burns ---
    for (const b of BURNS) {
      add({ parent: layers.burns, position: pos(b.at), ellipse: { semiMajorAxis: b.radiusMi * METERS_PER_MILE, semiMinorAxis: b.radiusMi * METERS_PER_MILE, material: col(HEX.burn, 0.35), zIndex: 1 } });
      add({ parent: layers.burns, polyline: groundLine(closed(circle(b.at, b.radiusMi)), col(HEX.muted), 1.5, { length: 8 }) });
      addLabel(layers.burns, [b.at[0], b.at[1] - b.radiusMi], b.label, { color: HEX.muted, align: 'center', dx: 0, dy: 14 });
    }

    // --- Fire path forecast cones (geometry is set per step in applyStep) ---
    for (const c of CONES) {
      E[c.key] = {
        fill: add({ parent: layers.spread, polygon: { hierarchy: posList(PLACEHOLDER), material: col(HEX.fire, c.fill), zIndex: c.z } }),
        edge: add({ parent: layers.spread, polyline: groundLine(PLACEHOLDER, col(HEX.fire, c.edge), 1.5, { length: 12 }, 1) }),
        label: add({ parent: layers.spread, position: pos([0, 0]), label: labelProps(c.label, { color: HEX.fireSoft, align: 'right', dx: -6 }) })
      };
    }

    // --- Power line with pole markers ---
    add({ parent: layers.power, polyline: groundLine([POWER_LINE.from, POWER_LINE.to], col(HEX.power), 2) });
    const poles = Math.floor(len / POWER_LINE.poleEveryMi);
    for (let i = 1; i < poles; i++) {
      add({ parent: layers.power, position: pos(lerp(POWER_LINE.from, POWER_LINE.to, (i * POWER_LINE.poleEveryMi) / len)),
        point: Object.assign(ON_GROUND(), { pixelSize: 5, color: col(HEX.power), outlineColor: col(HEX.bg), outlineWidth: 1 }) });
    }
    addLabel(layers.power, lerp(POWER_LINE.from, POWER_LINE.to, 0.25), 'Oil-lease power line', { color: HEX.power, align: 'center', dx: 0, dy: 16 });

    // --- Fire stations and route ---
    add({ parent: layers.stations, position: pos(STATION), billboard: billboard(squareIcon(18, HEX.cream, null, 1)) });
    addLabel(layers.stations, STATION, 'Fire station', { font: FONT_BOLD, dx: 16, dy: -8 });
    addLabel(layers.stations, STATION, '11 mi of gravel to the fire', { color: HEX.muted, dx: 16, dy: 9 });
    add({ parent: layers.stations, position: pos(MUTUAL_AID), billboard: billboard(squareIcon(12, null, HEX.cream, 1.5)) });
    addLabel(layers.stations, MUTUAL_AID, 'Mutual aid, 30 to 40 min', { color: HEX.muted });
    E.route = add({ parent: layers.stations, polyline: groundLine(ROUTE, col(HEX.cream, 0.95), 3, { length: 12, pattern: 0xF0F0 }, 2) });

    // --- Homes ---
    const homePath = squareIcon(9, HEX.fireSoft, HEX.fire, 1.5);
    const homeSafe = squareIcon(9, HEX.cream, HEX.cream, 1.5);
    for (const h of HOMES) {
      add({ parent: layers.houses, position: pos(h.at), billboard: billboard(h.path ? homePath : homeSafe) });
      if (h.label) addLabel(layers.houses, h.at, h.label, { color: h.labelColor, dy: h.dy });
    }

    // --- Firebreak (from 1:59) ---
    add({ parent: E.breakGroup, polyline: groundLine(FIREBREAK, col(HEX.brk), 4, { length: 18, pattern: 0xFFF0 }, 3) });
    // Label just under the middle of the line, clear of the cone labels on the left.
    addLabel(E.breakGroup, FIREBREAK[2], 'Firebreak', { color: HEX.brk, dx: 4, dy: 14 });

    // --- Water ---
    add({ parent: layers.water, position: pos(STOCK_POND.at), ellipse: { semiMajorAxis: STOCK_POND.semiMajorM, semiMinorAxis: STOCK_POND.semiMinorM, material: col(HEX.water, 0.8), zIndex: 7 } });
    addLabel(layers.water, STOCK_POND.at, 'Stock pond', { color: HEX.waterText, align: 'right', dx: -8, dy: 10 });
    add({ parent: layers.water, position: pos(WATER_TRUCK), billboard: billboard(rectIcon(16, 9, HEX.water, HEX.waterText)) });
    addLabel(layers.water, WATER_TRUCK, 'Lease water truck', { color: HEX.waterText, dx: 14 });
    add({ parent: layers.water, position: pos(TANK), billboard: billboard(ringIcon(6, HEX.water, 2)) });
    addLabel(layers.water, TANK, 'Tank', { color: HEX.waterText, align: 'right', dx: -12 });

    // --- Neighbor photo report (from 1:59) ---
    E.reporterLine = add({ parent: E.reporterGroup, polyline: groundLine([REPORTER, [0, 0]], col(HEX.cream, 0.85), 1.5, { length: 8 }, 4) });
    add({ parent: E.reporterGroup, position: pos(REPORTER), point: Object.assign(ON_GROUND(), { pixelSize: 11, color: col(HEX.cream), outlineColor: col(HEX.bg), outlineWidth: 1 }) });
    addLabel(E.reporterGroup, REPORTER, 'Neighbor photo, 1:59', { align: 'center', dx: 0, dy: 18 });

    // --- The fire itself (always on) ---
    E.glowOuter = add({ position: pos([0, 0]), ellipse: { semiMajorAxis: 1, semiMinorAxis: 1, material: col(HEX.fire, 0.1), zIndex: 4 } });
    E.glowInner = add({ position: pos([0, 0]), ellipse: { semiMajorAxis: 1, semiMinorAxis: 1, material: col(HEX.fire, 0.18), zIndex: 5 } });
    E.fireFill = add({ polygon: { hierarchy: posList(PLACEHOLDER), material: col(HEX.burned), zIndex: 6 } });
    E.fireEdge = add({ polyline: groundLine(PLACEHOLDER, col(HEX.fire), 3, null, 10) });
    add({ position: pos([0, 0]), point: Object.assign(ON_GROUND(), { pixelSize: 7, color: col(HEX.fireSoft), outlineColor: col(HEX.bg), outlineWidth: 1 }) });
  }

  // Resize and move the fire, cones and reporter line for step k.
  function applyStep(k, acres, nSteps) {
    const f = fireShape(acres, k, nSteps);
    const outline = fireOutline(f);
    E.fireFill.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(outline));
    E.fireEdge.polyline.positions = posList(closed(outline));

    // Soft glow at the fire head.
    const glowR = (0.1 + f.b * 0.8) * METERS_PER_MILE;
    const headPos = pos(fireFrame(f.head - f.a * 0.1, 0));
    E.glowInner.position = headPos;
    E.glowInner.ellipse.semiMajorAxis = glowR;
    E.glowInner.ellipse.semiMinorAxis = glowR;
    E.glowOuter.position = headPos;
    E.glowOuter.ellipse.semiMajorAxis = glowR * 1.6;
    E.glowOuter.ellipse.semiMinorAxis = glowR * 1.6;

    for (const c of CONES) {
      const cone = coneOutline(f, c);
      E[c.key].fill.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(cone.pts));
      E[c.key].edge.polyline.positions = posList(closed(cone.pts));
      E[c.key].label.position = pos(cone.labelAt);
      const on = k >= 1;   // forecast starts once a fire is suspected (1:51)
      E[c.key].fill.show = E[c.key].edge.show = E[c.key].label.show = on;
    }

    E.reporterLine.polyline.positions = posList([REPORTER, fireFrame(f.c, 0)]);
    E.route.show = k >= 6;           // Brush 1 leaves at 2:04
    E.breakGroup.show = k >= 5;      // rancher starts the disc line at 1:59
    E.reporterGroup.show = k >= 5;   // neighbor photo at 1:59
  }

  function apply(u) {
    for (const key in layers) layers[key].show = !!u.layers[key];
    setWindVisible(u.layers.wind !== false);
    if (u.k !== lastStep) { applyStep(u.k, u.acres, u.nSteps); lastStep = u.k; }
  }


  /* ---------- 7. Wind streaks and compass ---------- */

  // The streaks are a fixed pool of polylines in ONE PolylineCollection.
  // Each frame we only move them; nothing is created or destroyed.
  const wind = {
    on: true, collection: null, streaks: [], gusts: [], domain: null,
    normalMat: null, gustMat: null,
    t0: 0, nextGust: 0, gustStart: -1, heights: null,
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

  // Map [east, north] -> wind frame [along (downwind), across (to the right)].
  const toWindFrame = p => [p[0] * SIN_B + p[1] * COS_B, p[0] * COS_B - p[1] * SIN_B];

  function insideDistrict(p) {
    let inside = false;
    const c = DISTRICT_CORNERS;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      if ((c[i][1] > p[1]) !== (c[j][1] > p[1]) &&
          p[0] < ((c[j][0] - c[i][0]) * (p[1] - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) inside = !inside;
    }
    return inside;
  }

  // District bounding box in the wind frame (streaks wrap around inside it).
  function windDomain() {
    const w = DISTRICT_CORNERS.map(toWindFrame);
    const al = w.map(q => q[0]), ac = w.map(q => q[1]);
    return { aMin: Math.min(...al) - 1, aMax: Math.max(...al) + 1, cMin: Math.min(...ac), cMax: Math.max(...ac) };
  }

  // Terrain heights on a 0.5-mile grid over the district, sampled once.
  // Streaks read heights from this grid so they follow the hills cheaply.
  const HGRID = { e0: -10.5, n0: -11.5, step: 0.5, cols: 51, rows: 42 };
  async function sampleWindHeights(terrainProvider) {
    const pts = [];
    for (let r = 0; r < HGRID.rows; r++) for (let c = 0; c < HGRID.cols; c++) {
      const [lon, lat] = lonLat([HGRID.e0 + c * HGRID.step, HGRID.n0 + r * HGRID.step]);
      pts.push(Cesium.Cartographic.fromDegrees(lon, lat));
    }
    try {
      const out = await Cesium.sampleTerrainMostDetailed(terrainProvider, pts);
      wind.heights = Float32Array.from(out, q => (Number.isFinite(q.height) ? q.height : targetHeightM));
    } catch (e) { /* keep the flat fallback height */ }
  }
  function heightAt(e, n) {
    const H = wind.heights;
    if (!H) return targetHeightM;
    const x = Math.min(Math.max((e - HGRID.e0) / HGRID.step, 0), HGRID.cols - 1.001);
    const y = Math.min(Math.max((n - HGRID.n0) / HGRID.step, 0), HGRID.rows - 1.001);
    const c = Math.floor(x), r = Math.floor(y), fx = x - c, fy = y - r, i = r * HGRID.cols + c;
    return (H[i] * (1 - fx) + H[i + 1] * fx) * (1 - fy) + (H[i + HGRID.cols] * (1 - fx) + H[i + HGRID.cols + 1] * fx) * fy;
  }
  function windPos(p) {
    const [lon, lat] = lonLat(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat, heightAt(p[0], p[1]) * LOOK.verticalExaggeration + WIND.liftM);
  }

  function buildWind() {
    const D = windDomain();
    wind.domain = D;
    wind.normalMat = streakMaterial(WIND.alpha);
    wind.gustMat = streakMaterial(0);
    wind.collection = viewer.scene.primitives.add(new Cesium.PolylineCollection());

    // Evenly spaced grid with random jitter, so it looks natural.
    for (let ac = D.cMin; ac < D.cMax; ac += WIND.spacingAcrossMi) {
      for (let al = D.aMin; al < D.aMax; al += WIND.spacingAlongMi) {
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
    wind.t0 = performance.now() / 1000;
    wind.nextGust = 3;
    viewer.scene.preUpdate.addEventListener(windTick);
    viewer.scene.postRender.addEventListener(updateCompass);
  }

  // Place one streak for time t. Hidden if any part is outside the district.
  function placeStreak(s, t) {
    const D = wind.domain, span = D.aMax - D.aMin;
    const raw = s.along0 + s.speed * t - D.aMin;
    const head = D.aMin + (((raw % span) + span) % span);
    const across = s.across + 0.08 * Math.sin(t * 0.6 + s.phase);   // gentle sway
    const hp = fireFrame(head, across), tp = fireFrame(head - s.len, across);
    const show = insideDistrict(hp) && insideDistrict(tp);
    s.line.show = show;
    if (show) s.line.positions = [windPos(tp), windPos(hp)];
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
      g.along0 = center[0] + (Math.random() - 0.5) * 2 * WIND.gustRadiusMi - g.speed * t;
    }
    wind.gustStart = t;
    wind.nextGust = t + WIND.gustEveryMin + Math.random() * (WIND.gustEveryMax - WIND.gustEveryMin);
  }

  function windTick() {
    if (!wind.on) return;
    const t = performance.now() / 1000 - wind.t0;
    for (const s of wind.streaks) placeStreak(s, t);

    if (t >= wind.nextGust) startGust(t);
    const p = wind.gustStart < 0 ? 1 : (t - wind.gustStart) / WIND.gustSeconds;
    const gustOn = p < 1;
    wind.gustMat.uniforms.color.alpha = gustOn ? WIND.gustAlpha * Math.sin(Math.PI * p) : 0;  // fade in, then out
    for (const g of wind.gusts) {
      if (gustOn) placeStreak(g, t); else g.line.show = false;
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
    if (compassEl) {
      compassEl.hidden = !on;
      wind.lastHeading = NaN;   // force a redraw of the arrow when shown again
    }
  }


  /* ---------- 8. Camera ---------- */

  function resetView(duration = 1.5) {
    if (!ready) return;
    const [lon, lat] = lonLat(CAMERA.target);
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, targetHeightM);
    viewer.camera.cancelFlight();
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 0), {
      offset: new Cesium.HeadingPitchRange(rad(CAMERA.headingDeg), rad(CAMERA.pitchDeg), CAMERA.rangeM),
      duration
    });
  }


  /* ---------- 9. Messages over the map (missing token, loading, errors) ---------- */

  function showMsg(title, detail, loading) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.classList.toggle('loading', !!loading);
    msgEl.innerHTML = `<div class="mapmsg-title">${title}</div>${detail ? `<div class="mapmsg-detail">${detail}</div>` : ''}`;
  }
  function hideMsg() { if (msgEl) msgEl.hidden = true; }


  /* ---------- 10. Startup ---------- */

  async function init({ container, credits, message, compass }) {
    msgEl = message;
    compassEl = compass;

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

    // Labels are drawn once onto a canvas, so the font must be loaded first.
    try { await Promise.all([document.fonts.load(FONT), document.fonts.load(FONT_BOLD)]); } catch (e) { /* fall back to sans-serif */ }

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
      const [lon, lat] = lonLat(CAMERA.target);
      const [s] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [Cesium.Cartographic.fromDegrees(lon, lat)]);
      if (s && Number.isFinite(s.height)) targetHeightM = s.height;
    } catch (e) { /* keep the default height */ }

    buildEntities();
    buildWind();
    sampleWindHeights(terrainProvider);   // async; streaks use a flat height until it finishes
    ready = true;
    // Show the latest dashboard state (render() runs before the map is ready).
    apply(pending || { k: 0, acres: '0', nSteps: 8, layers: {} });
    pending = null;
    resetView(0);
    hideMsg();
  }

  // Called by index.html on every render. Cheap: only touches entities.
  function update(u) {
    if (!ready) { pending = u; return; }
    apply(u);
  }

  window.Map3D = { init, update, resetView: () => resetView(1.5) };
})();
