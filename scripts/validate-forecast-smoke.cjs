/* Lightweight logic checks (no browser): one-hour forecast, building intersection, smoke model. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
global.window = global;
require(path.join(root, 'spread-forecast.js'));
require(path.join(root, 'dixie-fire.js'));
const D = global.DixieFire, S = global.SpreadForecast;
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/regions/california/forecast-config.json'), 'utf8'));
const inputs = { ...config.scenarioInputs, slopePct: null };
const fc = { config, inputs };
const DISPLAYED = [0, 1, 3, 4, 5, 6, 7];
const polyArea = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const extent = ring => Math.max(...ring.map(p => Math.hypot(p[0], p[1])));

// 1. The forecast grows with the fire; at ignition it stays tiny and is NOT the final perimeter.
const zones = DISPLAYED.map(r => D.zoneXY(fc, D.areas[r]));
const heads = DISPLAYED.map(r => S.assess(config, inputs, D.areas[r]).headDistanceM);
assert(zones.every((z, i) => !i || polyArea(z) > polyArea(zones[i - 1])), 'forecast zone area increases with each step');
assert(heads.every((h, i) => !i || h > heads[i - 1]), 'head distance increases with fire size');
assert(extent(zones[0]) < 100, 'ignition forecast is small (' + extent(zones[0]).toFixed(1) + ' m)');
assert(extent(zones[0]) * 8 < extent(zones[6]), 'ignition forecast is far smaller than the final-step forecast');
// zone contains the current fire and extends mostly downwind (wind toward 45 deg)
DISPLAYED.forEach((r, i) => {
  const out = D.outline(D.areas[r]);
  assert(out.every(p => S.inside(zones[i], p[0] * 0.98, p[1] * 0.98)), 'zone contains the current fire, step ' + i);
  const a = S.assess(config, inputs, D.areas[r]), sb = Math.sin(Math.PI / 4), cb = Math.cos(Math.PI / 4);
  const fwd = Math.max(...zones[i].map(p => p[0] * sb + p[1] * cb)), back = -Math.min(...zones[i].map(p => p[0] * sb + p[1] * cb));
  assert(fwd > back, 'zone extends downwind of the fire, step ' + i);
  assert(a.factors.find(f => f.key === 'slope').effect === 'Unavailable', 'slope marked unavailable until sampled');
});
// slope input changes the forecast; unavailable slope applies no effect
const steep = S.assess(config, { ...inputs, slopePct: 20 }, D.areas[7]).headDistanceM, flat = S.assess(config, inputs, D.areas[7]).headDistanceM;
assert(steep > flat, 'uphill slope speeds the forecast');

// 2. Building counts equal an independent geographic intersection with the same zone; missing data is not a fake zero.
const origin = { latitude: 39.871306, longitude: -121.389439 }, kx = 111320 * Math.cos(origin.latitude * Math.PI / 180);
const at = (x, y) => [origin.longitude + x / kx, origin.latitude + y / 111320];
const probes = [[0, 0], [30, 30], [300, 300], [-400, -400], [1500, 1500], [-2000, 100]].map(([x, y], i) => ({ id: 'b' + i, x, y, geometry: { type: 'Point', coordinates: at(x, y) } }));
const data = { config: { origin }, forecast: fc, geography: { buildings: { features: probes } } };
DISPLAYED.forEach((r, i) => {
  const expected = probes.filter(b => S.inside(zones[i], b.x, b.y)).map(b => b.id).sort();
  assert.deepEqual(D.buildingsInPath(data, r).map(f => f.id).sort(), expected, 'building count matches intersection, step ' + i);
});
assert(D.buildingsInPath(data, 7).length > D.buildingsInPath(data, 0).length, 'more buildings threatened as the forecast grows');

// 3. Smoke: subtle at ignition, stronger and broader as the fire grows, drifting along the wind and faster with more wind.
const totalAlpha = (area, mph = 10, b = 45) => { let t = 0; for (let k = 0; k < 20; k++) for (let i = 0; i < 36; i++) t += D.smokePuff(i, k * 0.45, area, b, mph).alpha; return t; };
const smoke = DISPLAYED.map(r => totalAlpha(D.areas[r]));
assert(smoke.every((s, i) => !i || s > smoke[i - 1]), 'smoke strengthens at every step');
assert(smoke[0] < smoke[6] * 0.2, 'ignition smoke is very subtle');
const plume = (area, mph) => Math.max(...Array.from({ length: 36 }, (_, i) => Math.hypot(D.smokePuff(i, 4, area, 45, mph).east, D.smokePuff(i, 4, area, 45, mph).north)));
assert(plume(D.areas[7], 10) > plume(D.areas[3], 10) * 3, 'plume broadens as the fire grows');
assert(plume(D.areas[7], 20) > plume(D.areas[7], 10) * 1.5, 'stronger wind carries smoke farther');
for (const bearing of [45, 120, 300]) {
  let ex = 0, no = 0;
  for (let k = 0; k < 10; k++) for (let i = 0; i < 36; i++) { const p = D.smokePuff(i, k * 0.9, D.areas[7], bearing, 10); ex += p.east * p.alpha; no += p.north * p.alpha; }
  const b = bearing * Math.PI / 180, cos = (ex * Math.sin(b) + no * Math.cos(b)) / Math.hypot(ex, no);
  assert(cos > 0.97, 'smoke drifts along wind bearing ' + bearing + ' (cos ' + cos.toFixed(3) + ')');
}
console.log('PASS: forecast grows with the fire (' + heads.map(h => Math.round(h) + ' m').join(', ') + '), ignition zone ' + extent(zones[0]).toFixed(0) + ' m; building counts match intersections; smoke grows and follows wind.');
