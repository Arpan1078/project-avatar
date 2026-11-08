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
       layers:      { spread, houses, water, stations, power, burns, risk, wind, sat, help }  chip on/off
       view:        'district' | 'burn'          which CAMERAS preset to use
       wind:        { towardDeg, mph }           direction the wind blows TO, speed
       fires: {
         A: { place, acres, type, path, card } | null   main fire; path = show the "Likely path, next hour" zone
         B: { place, acres, type, card } | null         a second fire (e.g. the planned burn)
       }
         place = a key of PLACES; type = a key of FIRE_TYPES (fire-types.js), default 'wildfire'
         card = { tone: a FIRE_TYPES key | 'cream', title, sub }
         (sub 'lineDistance' = live distance of the fire head from the power line)
       firebreak, reporter, route, lineFault, burnArea:  true/false
       burnAreaTone: 'planned' | 'escaped'       registered area outline: amber, or red once broken
       homesCard:   { title, sub } | null        card over the homes in the path
       goes:        GOES detections from satellite.js (drawn as soft ~2 km heat glows)
       firms:       FIRMS VIIRS hotspots from satellite.js (drawn as ~375 m squares + ring)
       help:        { from: [e, n] | null, status: { deptId: 'available'|'headsup'|'busy' }, lineTo: [deptId] }
                    real fire departments: status dots, dashed lines from `from` to `lineTo`
     }
   Real buildings are "in the path" when they are inside fire A's likely-path
   zone (or inside the fire itself). Map3D.pathHomes(fireA, towardDeg) gives
   the same answer to the dashboard (homes only), so the counts match the map.

   WHAT IS REAL AND WHAT IS SIMULATED
   Real (data/*.geojson via mapdata.js): water, creeks, power lines, roads
   (the station route), buildings, towns and fire departments.
   Simulated (story.js): the fire start (on a real power line), the district
   station, the planned burn, the neighbor, the water truck, the district
   boundary and the weekend burns.

   HOW TO MOVE THINGS
   Story positions are in MILES EAST and MILES NORTH of the fire start,
   written as [east, north] (negative east = west, negative north = south).
   They are all in story.js. Moving ORIGIN moves the whole story; the real
   data then needs re-downloading for the new area (scripts/fetch-data.py).
   Fire shapes and the firebreak are built in the WIND FRAME: "along" =
   miles downwind of the fire's start point, "across" = miles to the right.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Anchor point and unit conversion ---------- */

  // The story's anchor (the fire start on a real power line) and every story
  // position come from story.js; the real map features come from mapdata.js
  // (data/*.geojson). Positions are miles [east, north] of the fire start.
  const STORY = window.STORY;
  const MD = window.MapData;
  const regional = !!(window.RegionalMap && RegionalMap.active);
  const ORIGIN = STORY.ORIGIN;
  const METERS_PER_MILE = STORY.METERS_PER_MILE;
  const METERS_PER_DEG_LAT = STORY.METERS_PER_DEG_LAT;

  // [east, north] in miles  ->  [lon, lat] in degrees.
  const lonLat = STORY.toLonLat;
  // [east, north] in miles -> Cesium position (height 0; entities are
  // clamped to the terrain, so the height is ignored).
  function pos(p) {
    const [lon, lat] = lonLat(p);
    return Cesium.Cartesian3.fromDegrees(lon, lat);
  }
  const posList = list => list.map(pos);
  const posLL = ll => Cesium.Cartesian3.fromDegrees(ll[0], ll[1]);


  /* ---------- 2. Map features ---------- */

  // Simulated story positions (story.js).
  const DISTRICT_CORNERS = STORY.DISTRICT_CORNERS;
  const STATION = STORY.STATION;
  const REPORTER = STORY.REPORTER;
  const BURNS = STORY.BURNS;
  const SECTION_22 = STORY.SECTION_22;
  const PLACES = STORY.PLACES;
  const CAMERAS = STORY.CAMERAS;

  // Real features (mapdata.js): drawing settings.
  const REAL = {
    water: { fill: '#A8D4F2', alpha: 0.85, edge: '#6FAED9', edgeWidth: 1.5 },
    creek: { color: '#7FBDEB', alpha: 0.9, width: 1.5 },
    power: { color: '#EDE3CF', alpha: 0.85, width: 2, transmissionWidth: 2.8, poleEveryMi: 0.5, riskHalfWidthMi: 0.55 },
    building: { size: 6 },
    // Real fire departments ("Help nearby"): status dot colors, how many get a
    // dashed line from the fire, and how many get an edge arrow when off screen.
    // (Status colors: STORY.HELP_STATUS in story.js.)
    help: { lines: 3, arrows: 6, labelMaxDistanceM: 140000 },
    waterLabelMaxDistanceM: 30000
  };

  // Wind (defaults; each scenario sets its own direction and speed).
  // The fire shapes, likely-path zone, streaks and compass all follow the
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

  // "Likely path, next hour": one zone from the HEAD of fire A, pointing
  // downwind. The facts panel says the head moves 2 to 3 mph, so ~2.5 mi in 60 min.
  // widen/extraMi: half-width at the far edge = fire half-width * widen + extraMi.
  const ZONE = {
    label: 'Likely path, next hour',
    aheadMi: 2.5, widen: 2.4, extraMi: 0.6, pastBarrierMi: 0.15,
    color: '#F26B2E', fill: 0.17, edge: 0.75, edgeWidth: 1.5, z: 3
  };

  // Firebreak the rancher discs (Cottonwood Creek fire, from 1:59). WIND FRAME:
  // it runs across the fire's path, perpendicular to the wind, between the fire
  // head (~1.5 mi downwind at 2:22) and the real buildings ~2.0 to 2.4 mi downwind.
  const FIREBREAK_WIND = { alongMi: 1.85, halfLengthMi: 0.75, wobbleMi: 0.025 };

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
  // GOES heat glow color by fire mask: low = pale yellow, medium = amber,
  // high = orange, processed / saturated = orange-red with a brighter center
  // (cloud-contaminated = muted amber).
  const GOES_MASK_COLOR = { 15: '#F5E08A', 14: '#F2A93A', 13: '#F26B2E', 10: '#FF4A1C', 11: '#FF4A1C', 12: '#B9A27A' };
  const GOES_HOT_MASKS = [10, 11];
  // Glow shape. The glow is a soft round blob centered on the pixel, fully
  // transparent at radiusFactor x the pixel size (2 km). Neighboring pixels
  // (2 km apart) overlap enough that they blend into one patch, with no seam.
  const GOES_GLOW = {
    radiusFactor: 1.0,     // glow radius = 1 pixel width (it fades long before that)
    peakAlpha: 0.38,       // translucent, so the fire and terrain show through
    sigma: 0.46,           // softness (share of the radius)
    hotCenter: '#FFD27A',  // brighter center for processed / saturated fire
    hitRadiusFactor: 0.6   // click / hover counts within 0.6 x radius of the center (or inside the pixel)
  };
  const fireType = key => (window.FIRE_TYPES && window.FIRE_TYPES[key]) || window.FIRE_TYPES.wildfire;
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

  // Simplified road-crossing heuristic, not a validated spread model.
  // OSM road classes do not establish surface, width, or ability to stop fire.
  const BARRIER_TYPES = ['primary', 'secondary', 'tertiary', 'unclassified'];
  let barrierSegs = null;
  const barrierCache = new Map();
  function barrierName(r) { return r.name || 'Unnamed mapped road'; }
  // The first barrier road crossed by the line from the fire head, straight
  // downwind, within the likely-path length. { along (miles from the head), name, type } or null.
  function barrierAhead(g) {
    if (!MD.loaded) return null;
    const key = g.origin.join() + '|' + SIN_B.toFixed(5) + ',' + COS_B.toFixed(5) + '|' + g.head[0].toFixed(3) + ',' + g.head[1].toFixed(3);
    if (barrierCache.has(key)) return barrierCache.get(key);
    if (!barrierSegs) {
      barrierSegs = [];
      for (const r of MD.roads) {
        if (!BARRIER_TYPES.includes(r.type)) continue;
        for (const part of r.parts) for (let i = 1; i < part.length; i++) {
          barrierSegs.push({ a: STORY.toLocal(part[i - 1][0], part[i - 1][1]), b: STORY.toLocal(part[i][0], part[i][1]), road: r });
        }
      }
    }
    const H = g.head, dx = SIN_B, dy = COS_B;
    let best = null;
    for (const s of barrierSegs) {
      const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 0.25 * Math.hypot(ex, ey)) continue; // reject near-parallel crossings
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.a[0] - H[0]) * ey - (s.a[1] - H[1]) * ex) / den;     // miles along the wind
      const u = ((s.a[0] - H[0]) * dy - (s.a[1] - H[1]) * dx) / den;     // 0..1 along the road segment
      if (t > 0.02 && t <= ZONE.aheadMi && u >= 0 && u <= 1 && (!best || t < best.along)) {
        best = { along: t, name: barrierName(s.road), type: s.road.type, at: [H[0] + dx * t, H[1] + dy * t] };
      }
    }
    if (barrierCache.size > 200) barrierCache.clear();
    barrierCache.set(key, best);
    return best;
  }

  // Likely-path zone from the fire head out to a curved front edge. It starts
  // a little behind the tip and as wide as the fire, so it overlaps the head
  // (it is drawn under the fire) and homes right beside the head count as in the path.
  function zoneGeometry(g) {
    const [h0, hc] = g.headW, o = g.origin;
    const base = Math.max(g.s.b, 0.04);
    const start = h0 - g.s.a * 0.3;
    // The zone ends just past the first barrier road ("Fire expected to slow here").
    const barrier = barrierAhead(g);
    const ahead = barrier ? Math.min(ZONE.aheadMi, barrier.along + ZONE.pastBarrierMi) : ZONE.aheadMi;
    const far = h0 + ahead;
    const hw = g.s.b * ZONE.widen + ZONE.extraMi * (ahead / ZONE.aheadMi);
    const front = [];
    for (let j = 0; j <= 12; j++) {
      const u = -1 + j / 6;                       // -1 .. 1 across the front
      front.push(fireFrame(far - 0.25 * hw * u * u, hc + hw * u, o));
    }
    const left = fireFrame(start, hc - base, o), right = fireFrame(start, hc + base, o);
    return {
      fill: [left].concat(front, [right]),
      edge: [left].concat(front, [right]),   // open: no line across the fire head
      tip: fireFrame(far + 0.08, hc, o),     // label spot just past the outer edge
      barrier, clipped: !!barrier && ahead < ZONE.aheadMi
    };
  }

  // What drives the forecast, for the dashboard panel: the barrier ahead and
  // the slope (terrain height at the fire start vs 1 mile downwind). Pure math,
  // works without a token; slope is null until the terrain heights are sampled.
  function forecast(specFire, towardDeg) {
    if (regional) return null; // Dixie spread/forecast is Phase 3.
    if (!MD.loaded) return null;
    const spec = specFire && PLACES[specFire.place] ? specFire : { place: 'line', acres: 0 };
    const keep = WIND.towardDeg;
    setBearing(towardDeg ?? keep);
    const g = fireGeometry(fireSize(spec.acres), PLACES[spec.place]);
    const barrier = spec.path ? barrierAhead(g) : null;
    let slopePct = null;
    if (heights) {
      const o = g.origin, q = [o[0] + SIN_B, o[1] + COS_B];            // 1 mile downwind
      if (hasTerrain(o) && hasTerrain(q)) slopePct = ((heightAt(q[0], q[1]) - heightAt(o[0], o[1])) / METERS_PER_MILE) * 100;
    }
    setBearing(keep);
    return { barrier, slopePct };
  }

  // Distance (miles) from a point to the nearest real power line.
  const distanceToPowerLine = p => MD.distanceToPower(p);

  // Is point p inside polygon c (both in [east, north] miles)?
  function insidePolygon(p, c) {
    let inside = false;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      if ((c[i][1] > p[1]) !== (c[j][1] > p[1]) &&
          p[0] < ((c[j][0] - c[i][0]) * (p[1] - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) inside = !inside;
    }
    return inside;
  }
  const insideDistrict = p => insidePolygon(p, DISTRICT_CORNERS);

  // Real buildings in the path of fire A (indices into MapData.buildings):
  // inside its likely-path zone, or inside the fire itself. Pure math, so it
  // also works without a token. Uses the fire's final size for the step.
  //   pathBuildings: every building in the path (drawn orange)
  //   pathHomes:     only those that count as homes (houses + unlabeled buildings)
  function pathBuildings(specA, towardDeg) {
    if (regional) return []; // No structures-at-risk forecast in geography-only mode.
    if (!specA || !specA.path || !PLACES[specA.place] || !MD.loaded) return [];
    const keep = WIND.towardDeg;
    setBearing(towardDeg ?? keep);
    const g = fireGeometry(fireSize(specA.acres), PLACES[specA.place]);
    const zone = zoneGeometry(g).fill;
    setBearing(keep);
    const box = bboxOf(zone.concat(g.outline));
    const out = [];
    MD.buildings.forEach((b, i) => {
      const [x, y] = b.p;
      if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return;
      if (insidePolygon(b.p, zone) || insidePolygon(b.p, g.outline)) out.push(i);
    });
    return out;
  }
  const pathHomes = (specA, towardDeg) => pathBuildings(specA, towardDeg).filter(i => MD.buildings[i].home);
  function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  }

  // Points every `step` miles along a polyline (pole dots).
  function alongLine(pts, step) {
    const out = [];
    let carry = step / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let t = carry;
      while (t <= L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; }
      carry = t - L;
    }
    return out;
  }
  // Left and right copies of a polyline, `d` miles to each side (for the risk band).
  function offsetLine(pts, d) {
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L * d, ny = dx / L * d;
      left.push([pts[i][0] + nx, pts[i][1] + ny]);
      right.push([pts[i][0] - nx, pts[i][1] - ny]);
    }
    return [left, right];
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

  // Small fire station icon: a dark house shape with a cream outline and an orange flame.
  function fireStationIcon() {
    return canvas(18, 18, g => {
      g.beginPath();
      g.moveTo(9, 1.5); g.lineTo(16.5, 7.5); g.lineTo(16.5, 16.5); g.lineTo(1.5, 16.5); g.lineTo(1.5, 7.5); g.closePath();
      g.fillStyle = '#221E19'; g.fill();
      g.strokeStyle = HEX.cream; g.lineWidth = 1.5; g.stroke();
      g.beginPath();
      g.moveTo(9, 6.5); g.bezierCurveTo(12, 9.5, 12.5, 11.5, 11.8, 13.2); g.bezierCurveTo(11, 15.2, 7, 15.2, 6.2, 13.2);
      g.bezierCurveTo(5.6, 11.6, 6.8, 10.4, 7.6, 9.4); g.bezierCurveTo(7.9, 10.6, 8.4, 11, 8.9, 11.2); g.bezierCurveTo(9.4, 9.8, 9.4, 8.2, 9, 6.5);
      g.fillStyle = HEX.fire; g.fill();
    });
  }

  // Small quadcopter icon (top view): X frame, four rotors, a body, on a dark halo.
  function droneIcon(color) {
    return canvas(24, 24, g => {
      g.fillStyle = 'rgba(21, 18, 15, 0.7)';
      g.beginPath(); g.arc(12, 12, 11, 0, Math.PI * 2); g.fill();
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(6, 6); g.lineTo(18, 18); g.moveTo(18, 6); g.lineTo(6, 18); g.stroke();
      g.lineWidth = 1.4;
      for (const [x, y] of [[5.5, 5.5], [18.5, 5.5], [5.5, 18.5], [18.5, 18.5]]) { g.beginPath(); g.arc(x, y, 3.3, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.arc(12, 12, 2.8, 0, Math.PI * 2); g.fill();
    });
  }

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


  // Soft round heat glow for a GOES pixel: a Gaussian blob that reaches fully
  // transparent at the edge. `hot` adds a brighter center (processed / saturated).
  const glowTextures = {};
  function goesGlowTexture(hex, hot) {
    const key = hex + (hot ? '*' : '');
    if (glowTextures[key]) return glowTextures[key];
    const N = 128, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    const base = Cesium.Color.fromCssColorString(hex), core = Cesium.Color.fromCssColorString(GOES_GLOW.hotCenter);
    const s2 = 2 * GOES_GLOW.sigma * GOES_GLOW.sigma;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);   // 0 center .. 1 edge
      let a = 0, r = base.red, gr = base.green, b = base.blue;
      if (u < 1) {
        const t = Math.min(1, Math.max(0, (u - 0.75) / 0.25));
        a = GOES_GLOW.peakAlpha * Math.exp(-(u * u) / s2) * (1 - t * t * (3 - 2 * t));   // fade to 0 at the edge
        if (hot) {
          const h = Math.exp(-(u * u) / (2 * 0.16 * 0.16));
          r += (core.red - r) * h; gr += (core.green - gr) * h; b += (core.blue - b) * h;
          a = Math.min(0.6, a * (1 + 0.3 * h));
        }
      }
      const i = (y * N + x) * 4;
      img.data[i] = r * 255; img.data[i + 1] = gr * 255; img.data[i + 2] = b * 255; img.data[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    return (glowTextures[key] = c);
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
  const HGRID = { e0: -11.5, n0: -15.0, step: 0.5, cols: 52, rows: 42 };   // -11.5..14 mi east, -15..5.5 mi north
  let heights = null, validHeights = null;
  function hasTerrain(p) {
    if (!validHeights) return false;
    const x = (p[0] - HGRID.e0) / HGRID.step, y = (p[1] - HGRID.n0) / HGRID.step;
    if (x < 0 || y < 0 || x >= HGRID.cols - 1 || y >= HGRID.rows - 1) return false;
    const i = Math.floor(y) * HGRID.cols + Math.floor(x);
    return [i, i + 1, i + HGRID.cols, i + HGRID.cols + 1].every(j => validHeights[j]);
  }
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
      validHeights = Uint8Array.from(out, q => Number.isFinite(q.height) ? 1 : 0);
      heights = Float32Array.from(out, q => (Number.isFinite(q.height) ? q.height : targetHeightM));
      for (const id in slots) slots[id].emberA = NaN;   // re-seat embers on the real terrain
      window.dispatchEvent(new Event('map3d-heights'));  // the dashboard can now measure the slope
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
    for (const key of ['spread', 'houses', 'water', 'stations', 'power', 'burns', 'risk', 'sat', 'help']) {
      layers[key] = add({ id: 'layer-' + key });
    }
    // Groups switched by the scenario / step, not by a chip.
    E.breakGroup = add({ id: 'step-firebreak' });
    E.reporterGroup = add({ id: 'step-reporter' });
    E.burnAreaGroup = add({ id: 'burn-area', parent: layers.burns });

    // --- District boundary (always on) ---
    add({ polyline: groundLine(closed(DISTRICT_CORNERS), col(HEX.cream, 0.55), 2, { length: 16 }) });

    // --- Real power lines (mapdata.js), with small pole dots ---
    // The line the fire starts on is the one nearest the fire start.
    E.fireLine = null;
    let fireLineDist = Infinity;
    for (const line of MD.power) {
      const width = line.transmission ? REAL.power.transmissionWidth : REAL.power.width;
      for (const part of line.parts) {
        add({ parent: layers.power, polyline: { positions: part.map(posLL), clampToGround: true, width, zIndex: 2, material: col(REAL.power.color, REAL.power.alpha) } });
      }
      for (const part of line.local) {
        for (const q of alongLine(part, REAL.power.poleEveryMi)) {
          add({ parent: layers.power, position: pos(q), point: Object.assign(ON_GROUND(), { pixelSize: 4, color: col(REAL.power.color), outlineColor: col(HEX.bg), outlineWidth: 1 }) });
        }
        for (const q of part) { const d = Math.hypot(q[0], q[1]); if (d < fireLineDist) { fireLineDist = d; E.fireLine = line; } }
      }
    }

    // --- Fire risk today: band along the power line the fire starts on (inside the district) ---
    E.riskLabelAt = null;
    if (E.fireLine) {
      const box = bboxOf(DISTRICT_CORNERS);
      for (const part of E.fireLine.local) {
        const pieces = [];
        let cur = [];
        for (const q of part) {
          const inBox = q[0] >= box[0] && q[0] <= box[2] && q[1] >= box[1] && q[1] <= box[3];
          if (inBox) cur.push(q); else if (cur.length) { pieces.push(cur); cur = []; }
        }
        if (cur.length) pieces.push(cur);
        for (const piece of pieces.filter(x => x.length > 1)) {
          const [left, right] = offsetLine(piece, REAL.power.riskHalfWidthMi);
          add({ parent: layers.risk, polygon: { hierarchy: posList(left.concat(right.slice().reverse())), material: col(HEX.brk, 0.13), zIndex: 0 } });
          add({ parent: layers.risk, polyline: groundLine(left, col(HEX.brk, 0.4), 1.5, { length: 8 }) });
          add({ parent: layers.risk, polyline: groundLine(right, col(HEX.brk, 0.4), 1.5, { length: 8 }) });
          if (!E.riskLabelAt) E.riskLabelAt = right[Math.floor(right.length * 0.3)];
        }
      }
      // Label spot for the line: on the line, about 3 mi south of the fire.
      E.powerLabelAt = E.fireLine.local.flat().reduce((b, q) => (Math.hypot(q[0], q[1] + 3) < Math.hypot(b[0], b[1] + 3) ? q : b));
    }

    // --- Permitted burns (simulated weekend burns) ---
    for (const b of BURNS) {
      add({ parent: layers.burns, position: pos(b.at), ellipse: { semiMajorAxis: b.radiusMi * METERS_PER_MILE, semiMinorAxis: b.radiusMi * METERS_PER_MILE, material: col(HEX.burn, 0.35), zIndex: 1 } });
      add({ parent: layers.burns, polyline: groundLine(closed(circle(b.at, b.radiusMi)), col(HEX.muted), 1.5, { length: 8 }) });
    }
    // Registered burn area (Planned burn scenario): dashed square, amber while
    // the burn follows its registration, red once it breaks it (burnAreaTone).
    add({ parent: E.burnAreaGroup, polygon: { hierarchy: posList(SECTION_22_CORNERS), material: col(HEX.burn, 0.22), zIndex: 1 } });
    E.burnAreaEdge = add({ parent: E.burnAreaGroup, polyline: groundLine(closed(SECTION_22_CORNERS), col(fireType('planned').color), 2, { length: 10 }, 1) });
    E.burnAreaTone = 'planned';

    // --- District station (simulated) and its route to the fire on real roads ---
    add({ parent: layers.stations, position: pos(STATION), billboard: billboard(squareIcon(18, HEX.cream, null, 1)) });
    E.route = add({ parent: layers.stations, polyline: groundLine(MD.route ? MD.route.points : [STATION, PLACES.line],
      col(HEX.cream, 0.95), 3, { length: 12, pattern: 0xF0F0 }, 2) });
    E.routeLabelAt = MD.route ? MD.route.points[Math.floor(MD.route.points.length * 0.45)] : STATION;

    // --- Real fire departments ("Help nearby"): icon per station, dashed lines to the fire ---
    const stationIcon = fireStationIcon();
    E.depts = MD.departments.map(d => add({ parent: layers.help, position: posLL(d.ll), billboard: billboard(stationIcon) }));
    E.helpLines = [];
    for (let i = 0; i < REAL.help.lines; i++) {
      E.helpLines.push(add({ parent: layers.help, show: false, polyline: groundLine(PLACEHOLDER, col(HEX.cream, 0.75), 1.5, { length: 14 }, 2) }));
    }

    // --- County drone (simulated): icon, dashed path from its town, camera footprint on arrival ---
    // The dashboard describes it in the map state (u.drone); droneTick() moves it.
    E.droneIcons = { grounded: droneIcon('#999999'), active: droneIcon(HEX.cream) };
    E.drone = add({ parent: layers.help, show: false, position: pos([0, 0]), billboard: billboard(E.droneIcons.grounded) });
    E.dronePath = add({ parent: layers.help, show: false, polyline: groundLine(PLACEHOLDER, col(HEX.cream, 0.8), 1.5, { length: 10 }, 3) });
    E.droneView = add({ parent: layers.help, show: false, polygon: { hierarchy: posList(PLACEHOLDER), material: col(HEX.cream, 0.14), zIndex: 4 } });
    E.droneViewEdge = add({ parent: layers.help, show: false, polyline: groundLine(PLACEHOLDER, col(HEX.cream, 0.9), 1.5, { length: 6 }, 5) });
    E.droneNow = null;                                  // current position [east, north] (for the label and click)
    E.droneAnim = { cur: 0, from: 0, to: 0, t0: 0, img: '', pathKey: '', viewKey: '' };
    viewer.scene.preUpdate.addEventListener(droneTick);

    // --- Real buildings (orange when in the likely path, see pathBuildings) ---
    const s = REAL.building.size;
    E.homeIcons = { path: squareIcon(s, HEX.fireSoft, HEX.fire, 1.25), safe: squareIcon(s, HEX.cream, HEX.bg, 1) };
    E.homes = MD.buildings.map(b => add({ parent: layers.houses, position: posLL(b.ll), billboard: billboard(E.homeIcons.safe) }));
    E.homesPath = undefined;   // key of the current set
    E.pathHomes = [];          // indices of buildings in the path (all kinds)

    // --- Firebreak (Cottonwood Creek fire), across the wind ahead of the fire ---
    E.firebreak = add({ parent: E.breakGroup, polyline: groundLine(firebreakPoints(), col(HEX.brk), 4, { length: 18, pattern: 0xFFF0 }, 3) });

    // --- Real water: ponds, lakes, reservoirs (filled) and creeks (lines) ---
    for (const w of MD.water) {
      const ring = w.rings[0].map(posLL);
      const holes = w.rings.slice(1).map(r => new Cesium.PolygonHierarchy(r.map(posLL)));
      add({ parent: layers.water, polygon: { hierarchy: new Cesium.PolygonHierarchy(ring, holes), material: col(REAL.water.fill, REAL.water.alpha), zIndex: 7 } });
      add({ parent: layers.water, polyline: { positions: ring, clampToGround: true, width: REAL.water.edgeWidth, zIndex: 7, material: col(REAL.water.edge, 0.95) } });
    }
    for (const c of MD.creeks) {
      for (const part of c.parts) {
        add({ parent: layers.water, polyline: { positions: part.map(posLL), clampToGround: true, width: REAL.creek.width, zIndex: 1, material: col(REAL.creek.color, REAL.creek.alpha) } });
      }
    }

    // --- Neighbor photo report (Cottonwood Creek fire, from 1:59) ---
    E.reporterLine = add({ parent: E.reporterGroup, polyline: groundLine([REPORTER, [0, 0]], col(HEX.cream, 0.85), 1.5, { length: 8 }, 4) });
    add({ parent: E.reporterGroup, position: pos(REPORTER), point: Object.assign(ON_GROUND(), { pixelSize: 11, color: col(HEX.cream), outlineColor: col(HEX.bg), outlineWidth: 1 }) });

    // --- Satellite detections: fixed pools, filled from the map state ---
    // GOES: soft translucent heat glows (coarse, ~2 km), under the fire shapes.
    // FIRMS VIIRS: small bright squares (~375 m) with a white ring, so they
    // read as sharper and more precise.
    E.goes = [];
    for (let i = 0; i < 8; i++) {
      E.goes.push({
        glow: add({ parent: layers.sat, show: false, rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(ORIGIN.lon, ORIGIN.lat, ORIGIN.lon + 0.001, ORIGIN.lat + 0.001),
          material: new Cesium.ImageMaterialProperty({ image: goesGlowTexture(HEX.fire, false), transparent: true }), zIndex: 2 } }),
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
    if (E.droneAnim && (!u.drone || !u.drone.active || !cur || !cur.drone || cur.drone.id !== u.drone.id || u.drone.progress < cur.drone.progress)) {
      Object.assign(E.droneAnim, { cur: 0, from: 0, to: 0, t0: performance.now() / 1000 });
    }
    cur = u;
    for (const key in layers) layers[key].show = !!u.layers[key];
    setWindVisible(u.layers.wind !== false);

    // Wind direction and speed. A new direction re-shapes fires, the path zone and the firebreak.
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
    const areaTone = u.burnAreaTone === 'escaped' ? 'escaped' : 'planned';
    if (areaTone !== E.burnAreaTone) {
      E.burnAreaTone = areaTone;
      E.burnAreaEdge.polyline.material = new Cesium.PolylineDashMaterialProperty({
        color: col(fireType(areaTone).color), gapColor: Cesium.Color.TRANSPARENT, dashLength: 10 });
    }

    // Real buildings in the likely path of fire A turn orange.
    E.pathHomes = pathBuildings(u.fires.A, WIND.towardDeg);
    const homesKey = E.pathHomes.join();
    if (homesKey !== E.homesPath) {
      const before = new Set(E.homesPath ? E.homesPath.split(',').map(Number) : []), now = new Set(E.pathHomes);
      E.homesPath = homesKey;
      for (const i of new Set([...before, ...now])) E.homes[i].billboard.image = now.has(i) ? E.homeIcons.path : E.homeIcons.safe;
    }

    // Help nearby: dashed lines from the fire to the nearest available departments.
    const help = u.help || {};
    E.helpLines.forEach((line, i) => {
      const d = help.from && help.lineTo && MD.departments.find(x => x.id === help.lineTo[i]);
      line.show = !!d;
      if (d) line.polyline.positions = [pos(help.from), posLL(d.ll)];
    });

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
      g.glow.show = !!d;
      if (!d) return;
      const key = [d.latitude, d.longitude, d.fire_mask].join();
      if (key === g.key) return;
      g.key = key;
      // Glow square (2 x radius per side) centered on the pixel; the texture is round.
      const r = goesSizeM() * GOES_GLOW.radiusFactor;
      const dLat = r / METERS_PER_DEG_LAT, dLon = r / (METERS_PER_DEG_LAT * Math.cos(d.latitude * Math.PI / 180));
      g.glow.rectangle.coordinates = Cesium.Rectangle.fromDegrees(d.longitude - dLon, d.latitude - dLat, d.longitude + dLon, d.latitude + dLat);
      g.glow.rectangle.material = new Cesium.ImageMaterialProperty({
        image: goesGlowTexture(GOES_MASK_COLOR[d.fire_mask] || HEX.fire, GOES_HOT_MASKS.includes(d.fire_mask)), transparent: true });
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

  // Hover (mouse) or click (touch) a GOES glow / FIRMS point to see its fields in plain words.
  // Hit test on the ground (not object picking), so fires, the path zone or smoke
  // drawn on top of a glow never block it.
  const satInfo = { el: null, pinned: false, lastMove: 0, goes: [], firms: [] };

  function satAt(p) {
    if (!cur) return null;
    const scene = viewer.scene;
    // County drone: within ~14 px of its icon.
    if (cur.layers.help && cur.drone && E.droneNow) {
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, groundPos(E.droneNow), scratchWin);
      if (w && Math.hypot(w.x - p.x, w.y - p.y) < 14) return { html: `<b>County drone</b> <span class="muted">(simulated)</span><br>${cur.drone.info || ''}`, drone: true };
    }
    // Fire departments (Help nearby): within ~12 px of the station icon.
    if (cur.layers.help) {
      for (const d of MD.departments) {
        const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, groundPos(d.p), scratchWin);
        if (w && Math.hypot(w.x - p.x, w.y - p.y) < 12) return { html: deptCardHtml(d) };
      }
    }
    if (!cur.layers.sat) return null;
    // FIRMS first (small, on top): within ~10 px of the hotspot on screen.
    for (const h of satInfo.firms) {
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, groundPosLL(h.latitude, h.longitude), scratchWin);
      if (w && Math.hypot(w.x - p.x, w.y - p.y) < 10) return describe(h);
    }
    // GOES: is the ground point under the cursor inside a glow (or its pixel)?
    // Where glows overlap, the nearest pixel center wins.
    const hit = scene.globe.pick(scene.camera.getPickRay(p), scene);
    if (!hit) return null;
    const c = Cesium.Cartographic.fromCartesian(hit);
    const lat = Cesium.Math.toDegrees(c.latitude), lon = Cesium.Math.toDegrees(c.longitude);
    const half = goesSizeM() / 2, reach = goesSizeM() * GOES_GLOW.radiusFactor * GOES_GLOW.hitRadiusFactor;
    let best = null, bestDist = Infinity;
    for (const d of satInfo.goes) {
      const dy = (lat - d.latitude) * METERS_PER_DEG_LAT;
      const dx = (lon - d.longitude) * METERS_PER_DEG_LAT * Math.cos(d.latitude * Math.PI / 180);
      const dist = Math.hypot(dx, dy);
      if ((dist <= reach || (Math.abs(dx) <= half && Math.abs(dy) <= half)) && dist < bestDist) { best = d; bestDist = dist; }
    }
    return best ? describe(best) : null;
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
        if (text.html) satInfo.el.innerHTML = text.html; else satInfo.el.textContent = text;
        satInfo.el.hidden = false;
        const W = viewer.scene.canvas.clientWidth;
        const w = satInfo.el.offsetWidth;
        satInfo.el.style.left = Math.min(p.x + 14, W - w - 8) + 'px';
        satInfo.el.style.top = (p.y + 14) + 'px';
      } else if (click || !satInfo.pinned) {
        satInfo.el.hidden = true;
      }
      if (click) satInfo.pinned = !!text;
      // Clicking an active drone opens its video feed instead of pinning a card.
      if (click && text && text.drone && cur.drone && window.Map3D.onDroneClick) {
        satInfo.el.hidden = true; satInfo.pinned = false;
        window.Map3D.onDroneClick();
      }
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
  // smoke, and for slot A the likely-path zone). Slot A is the main fire
  // (Cottonwood Creek, or the escape); slot B is a second fire (the planned burn).
  // The edge, glow and embers take their colors from FIRE_TYPES (fire-types.js).
  function makeFireSlot(id, withZone) {
    const sl = {
      id, withZone, on: false, placeKey: null, origin: [0, 0], spec: null,
      size: null, from: null, to: null, t0: 0, lastGeomT: 0, geom: null, reshape: false,
      emberA: NaN, emberCount: 0, embers: [], smoke: [], zone: null,
      type: null, ft: fireType('wildfire'),
      // Edge colors; changed in place each frame when the type pulses.
      glowColor: col(fireType('wildfire').color, 0.85), coreColor: col(fireType('wildfire').color)
    };
    sl.group = add({ id: 'fire-' + id, show: false });
    sl.headGlow = add({ parent: sl.group, position: pos([0, 0]), ellipse: { semiMajorAxis: 1, semiMinorAxis: 1, material: col(HEX.fireEdge, 0.14), zIndex: 4 } });
    sl.fill = add({ parent: sl.group, polygon: { hierarchy: posList(PLACEHOLDER), zIndex: 6,
      material: new Cesium.ImageMaterialProperty({ image: smokyTexture(), transparent: true }) } });
    // Edge: a wide soft glow under a thin bright core line.
    sl.glow = add({ parent: sl.group, polyline: { positions: posList(PLACEHOLDER), clampToGround: true, width: 16, zIndex: 10,
      material: new Cesium.PolylineGlowMaterialProperty({
        color: new Cesium.CallbackProperty(() => sl.glowColor, false),
        glowPower: new Cesium.CallbackProperty(() => sl.ft.glow.power, false), taperPower: 1 }) } });
    sl.core = add({ parent: sl.group, polyline: Object.assign(groundLine(PLACEHOLDER, HEX.fireEdge, 2.5, null, 11),
      { material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => sl.coreColor, false)) }) });

    if (withZone) {
      sl.zone = {
        fill: add({ parent: layers.spread, show: false, polygon: { hierarchy: posList(PLACEHOLDER), material: col(ZONE.color, ZONE.fill), zIndex: ZONE.z } }),
        edge: add({ parent: layers.spread, show: false, polyline: groundLine(PLACEHOLDER, col(ZONE.color, ZONE.edge), ZONE.edgeWidth, { length: 12 }, 1) }),
        tip: [0, 0], pts: null
      };
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
        if (sl.zone) sl.zone.fill.show = sl.zone.edge.show = false;
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
    setFireType(sl, spec.type || 'wildfire');
    sl.on = true;
    sl.group.show = true;
    sl.emberColl.show = true;
    sl.smokeColl.show = true;
    if (sl.zone) sl.zone.fill.show = sl.zone.edge.show = !!spec.path;
  }

  // Colors and glow of one fire from its FIRE_TYPES entry.
  function setFireType(sl, type) {
    if (type === sl.type) return;
    sl.type = type;
    sl.ft = fireType(type);
    sl.glowColor = col(sl.ft.color, sl.ft.glow.alpha);
    sl.coreColor = col(sl.ft.color);
    sl.glow.polyline.width = sl.ft.glow.width;
    sl.headGlow.ellipse.material = col(sl.ft.color, 0.14);
    sl.emberColors = { ember: Cesium.Color.fromCssColorString(sl.ft.ember), hot: Cesium.Color.fromCssColorString(sl.ft.emberHot), edge: col(sl.ft.color, 0.3) };
    for (const em of sl.embers) em.point.outlineColor = sl.emberColors.edge;
  }

  // Update the ground shapes of one fire (fill, edge, head glow, zone).
  function setFireGeometry(sl, g) {
    sl.fill.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(g.outline));
    const ring = posList(closed(g.outline));
    sl.glow.polyline.positions = ring;
    sl.core.polyline.positions = ring;

    const glowR = (0.08 + g.s.b * 0.7) * METERS_PER_MILE;
    sl.headGlow.position = pos(fireFrame(g.headW[0] - g.s.a * 0.15, g.headW[1], g.origin));
    sl.headGlow.ellipse.semiMajorAxis = glowR;
    sl.headGlow.ellipse.semiMinorAxis = glowR;

    if (sl.zone) {
      // Forecast and counts use the same final step geometry while the fire grows.
      const zg = zoneGeometry(fireGeometry(sl.to, sl.origin));
      sl.zone.fill.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(zg.fill));
      sl.zone.edge.polyline.positions = posList(zg.edge);
      sl.zone.tip = zg.clipped ? zg.barrier.at : zg.tip;
      sl.zone.pts = zg.fill;
      sl.zone.clipped = zg.clipped;
    }
    if (sl.id === 'A') E.reporterLine.polyline.positions = posList([REPORTER, g.center]);
  }

  const scratchColor = new Cesium.Color();
  // Cheap hash -> 0..1, used for per-puff randomness that changes each cycle.
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const ease = t => t * t * (3 - 2 * t);

  // Drone: slides along its dashed path to the fire. A new progress value (a new
  // step) is reached in DRONE_TWEEN seconds, forward or back.
  const DRONE_TWEEN = 2.4;
  function droneTick() {
    const d = cur && cur.drone, a = E.droneAnim;
    E.drone.show = !!d;
    if (!d) { a.cur = a.from = a.to = 0; E.droneMoving = false; E.dronePath.show = E.droneView.show = E.droneViewEdge.show = false; E.droneNow = null; return; }
    const now = performance.now() / 1000;
    if (!d.active) a.cur = a.from = a.to = 0;
    if (a.to !== d.progress) { a.from = a.cur; a.to = d.progress; a.t0 = now; }
    const p = Math.min(1, (now - a.t0) / DRONE_TWEEN);
    a.cur = a.from + (a.to - a.from) * ease(p);
    const target = PLACES[d.toPlace] || PLACES.line, from = d.from;
    E.droneNow = [from[0] + (target[0] - from[0]) * a.cur, from[1] + (target[1] - from[1]) * a.cur];
    E.droneMoving = p < 1 && a.from !== a.to;
    E.drone.position = pos(E.droneNow);
    const img = d.active ? 'active' : 'grounded';
    if (a.img !== img) { a.img = img; E.drone.billboard.image = E.droneIcons[img]; }
    // Dashed path from the town to the fire (only while the drone is going there).
    const key = [from, target.map(x => x.toFixed(2))].join();
    E.dronePath.show = !!d.path;
    if (d.path && key !== a.pathKey) { a.pathKey = key; E.dronePath.polyline.positions = posList([from, target]); }
    // Camera footprint on the ground once it has arrived: a 16:9 rectangle facing the way it flew.
    const arrived = !!d.path && a.cur > 0.999 && d.onScene;
    E.droneView.show = E.droneViewEdge.show = arrived;
    if (arrived && key !== a.viewKey) {
      a.viewKey = key;
      const dx = target[0] - from[0], dy = target[1] - from[1], L = Math.hypot(dx, dy) || 1, f = [dx / L, dy / L], r = [f[1], -f[0]];
      const hl = 0.16, hw = 0.09, c = [];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push([target[0] + f[0] * hl * u + r[0] * hw * v, target[1] + f[1] * hl * u + r[1] * hw * v]);
      E.droneView.polygon.hierarchy = new Cesium.PolygonHierarchy(posList(c));
      E.droneViewEdge.polyline.positions = posList(c.concat([c[0]]));
    }
  }

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
      Cesium.Color.clone(em.hot ? sl.emberColors.hot : sl.emberColors.ember, scratchColor);
      scratchColor.alpha = 0.35 + 0.65 * f * g;
      em.point.color = scratchColor;
    }
    sl.emberA = s.a;
    sl.emberCount = visible;

    // Slow pulse of the edge (escaped burn): glow and core breathe together.
    const pulse = sl.ft.glow.pulseSeconds;
    if (pulse > 0) {
      const w = 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / pulse);   // 0..1
      sl.glowColor.alpha = sl.ft.glow.alpha * (0.35 + 0.65 * w);
      sl.coreColor.alpha = 0.6 + 0.4 * w;
    }

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
        return { tone: c.tone || 'wildfire', title: c.title, sub: c.sub === 'lineDistance' ? headText(sl) : c.sub };
      },
      at: () => (slots[id].on && slots[id].geom ? slots[id].geom.head : null)
    });

    // Cards, in placement priority order. pref = where the card sits relative to its point.
    card(Object.assign({ id: 'fireA', pref: ['left', 'up', 'right'], show: c => !!c.fires.A }, fireCard('A')));
    card(Object.assign({ id: 'fireB', pref: ['left', 'up', 'right'], show: c => !!c.fires.B }, fireCard('B')));
    card({ id: 'homes', pref: ['right', 'up', 'left'],
      show: c => L(c).houses && !!c.homesCard,
      text: () => ({ tone: 'cream', title: cur.homesCard.title, sub: cur.homesCard.sub }),
      at: () => (E.pathHomes.length ? centerOf(E.pathHomes.map(i => MD.buildings[i].p)) : null) });
    card({ id: 'station', pref: ['up', 'left', 'right'], show: c => L(c).stations,
      text: () => ({ tone: 'cream', title: STORY.STATION_NAME, sub: '18 on the roster, 5 who can leave work' }),
      at: () => STATION });

    // Small labels, highest priority first.
    // One label at the outer edge of the likely-path zone.
    tag({ tone: 'fire', html: () => (slots.A.zone.clipped ? 'Fire expected to slow here' : ZONE.label), at: () => slots.A.zone.tip,
      show: c => L(c).spread && !!c.fires.A && !!c.fires.A.path, pref: ['up', 'left', 'right', 'down'], far: 70000 });
    tag({ text: SECTION_22.label, tone: 'muted', at: () => [SECTION_22.center[0] - SECTION_22.halfMi, SECTION_22.center[1] - SECTION_22.halfMi],
      show: c => L(c).burns && c.burnArea, pref: ['down', 'left', 'up'], far: 70000 });
    tag({ text: 'Firebreak', tone: 'brk', at: () => firebreakPoints()[0], alt: () => firebreakPoints()[8], show: c => c.firebreak, pref: ['left', 'down', 'right', 'up'], far: 70000 });
    tag({ text: 'Neighbor photo, 1:59', tone: 'cream', at: () => REPORTER, show: c => c.reporter, pref: ['right', 'down', 'up'] });
    // Real fire departments: name, distance and drive time from the fire, status dot.
    for (const d of MD.departments) {
      tag({ dept: d, tone: 'cream', html: () => deptTagHtml(d), at: () => d.p, show: c => L(c).help, pref: ['right', 'left', 'down', 'up'],
        far: REAL.help.labelMaxDistanceM });
    }
    // County drone label (text from the dashboard; "en route" while it is moving).
    tag({ tone: 'cream', html: () => (E.droneMoving ? 'County drone: en route' : cur.drone.label), at: () => E.droneNow,
      show: c => L(c).help && !!c.drone, pref: ['right', 'left', 'down', 'up'], far: REAL.help.labelMaxDistanceM });
    // Drive time on each dashed help line (at its middle).
    E.helpLines.forEach((line, i) => tag({ tone: 'muted', html: () => (helpLineDept(i) ? `~${helpRow(helpLineDept(i)).minutes} min` : ''),
      at: () => { const d = helpLineDept(i); return d ? lerp(cur.help.from, d.p, 0.5) : null; },
      show: c => L(c).help && !!helpLineDept(i), pref: ['right', 'left', 'up', 'down'], far: REAL.help.labelMaxDistanceM }));
    tag({ tone: 'muted', html: () => (MD.route ? `${MD.route.miles.toFixed(0)} road miles to the fire` : 'Road to the fire'),
      at: () => E.routeLabelAt, show: c => L(c).stations && c.route, pref: ['left', 'right', 'down'] });
    tag({ tone: 'power', html: () => (E.fireLine ? E.fireLine.label : 'Power line'), at: () => E.powerLabelAt || null, show: c => L(c).power, pref: ['down', 'up', 'right', 'left'] });
    tag({ text: 'High risk today: power line over dry grass', tone: 'brk', at: () => E.riskLabelAt, show: c => L(c).risk, pref: ['down', 'up'] });
    for (const b of BURNS) tag({ text: b.label, tone: 'muted', at: () => [b.at[0], b.at[1] - b.radiusMi], show: c => L(c).burns, pref: ['down', 'right', 'left'] });
    // Names of real water features (only named ones), hidden when zoomed far out.
    for (const w of MD.water.filter(x => x.name)) {
      tag({ text: w.name, tone: 'water', at: () => w.center, show: c => L(c).water, pref: ['up', 'down', 'right', 'left'], far: REAL.waterLabelMaxDistanceM });
    }
    for (const c of MD.creeks.filter(x => x.name && x.labelAt)) {
      tag({ text: c.name, tone: 'water', at: () => c.labelAt, show: s => L(s).water, pref: ['right', 'left', 'up', 'down'], far: REAL.waterLabelMaxDistanceM });
    }

    // Edge arrows: the nearest departments that are off screen.
    labels.arrows = [];
    for (let i = 0; i < REAL.help.arrows; i++) {
      const el = document.createElement('div');
      el.className = 'edgearrow';
      el.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6 L10 6 M6 2 L10 6 L6 10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span></span>';
      el.style.display = 'none';
      labels.root.appendChild(el);
      labels.arrows.push({ el, svg: el.querySelector('svg'), text: el.querySelector('span'), key: '' });
    }

    viewer.scene.postRender.addEventListener(layoutLabels);
  }

  /* Help nearby: department rows and status (statuses are set by the dashboard). */
  const HELP_STATUS = Object.fromEntries(Object.entries(STORY.HELP_STATUS).map(([k, s]) => [k, { text: s.text, color: () => s.color }]));
  const helpFromPoint = () => (cur && cur.help && cur.help.from) || PLACES.line;
  function helpRow(d) {
    const mi = Math.hypot(d.p[0] - helpFromPoint()[0], d.p[1] - helpFromPoint()[1]);
    return { miles: mi, minutes: MD.driveMinutes(mi), status: HELP_STATUS[(cur && cur.help && cur.help.status && cur.help.status[d.id]) || 'available'] };
  }
  function helpLineDept(i) {
    const id = cur && cur.help && cur.help.from && cur.help.lineTo && cur.help.lineTo[i];
    return id ? MD.departments.find(d => d.id === id) : null;
  }
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function deptTagHtml(d) {
    const r = helpRow(d);
    return `<i class="sdot" style="background:${r.status.color()}"></i>${escHtml(d.label)} · ${Math.round(r.miles)} mi · ~${r.minutes} min`;
  }
  function deptCardHtml(d) {
    const r = helpRow(d);
    return `<b>${escHtml(d.name)}</b>${d.town && !d.name.includes(d.town) ? ` <span class="muted">${escHtml(d.town)}</span>` : ''}<br>` +
      `Equipment (simulated): ${escHtml(d.equipment)}<br>` +
      `${r.miles.toFixed(1)} mi · ~${r.minutes} min <span class="muted">(estimate: straight line × ${MD.DRIVE.roadFactor} at ${MD.DRIVE.mph} mph)</span><br>` +
      `<i class="sdot" style="background:${r.status.color()}"></i>${r.status.text} <span class="muted">(simulated)</span>`;
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
    if (o.text) el.textContent = o.text;   // fixed text; o.html() = text that can change
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
      if (p && it.html) {                       // tags whose text can change
        const h = it.html();
        if (!h) p = null;
        else if (h !== it.htmlKey) { it.htmlKey = h; it.el.innerHTML = h; it.size = null; }
      }
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
    for (const sel of ['.resetview', '#windCompass', '.credits', '.confcard', '.outcome', '.mapflag', '#droneWindow', '#droneControl']) {
      const el = (mapRoot.closest('.mapstage') || mapRoot).querySelector(sel);
      if (!el || el.hidden || !el.offsetParent || (sel === '#droneWindow' && el.classList.contains('primary'))) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blocks.push({ x: r.left - rootRect.left, y: r.top - rootRect.top, w: r.width, h: r.height });
    }
    const dots = live.map(l => ({ x: l.x - 5, y: l.y - 5, w: 10, h: 10, owner: l.it }));
    // Cards must not cover the fires or the likely-path zone.
    const keepOut = [];
    for (const id in slots) if (slots[id].on && slots[id].geom) keepOut.push(screenBox(slots[id].geom.outline.filter((_, i) => i % 10 === 0)));
    if (cur.layers.spread && cur.fires.A && cur.fires.A.path && slots.A.zone.pts) keepOut.push(screenBox(slots.A.zone.pts));
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

    // 5. Edge arrows for the nearest departments that are off screen.
    layoutArrows(W, H, placed.concat(blocks));
  }

  // An arrow at the map edge pointing toward each of the nearest departments
  // (by drive time) whose station is off screen: "Medicine Lodge · 14 min".
  function layoutArrows(W, H, taken) {
    const on = cur.layers.help;
    const rows = on ? MD.helpFrom(helpFromPoint()).slice(0, REAL.help.arrows) : [];
    const cam = viewer.scene.camera, scratch = new Cesium.Cartesian3();
    const used = [];
    labels.arrows.forEach((a, i) => {
      const row = rows[i];
      let show = false;
      if (row) {
        const d = row.dept, world = groundPos(d.p);
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world, scratchWin);
        const inView = win && win.x >= 0 && win.y >= 0 && win.x <= W && win.y <= H &&
          Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(world, cam.positionWC, scratch), cam.directionWC) > 0;
        if (!inView) {
          // Direction to the station in screen space (works behind the camera too).
          Cesium.Cartesian3.subtract(world, cam.positionWC, scratch);
          const dx = Cesium.Cartesian3.dot(scratch, cam.rightWC), dy = -Cesium.Cartesian3.dot(scratch, cam.upWC);
          const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
          const m = 14, t = Math.min((W / 2 - m) / Math.max(Math.abs(ux), 1e-6), (H / 2 - m) / Math.max(Math.abs(uy), 1e-6));
          const tipX = W / 2 + ux * t, tipY = H / 2 + uy * t;
          const text = `${d.label} · ~${row.minutes} min`;
          if (text !== a.key) { a.key = text; a.text.textContent = text; a.size = null; }
          const r = HELP_STATUS[(cur.help && cur.help.status && cur.help.status[d.id]) || 'available'];
          a.el.style.borderColor = r.color();
          a.svg.style.transform = `rotate(${Math.atan2(uy, ux)}rad)`;
          if (!a.size) { a.el.style.display = 'block'; a.size = { w: a.el.offsetWidth, h: a.el.offsetHeight }; }
          // Box inside the map, on the side the arrow points to; slide along the edge if blocked.
          const base = { x: Math.min(Math.max(tipX - (ux > 0 ? a.size.w : 0), 4), W - a.size.w - 4),
                         y: Math.min(Math.max(tipY - a.size.h / 2, 4), H - a.size.h - 4), w: a.size.w, h: a.size.h };
          const vertical = Math.abs(tipX - W / 2) > Math.abs(tipY - H / 2) - 1;   // on a left/right edge: slide up/down
          for (const s of [0, 26, -26, 52, -52, 78, -78, 104, -104]) {
            const b = Object.assign({}, base);
            if (vertical) b.y = Math.min(Math.max(base.y + s, 4), H - b.h - 4); else b.x = Math.min(Math.max(base.x + s * 3, 4), W - b.w - 4);
            if (!taken.concat(used).some(o => overlaps(b, o, 4))) { used.push(b); show = true; a.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`; break; }
          }
        }
      }
      a.el.style.display = show ? 'block' : 'none';
    });
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
    if (regional) { RegionalMap.resetView(duration); return; }
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

    // The real map data (data/*.geojson). Usually already loaded by the dashboard.
    await MD.load();
    if (MD.error) {
      showMsg('The map data in data/ did not load', 'Open the dashboard through a web server (VS Code Live Server) so the browser can read the data files. Details are in the browser console.');
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

    if (regional) {
      try {
        await RegionalMap.init(viewer, mapRoot, compassEl);
        ready = true;
        RegionalMap.update(pending || { layers: {} });
        pending = null;
        hideMsg();
      } catch (err) {
        console.error('Regional map initialization failed:', err);
        showMsg('California map could not load', 'Check the regional data files and browser console. Kansas geometry is not used as a fallback.');
      }
      return;
    }

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
    if (regional && ready) { RegionalMap.update(u); return; }
    if (!ready) { pending = u; return; }
    applyState(u);
  }

  window.Map3D = { init, update, resize: () => { if (viewer && ready) { viewer.resize(); viewer.scene.requestRender(); } }, resetView: () => resetView(1.5), pathHomes, pathBuildings, forecast, onDroneClick: null };
})();
