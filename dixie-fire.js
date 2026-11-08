/* Illustrative horizontal area, not an observed perimeter or forest spread forecast.
   Terrain draping handles canyon elevation, not slope/fuel/wind-driven spread.
   `areas` (square meters, converted once from the workbook's sq ft / acres) is the single
   source of truth: polygon, embers, map label and the Area KPI all derive from it.
   Between milestones the area is interpolated (simulated, not observed). */
(function () {
  'use strict';
  const SQFT = 0.09290304, ACRE = 4046.8564224;
  // Fire area per workbook record (square meters). ROOT CAUSE of "no growth until the last step": the old table held 0 for the
  // first records and the same 2 acres for Overnight, so only the final segment changed. Every displayed step now has its own,
  // strictly increasing target. 'documented' = supported by the workbook/2021 facts; otherwise a small ILLUSTRATIVE value so
  // playback shows continuous development (not an observed growth rate). Record 2 ('time unknown') is not a displayed step.
  const MILESTONES = [
    { record: 0, time: '6:48 AM', area: 25 * SQFT, documented: false, note: 'Illustrative ignition, ~5 x 5 ft; no area documented' },
    { record: 1, time: 'Daytime', area: 200 * SQFT, documented: false, note: 'Illustrative; workbook gives no size (slow ground fire)' },
    { record: 2, time: '(not a step)', area: 200 * SQFT, documented: false, note: 'Merged into 4:30 PM; never displayed' },
    { record: 3, time: '4:30 PM', area: 600 * SQFT, documented: true, note: 'Workbook ~600-800 sq ft (lower end)' },
    { record: 4, time: '5:12 PM', area: 1600 * SQFT, documented: true, note: 'Workbook ~40 x 40 ft' },
    { record: 5, time: '5:42 PM', area: 2 * ACRE, documented: true, note: 'Workbook estimate ~2 acres' },
    { record: 6, time: 'Overnight', area: 200 * ACRE, documented: false, note: 'Workbook says "hundreds of acres"; 200 is illustrative' },
    { record: 7, time: '8:00 AM', area: 500 * ACRE, documented: true, note: 'Workbook ~500 acres' }
  ];
  const areas = MILESTONES.map(m => m.area);
  const instances = new WeakMap();
  // Terrain-draped Cesium geometry is rebuilt asynchronously; the old geometry stays on screen until the newest
  // build finishes, and a new edit discards a build still in flight. Rebuilding every frame therefore starves the
  // display (it freezes, then jumps). So geometry is committed at a pace the builder can finish, using the area
  // predicted LOOKAHEAD_MS ahead so what appears matches the clock.
  const GEOM_MS = 160, LOOKAHEAD_MS = 110;
  const PLAY_MS = 2700, MANUAL_MS = 1600;   // illustrative playback transition (playback steps are 2.8 s apart); not a historical growth rate
  // Short, honest area text from square meters (shared by map label and KPI).
  function format(area) {
    if (!(area > 0)) return '';
    const acres = area / ACRE;
    if (acres < 0.1) { const ft = area / SQFT; return '~' + (ft >= 100 ? Math.round(ft / 10) * 10 : Math.round(ft)).toLocaleString('en-US') + ' sq ft'; }
    const n = acres < 10 ? Math.round(acres * 10) / 10 : Math.round(acres);
    return '~' + n.toLocaleString('en-US') + (n === 1 ? ' acre' : ' acres');
  }
  // Geometric growth when both ends are positive, otherwise linear in radius from/to zero.
  function interpolate(a, b, t) {
    if (a > 0 && b > 0) return a * Math.pow(b / a, t);
    const r = Math.sqrt(a) + (Math.sqrt(b) - Math.sqrt(a)) * t;
    return r * r;
  }
  const envelope = area => outline(area).map(p => p.map(v => v * 1.4));
  function buildingsInPath(data, step) {
    if (!areas[step]) return [];
    const ring = envelope(areas[step]), origin = data.config.origin;
    return data.geography.buildings.features.filter(feature => {
      if (feature.geometry.type !== 'Point') return false;
      const [lon, lat] = feature.geometry.coordinates;
      const x = (lon - origin.longitude) * 111320 * Math.cos(origin.latitude * Math.PI / 180), y = (lat - origin.latitude) * 111320;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    });
  }
  function outline(area) {
    const points = Array.from({ length: 64 }, (_, i) => {
      const t = i * Math.PI / 32, r = 1 + 0.09 * Math.sin(t * 3) + 0.05 * Math.cos(t * 7);
      return [Math.cos(t) * r, Math.sin(t) * r];
    });
    const raw = Math.abs(points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
    const scale = Math.sqrt(area / raw);
    return points.map(p => p.map(v => v * scale));
  }
  function create(viewer, origin) {
    if (instances.has(viewer)) return instances.get(viewer);
    const C = Cesium, ft = FIRE_TYPES.wildfire;
    const color = (hex, alpha = 1) => C.Color.fromCssColorString(hex).withAlpha(alpha);
    const position = (east, north) => C.Cartesian3.fromDegrees(origin.longitude + east / (111320 * Math.cos(origin.latitude * Math.PI / 180)), origin.latitude + north / 111320);
    const put = (name, options) => Object.assign(viewer.entities.getOrCreateEntity('dixie-fire-' + name), options);
    const group = put('group', { name: 'Simulated Dixie Fire footprint (not a historical perimeter)' });
    const fill = put('fill', { parent: group, polygon: { hierarchy: [], zIndex: 6, material: new C.ImageMaterialProperty({ image: Map3D.fireVisuals.smokyTexture(), transparent: true }) } });
    const glow = put('glow', { parent: group, polyline: { positions: [], clampToGround: true, width: ft.glow.width, zIndex: 10, material: new C.PolylineGlowMaterialProperty({ color: color(ft.color, ft.glow.alpha), glowPower: ft.glow.power, taperPower: 1 }) } });
    const edge = put('edge', { parent: group, polyline: { positions: [], clampToGround: true, width: 2.5, zIndex: 11, material: color(ft.emberHot) } });
    const path = put('path', { show: false, name: 'Likely path: simulated envelope; no forecast horizon or probability', polygon: { hierarchy: [], zIndex: 3, material: color('#F2A65A', 0.13) }, polyline: { positions: [], clampToGround: true, width: 2, material: new C.PolylineDashMaterialProperty({ color: color('#F2A65A', 0.65) }) } });
    path.position = position(0, 0);
    path.label = { text: 'Likely path', font: '12px Barlow, sans-serif', fillColor: color('#F2A65A'), outlineColor: color('#15120F'), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -88), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity };
    const label = put('label', { position: position(0, 0), label: { text: '', font: '13px Barlow, sans-serif', fillColor: color('#F2A65A'), outlineColor: color('#15120F'), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -48), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity } });
    // Orange callout at the fire's head (the downwind edge); follows the simulated footprint as it grows.
    const head = put('head', { position: position(0, 0), show: false, point: { pixelSize: 7, color: color(ft.color), outlineColor: color('#FFF4E0'), outlineWidth: 1.5, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
      label: { text: 'Head of the fire', font: '600 13px Barlow, sans-serif', fillColor: color('#1B1814'), showBackground: true, backgroundColor: color('#F26B2E', 0.95), backgroundPadding: new C.Cartesian2(7, 4), horizontalOrigin: C.HorizontalOrigin.LEFT, pixelOffset: new C.Cartesian2(12, -4), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity } });
    // Pulsing ignition glow: screen-space only (pixels), so early growth is noticeable without enlarging the true-scale polygon.
    const pulse = put('ignition-glow', { position: position(0, 0), show: false, point: { pixelSize: 16, color: color('#F26B2E', 0.28), outlineColor: color('#F26B2E', 0.7), outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity } });
    const random = Map3D.fireVisuals.seeded(23);
    const embers = Array.from({ length: 24 }, (_, i) => ({ angle: random() * Math.PI * 2, radius: 0.85 * Math.sqrt(random()), phase: random() * 6.283,
      entity: put('ember-' + i, { position: position(0, 0), point: { pixelSize: 2.5, color: color(ft.ember), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 0 } }) }));
    let headBearing = 45, labelText = null, frozen = false, wasPlaying = false, dur = MANUAL_MS, linear = false, pausedP = 0, current = 0, from = 0, target = 0, start = 0, last = -Infinity, step = -1, spread = true;
    function draw(area) {
      if (window.DixieFire) window.DixieFire.liveArea = area;
      if (typeof CustomEvent === 'function' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('dixie-area', { detail: { area } }));
      const xy = outline(area), vertices = xy.map(p => position(...p)), ring = vertices.concat(vertices[0]);
      group.show = area > 0;
      fill.polygon.hierarchy = new C.PolygonHierarchy(vertices);
      glow.polyline.positions = edge.polyline.positions = ring;
      const pathVertices = envelope(area).map(p => position(...p));
      path.polygon.hierarchy = new C.PolygonHierarchy(pathVertices);
      path.polyline.positions = pathVertices.concat(pathVertices[0]);
      path.show = spread && area > 0;
      const radius = Math.sqrt(area / Math.PI), b = headBearing * Math.PI / 180;
      pulse.show = area > 0 && area < 20 * ACRE;
      head.show = area > 0; head.position = position(radius * 1.1 * Math.sin(b), radius * 1.1 * Math.cos(b));
      embers.forEach((e, i) => {
        e.entity.show = i < (area > 0 ? 24 : 1);
        e.entity.position = position(radius * e.radius * Math.cos(e.angle), radius * e.radius * Math.sin(e.angle));
      });
    }
    function tick() {
      const now = performance.now(), animating = current !== target && !frozen;
      if (pulse.show) pulse.point.pixelSize = 15 + 6 * Math.sin(now / 380);
      if (now - last < (animating ? GEOM_MS : 140)) return; // One geometry commit per build window while growing.
      last = now;
      if (animating) {
        const p = Math.min(1, (now - start + LOOKAHEAD_MS) / dur), eased = linear ? p : p * p * (3 - 2 * p);
        pausedP = p;
        const next = p >= 1 ? target : interpolate(from, target, eased);
        if (next !== current) { current = next; draw(current); setLabel(); }
      }
      embers.forEach(e => { e.entity.point.color = color(ft.ember, 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(now / 330 + e.phase))); });
    }
    function setLabel() {
      const settled = current === target;
      const text = current <= 0 ? 'Ignition' : 'Simulated fire · ' + (settled && step === 4 ? '~40 × 40 ft' : format(current));
      if (text !== labelText) { labelText = text; label.label.text = text; }
    }
    function update(spec, layers) {
      if (!spec || !Number.isInteger(spec.step) || !areas.hasOwnProperty(spec.step)) return;
      spread = layers.spread !== false;
      path.show = spread && current > 0;
      if (Number.isFinite(spec.headBearing) && spec.headBearing !== headBearing) { headBearing = spec.headBearing; draw(current); }
      const playing = !!spec.playing, now = performance.now();
      if (step === spec.step) {
        if (wasPlaying && !playing && current !== target) { frozen = true; }                       // Pause: hold the current size
        else if (!wasPlaying && playing && frozen) {                                                 // Resume from that size
          frozen = false; from = current; start = now; dur = Math.max(200, PLAY_MS * (1 - pausedP)); linear = true; last = -Infinity;
        }
        wasPlaying = playing; return;
      }
      wasPlaying = playing; frozen = false;
      if (playing && areas[spec.step] < current) { current = areas[spec.step]; draw(current); }   // restart during Play: back to the first ignition state at once
      // A new step cancels any growth in progress and eases from the area currently drawn (simulated interpolation).
      step = spec.step; from = current; target = areas[step]; start = now; last = -Infinity; pausedP = 0;
      dur = playing ? PLAY_MS : MANUAL_MS; linear = playing;   // playback: constant-rate, no stall at milestones
      setLabel();
      viewer.scene.requestRender();
    }
    draw(0);
    viewer.scene.preRender.addEventListener(tick);
    setLabel();
    // Close-up of the fire for inspecting early growth (user-triggered from the map popups; default view unchanged).
    function zoom() {
      const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(origin.longitude, origin.latitude));
      const centre = C.Cartesian3.fromDegrees(origin.longitude, origin.latitude, Number.isFinite(h) ? h : 0);
      viewer.camera.flyToBoundingSphere(new C.BoundingSphere(centre, 0), { duration: 1.2, offset: new C.HeadingPitchRange(C.Math.toRadians(15), C.Math.toRadians(-45), Math.max(350, Math.sqrt(current / Math.PI) * 5)) });
    }
    const result = { update, zoom, get area() { return current; } }; instances.set(viewer, result); return result;
  }
  window.DixieFire = { liveArea: 0, milestones: MILESTONES, PLAY_MS, MANUAL_MS, create, outline, envelope, buildingsInPath, areas, format, interpolate };
})();
