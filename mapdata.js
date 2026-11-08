/* =====================================================================
   mapdata.js: loads the real map data in data/*.geojson and prepares it
   for the 3D map and the dashboard.

   Sources (see scripts/fetch-data.py): OpenStreetMap contributors (roads,
   power lines, buildings, towns, fire stations), USGS National Hydrography
   Dataset (ponds, lakes, creeks), HIFLD (transmission lines).

   MapData.load() fetches the files once (they are small, ~1 MB in total).
   After it resolves, everything below is ready and synchronous:
     MapData.buildings     [{ p: [east, north], ll: [lon, lat], kind, home }]
                           home = a house, or a building with no type in the data
     MapData.water         [{ name, type, acres, rings (lon/lat), outer ([e, n] miles) }]
     MapData.creeks        [{ name, parts (lon/lat), labelAt: [e, n] }]
     MapData.power         [{ kv, operator, transmission, label, parts (lon/lat), local }]
     MapData.departments   [{ id, names, label, town, p, ll, equipment }]  real fire stations
     MapData.route         { points: [[e, n]...], miles, roads: [names] } station -> fire, real roads
     MapData.nearestWater(p)        nearest pond / lake to a point
     MapData.helpFrom(p)            departments sorted by estimated drive time from p
     MapData.distanceToPower(p)     miles from p to the nearest power line
     MapData.snapToRoad(p)          nearest point on a real road
     MapData.nearestNamedRoad(p)    { name, miles } of the nearest named road
     MapData.nearestTown(p)         { name, p, miles } of the nearest town or village
   Points p are miles [east, north] of the fire start (story.js).
   ===================================================================== */
(function () {
  'use strict';

  const S = window.STORY;
  const FILES = ['water', 'creeks', 'powerlines', 'roads', 'buildings', 'towns'];

  // Drive time estimate: straight-line miles x 1.3 (roads are not straight), at 45 mph.
  const DRIVE = { roadFactor: 1.3, mph: 45 };

  const MD = {
    loaded: false, error: null, attribution: [],
    buildings: [], water: [], creeks: [], power: [], roads: [], departments: [], towns: [],
    route: null, DRIVE,
    load, nearestWater, helpFrom, distanceToPower, nearestPower, snapToRoad, nearestNamedRoad, nearestTown, dir16, driveMinutes
  };

  const local = c => S.toLocal(c[0], c[1]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function lineParts(g) {
    if (!g) return [];
    return g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  }

  // 16-point compass direction of a vector [east, north].
  function dir16(v) {
    const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const deg = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
    return names[Math.round(deg / 22.5) % 16];
  }
  function driveMinutes(mi) { return Math.round((mi * DRIVE.roadFactor) / DRIVE.mph * 60); }

  // Distance from point p to segment ab (all in miles).
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function inside(p, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) &&
          p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
    }
    return c;
  }

  /* ---------- Loading ---------- */

  // Loads once; every caller gets the same promise.
  let loading = null;
  function load() { return loading || (loading = doLoad()); }
  async function doLoad() {
    try {
      // Regional geography is independent of the retained Kansas scenario model.
      // Do not fetch Kansas features or project them into California.
      if (window.RegionalMap && RegionalMap.active) {
        await RegionalMap.load();
        MD.regionalResources = RegionalMap.data.resources;
        MD.loaded = true;
        return MD;
      }
      const raw = await Promise.all(FILES.map(async n => {
        const r = await fetch(`archive/kansas/data/${n}.geojson`);
        if (!r.ok) throw new Error(`archive/kansas/data/${n}.geojson: HTTP ${r.status}`);
        return r.json();
      }));
      const d = Object.fromEntries(FILES.map((n, i) => [n, raw[i]]));
      for (const n of FILES) {
        const a = d[n].metadata && d[n].metadata.attribution;
        if (a) for (const part of a.split(';')) if (!MD.attribution.includes(part.trim())) MD.attribution.push(part.trim());
      }
      prepBuildings(d.buildings);
      prepWater(d.water);
      prepCreeks(d.creeks);
      prepPower(d.powerlines);
      prepRoads(d.roads);
      prepDepartments(d.towns);
      MD.route = route(S.STATION, S.PLACES.line);
      MD.waterTruck = snapToRoad(S.WATER_TRUCK);
      MD.loaded = true;
    } catch (e) {
      MD.error = e;
      console.error('Map data failed to load:', e);
    }
    return MD;
  }

  function prepBuildings(fc) {
    MD.buildings = fc.features.map(f => {
      const ll = f.geometry.coordinates, kind = f.properties.kind ?? null;
      // The data rarely says what a building is: houses and unlabeled buildings count as homes.
      return { ll, p: local(ll), kind, home: kind === 'house' || kind === null };
    });
  }

  function prepWater(fc) {
    MD.water = fc.features.filter(f => f.geometry && f.geometry.type === 'Polygon').map(f => ({
      name: f.properties.name || null, type: f.properties.type, acres: f.properties.acres,
      rings: f.geometry.coordinates, outer: f.geometry.coordinates[0].map(local)
    }));
    for (const w of MD.water) w.center = w.outer.reduce((s, q) => [s[0] + q[0] / w.outer.length, s[1] + q[1] / w.outer.length], [0, 0]);
  }

  function prepCreeks(fc) {
    MD.creeks = fc.features.map(f => {
      const parts = lineParts(f.geometry);
      // Label at the middle of the longest piece.
      let best = parts[0] || [];
      for (const p of parts) if (p.length > best.length) best = p;
      return { name: f.properties.name, type: f.properties.type, parts, labelAt: best.length ? local(best[Math.floor(best.length / 2)]) : null };
    });
  }

  // Power lines. HIFLD lines that repeat an OpenStreetMap line (HIFLD is often
  // mapped a little off to one side) are dropped, so each line is drawn once.
  function prepPower(fc) {
    const osm = [], hifld = [];
    for (const f of fc.features) {
      const parts = lineParts(f.geometry);
      if (!parts.length) continue;
      const p = f.properties;
      const kv = p.source === 'hifld' ? p.voltage : p.voltage ? Math.round(parseFloat(String(p.voltage).split(';')[0]) / 1000) : null;
      const rec = { kv: Number.isFinite(kv) ? kv : null, operator: p.operator && p.operator !== 'NOT AVAILABLE' ? p.operator : null,
        transmission: p.source === 'hifld' || (kv && kv >= 69) || p.kind === 'line', source: p.source,
        parts, local: parts.map(pt => pt.map(local)) };
      rec.label = (rec.kv ? `${rec.kv} kV power line` : 'Power line') + (rec.operator ? ` (${shortOperator(rec.operator)})` : '');
      (p.source === 'hifld' ? hifld : osm).push(rec);
    }
    const nearOsm = q => osm.some(o => o.local.some(part => part.some((a, i) => i && segDist(q, part[i - 1], a) < 0.3)));
    for (const h of hifld) {
      const pts = h.local.flat();
      const sample = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 8)) === 0);
      if (sample.filter(nearOsm).length < sample.length / 2) osm.push(h);
    }
    MD.power = osm;
  }
  function shortOperator(o) {
    const known = { 'Oklahoma Gas & Electric': 'OG&E', 'Southern Pioneer Electric Company': 'Southern Pioneer' };
    return known[o] || o.replace(/\b(Company|Corporation|Inc\.?|LLC)\b/g, '').trim();
  }
  // The nearest town or village (not a fire station) to p.
  function nearestTown(p) {
    let best = null, bd = Infinity;
    for (const t of MD.towns) { const d = dist(p, t.p); if (d < bd) { bd = d; best = t; } }
    return best ? { name: best.name, p: best.p, miles: bd } : null;
  }
  // The power line nearest to p.
  function nearestPower(p) {
    let best = null, bd = Infinity;
    for (const l of MD.power) for (const part of l.local) for (let i = 1; i < part.length; i++) {
      const d = segDist(p, part[i - 1], part[i]);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  function distanceToPower(p) {
    let best = Infinity;
    for (const l of MD.power) for (const part of l.local) for (let i = 1; i < part.length; i++) best = Math.min(best, segDist(p, part[i - 1], part[i]));
    return best;
  }

  /* ---------- Roads: network and route ---------- */

  const graph = new Map();     // "lon,lat" -> [{ to, mi, w, name }]
  const nodePos = new Map();   // "lon,lat" -> [east, north]
  // Prefer graded roads over farm tracks when routing a fire truck.
  const ROAD_WEIGHT = { track: 1.6, residential: 1.1 };

  function prepRoads(fc) {
    MD.roads = fc.features.map(f => ({ name: f.properties.name || f.properties.ref || null, type: f.properties.type, parts: lineParts(f.geometry) }));
    for (const r of MD.roads) {
      const w = ROAD_WEIGHT[r.type] || 1;
      for (const part of r.parts) {
        for (let i = 1; i < part.length; i++) {
          const a = part[i - 1].join(), b = part[i].join();
          if (!nodePos.has(a)) nodePos.set(a, local(part[i - 1]));
          if (!nodePos.has(b)) nodePos.set(b, local(part[i]));
          const mi = dist(nodePos.get(a), nodePos.get(b));
          if (!graph.has(a)) graph.set(a, []);
          if (!graph.has(b)) graph.set(b, []);
          graph.get(a).push({ to: b, mi, w, name: r.name });
          graph.get(b).push({ to: a, mi, w, name: r.name });
        }
      }
    }
  }
  function nearestNode(p) {
    let best = null, bd = Infinity;
    for (const [k, q] of nodePos) { const d = dist(p, q); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  // Nearest point on any road (for the water truck).
  function snapToRoad(p) {
    let best = p, bd = Infinity;
    for (const r of MD.roads) for (const part of r.parts) {
      for (let i = 1; i < part.length; i++) {
        const a = local(part[i - 1]), b = local(part[i]);
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
        const q = [a[0] + t * dx, a[1] + t * dy], d = dist(p, q);
        if (d < bd) { bd = d; best = q; }
      }
    }
    return best;
  }
  // Shortest (weighted) path over the real road network (Dijkstra).
  function route(from, to) {
    const s = nearestNode(from), t = nearestNode(to);
    if (!s || !t) return null;
    const best = new Map([[s, 0]]), prev = new Map(), done = new Set();
    const heap = [[0, s]];
    const push = x => { heap.push(x); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (done.has(u)) continue;
      done.add(u);
      if (u === t) break;
      for (const e of graph.get(u) || []) {
        const nd = d + e.mi * e.w;
        if (nd < (best.get(e.to) ?? Infinity)) { best.set(e.to, nd); prev.set(e.to, { from: u, mi: e.mi, name: e.name }); push([nd, e.to]); }
      }
    }
    if (!prev.has(t) && s !== t) return null;
    const points = [nodePos.get(t)], roads = [];
    let miles = 0, u = t;
    while (u !== s) {
      const p = prev.get(u);
      miles += p.mi;
      if (p.name && roads[roads.length - 1] !== p.name) roads.push(p.name);
      points.push(nodePos.get(p.from));
      u = p.from;
    }
    return { points: points.reverse(), miles, roads: roads.reverse() };
  }

  // Nearest road with a name (for alert text such as "by Hardtner Shortcut").
  function nearestNamedRoad(p) {
    let best = null, bd = Infinity;
    for (const r of MD.roads) {
      if (!r.name) continue;
      for (const part of r.parts) for (let i = 1; i < part.length; i++) {
        const d = segDist(p, local(part[i - 1]), local(part[i]));
        if (d < bd) { bd = d; best = r.name; }
      }
    }
    return best ? { name: best, miles: bd } : null;
  }

  /* ---------- Water ---------- */

  // Nearest pond / lake to p: distance to its shore (0 if p is in it).
  function nearestWater(p) {
    let best = null, bd = Infinity;
    for (const w of MD.water) {
      if (dist(p, w.center) - 3 > bd) continue;
      let d = inside(p, w.outer) ? 0 : Infinity;
      for (let i = 1; i < w.outer.length && d; i++) d = Math.min(d, segDist(p, w.outer[i - 1], w.outer[i]));
      if (d < bd) { bd = d; best = w; }
    }
    if (!best) return null;
    return { name: best.name, type: best.type, acres: best.acres, miles: bd, dir: dir16([best.center[0] - p[0], best.center[1] - p[1]]), water: best,
      text: `${best.name || best.type[0].toUpperCase() + best.type.slice(1)}, ${bd.toFixed(1)} mi ${dir16([best.center[0] - p[0], best.center[1] - p[1]])}` };
  }

  /* ---------- Fire departments ---------- */

  // Equipment is simulated (the data only has station locations).
  const EQUIPMENT = ['1 brush truck, 1 tanker', '2 brush trucks', '1 engine, 1 brush truck', '1 brush truck, 1 water tender', '2 brush trucks, 1 tanker'];
  const shortDept = n => n.replace(/Volunteer Fire Department/i, 'VFD').replace(/Fire Department/i, 'FD').replace(/Rural Fire/i, 'Rural Fire')
    .replace(/County/i, 'Co.').replace(/Township/i, 'Twp').replace(/Fire Rescue Emergency Medical Service/i, 'Fire & EMS').replace(/\s+/g, ' ').trim();

  function prepDepartments(fc) {
    const places = fc.features.filter(f => f.properties.kind !== 'fire_station' && f.properties.name)
      .map(f => ({ name: f.properties.name, p: local(f.geometry.coordinates) }));
    const stations = fc.features.filter(f => f.properties.kind === 'fire_station');
    const depts = [];
    for (const f of stations) {
      const p = local(f.geometry.coordinates);
      const name = f.properties.name || null;
      // Departments sharing one building (within ~150 m) become one marker.
      const same = depts.find(d => dist(d.p, p) < 0.1);
      if (same) { if (name) same.names.push(name); continue; }
      let town = null, td = 2;
      for (const pl of places) { const d = dist(pl.p, p); if (d < td) { td = d; town = pl.name; } }
      depts.push({ names: name ? [name] : [], p, ll: f.geometry.coordinates, town });
    }
    depts.forEach((d, i) => {
      d.name = d.names.join(' / ') || (d.town ? `${d.town} fire station` : 'Fire station');
      const h = [...d.name].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
      d.equipment = EQUIPMENT[h % EQUIPMENT.length];
    });
    // Map label: the town; departments sharing a town get their short names.
    for (const d of depts) {
      const twin = d.town && depts.some(o => o !== d && o.town === d.town);
      d.label = !d.town || twin ? (d.names.map(shortDept).join(' / ') || d.name) : d.town;
    }
    MD.towns = places;
    depts.sort((a, b) => dist(a.p, [0, 0]) - dist(b.p, [0, 0]));
    depts.forEach((d, i) => { d.id = 'dept' + i; });
    MD.departments = depts;
  }

  // Departments sorted by estimated drive time from p.
  function helpFrom(p) {
    return MD.departments.map(d => {
      const mi = dist(p, d.p);
      return { dept: d, miles: mi, minutes: driveMinutes(mi), text: `${Math.round(mi)} mi · ~${driveMinutes(mi)} min` };
    }).sort((a, b) => a.minutes - b.minutes || a.miles - b.miles);
  }

  window.MapData = MD;
})();
