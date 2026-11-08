'use strict';
// No browser: exercise the real adapter with strict, collection-local entity IDs.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
class EntityCollection {
  constructor() { this.records = new Map(); }
  get values() { return [...this.records.values()]; }
  add(entity) {
    assert(!this.records.has(entity.id), 'Duplicate entity: ' + entity.id);
    this.records.set(entity.id, entity); return entity;
  }
  getOrCreateEntity(id) { return this.records.get(id) || this.add({ id }); }
}
async function check(retry) {
  let loads = 0, listeners = 0, flights = 0, panels = 0;
  let now = 0;
  const ticks = [];
  const sources = [], allIds = new Set();
  const noop = () => {};
  const element = () => ({ style: {}, addEventListener: noop, getContext: () => ({ beginPath: noop, roundRect: noop, fill: noop, stroke: noop, fillText: noop, fillRect: noop, createRadialGradient: () => ({ addColorStop: noop }), moveTo: noop, lineTo: noop, closePath: noop, measureText: t => ({ width: String(t).length * 7 }) }) });
  const context = {
    URL, console, performance: { now: () => now }, ResizeObserver: class { observe() {} },
    FIRE_TYPES: { wildfire: { color: '#FF4A1C', ember: '#FF8A3D', emberHot: '#FFC07A', glow: { width: 16, alpha: 0.85, power: 0.2 } } },
    Map3D: { fireVisuals: { smokyTexture: () => ({}), seeded: () => () => 0.5 } },
    document: { baseURI: 'https://firewatch.local/index.html', currentScript: { dataset: { region: 'data/regions/california/region.json' } }, createElement: element },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, new URL(url).pathname.slice(1)), 'utf8')) }),
    Cesium: {
      Color: Object.assign(class {}, { fromCssColorString: () => ({ withAlpha() { return this; } }) }), Material: class {}, PolylineCollection: class { add() { return {}; } }, BillboardCollection: class { add() { return {}; } },
      Cartesian3: { fromDegrees: (longitude, latitude, height) => ({ longitude, latitude, height }) },
      Cartographic: { fromDegrees: () => ({}) },
      Cartesian2: class {}, DistanceDisplayCondition: class {}, BoundingSphere: class {}, HeadingPitchRange: class {},
      ImageMaterialProperty: class {}, PolylineGlowMaterialProperty: class {}, PolylineDashMaterialProperty: class {},
      PolygonHierarchy: class { constructor(positions) { this.positions = positions; } },
      HeightReference: { CLAMP_TO_GROUND: 1 }, LabelStyle: { FILL_AND_OUTLINE: 1 }, HorizontalOrigin: { LEFT: 1 }, VerticalOrigin: { TOP: 1 },
      Math: { toRadians: degrees => degrees * Math.PI / 180 },
      ScreenSpaceEventType: { LEFT_CLICK: 1, MOUSE_MOVE: 2 },
      ScreenSpaceEventHandler: class { setInputAction() {} },
      GeoJsonDataSource: { async load(fc) {
        if (++loads === 2 && retry) throw Error('Injected geographic load failure');
        const entities = new EntityCollection();
        for (const feature of fc.features) entities.add({ id: feature.id, properties: { getValue: () => feature.properties } });
        return { entities };
      } }
    }
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'spread-forecast.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'dixie-fire.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'regional-map.js'), 'utf8'), context);
  const viewer = {
    entities: new EntityCollection(), clock: {},
    dataSources: { async add(ds) { sources.push(ds); return ds; } },
    scene: { primitives: { add: o => o }, preUpdate: { addEventListener: noop }, requestRender: noop, preRender: { addEventListener: fn => ticks.push(fn) }, canvas: element(), globe: { getHeight: () => 0 }, postRender: { addEventListener: () => listeners++ } },
    camera: { cancelFlight: noop, flyToBoundingSphere: () => flights++ }
  };
  const host = { appendChild: () => panels++ }, api = context.RegionalMap;
  const first = [api.init(viewer, host), api.init(viewer, host)];
  if (retry) {
    const results = await Promise.allSettled(first);
    assert(results.every(r => r.status === 'rejected' && r.reason.message === 'Injected geographic load failure'));
    await api.init(viewer, host);
  } else await Promise.all(first);
  const ignition = viewer.entities.records.get('regional-ignition');
  await api.init(viewer, host);
  assert.equal(viewer.entities.records.get('regional-ignition'), ignition);
  assert.equal(ignition.parent, undefined);
  assert.equal(ignition.position.latitude, 39.871306);
  assert.equal(ignition.position.longitude, -121.389439);
  assert.equal(viewer.entities.values.length, 64);
  assert.equal(ticks.length, 1);
  const fire = context.DixieFire.create(viewer, context.RegionalMap.data.config.origin);
  assert.equal(ticks.length, 1);
  const polygonArea = points => Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  const entries = viewer.entities.records;
  for (const step of [0,1,2,3,4,5,6,7,6,5,4,3,2,1,0,7]) {
    api.update({ dixieFire: { step }, layers: { spread: true } });
    now += 2600; ticks[0]();
    const expected = context.DixieFire.areas[step];
    assert(Math.abs(polygonArea(context.DixieFire.outline(expected)) - expected) < 1e-6);
    const positions = entries.get('dixie-fire-fill').polygon.hierarchy.positions;
    const local = positions.map(p => [(p.longitude + 121.389439) * 111320 * Math.cos(39.871306 * Math.PI / 180), (p.latitude - 39.871306) * 111320]);
    assert(Math.abs(polygonArea(local) - expected) < 0.01);
    assert.equal(entries.get('dixie-fire-group').show, expected > 0);
    assert.equal(entries.get('dixie-fire-path').show, expected > 0);
    assert(positions.every(p => Math.abs(p.longitude + 121.389439) < 0.02 && Math.abs(p.latitude - 39.871306) < 0.02));
  }
  fire.update({ step: 7 }, { spread: false });
  assert.equal(entries.get('dixie-fire-path').show, false);
  assert.equal(entries.get('dixie-fire-group').show, true);
  assert.equal(entries.get('dixie-fire-edge').polyline.clampToGround, true);
  fire.update({ step: 0 }, { spread: true });
  fire.update({ step: 7 }, { spread: true });
  now += 550; ticks[0]();
  const midway = entries.get('dixie-fire-fill').polygon.hierarchy.positions;
  const midwayArea = polygonArea(midway.map(p => [(p.longitude + 121.389439) * 111320 * Math.cos(39.871306 * Math.PI / 180), (p.latitude - 39.871306) * 111320]));
  assert(midwayArea > 0 && midwayArea < context.DixieFire.areas[7]);
  // One controller, intermediate areas: 2 acres -> 500 acres must pass through several distinct, increasing areas.
  fire.update({ step: 5, playing: true }, { spread: true }); now += 4000; ticks[0]();
  fire.update({ step: 7, playing: true }, { spread: true });
  const seen = [];
  for (let i = 0; i < 20; i++) { now += 200; ticks[0](); seen.push(polygonArea(entries.get('dixie-fire-fill').polygon.hierarchy.positions.map(p => [(p.longitude + 121.389439) * 111320 * Math.cos(39.871306 * Math.PI / 180), (p.latitude - 39.871306) * 111320]))); }
  assert(new Set(seen.map(a => Math.round(a))).size >= 10 && seen.every((a, i) => !i || a >= seen[i - 1] - 1), 'fire area should grow through intermediate values');
  assert(Math.abs(seen[seen.length - 1] - context.DixieFire.areas[7]) < 1);
  // ---- All seven displayed steps: every segment must grow continuously (sampled at 0/25/50/75/100%). ----
  const D = context.DixieFire, DISPLAYED = [0, 1, 3, 4, 5, 6, 7], toArea = ps => polygonArea(ps.map(p => [(p.longitude + 121.389439) * 111320 * Math.cos(39.871306 * Math.PI / 180), (p.latitude - 39.871306) * 111320]));
  const polyArea = () => toArea(entries.get('dixie-fire-fill').polygon.hierarchy.positions);
  const table = DISPLAYED.map(r => D.areas[r]);
  assert(table.every(a => a > 0) && table.every((a, i) => !i || a > table[i - 1]), 'seven strictly increasing, positive area targets');
  assert(Math.abs(table[6] / 4046.8564224 - 500) < 1, 'final target ~500 acres');
  const start0 = (fire.update({ step: 0, playing: false }, { spread: true }), now += 4000, ticks[0](), polyArea());
  assert(Math.abs(start0 - table[0]) < 0.01, 'step 0 shows the tiny ignition area');
  for (let i = 0; i < 6; i++) {
    const a = table[i], b = table[i + 1], t0 = now;
    fire.update({ step: DISPLAYED[i + 1], playing: true }, { spread: true });
    const samples = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) { now = t0 + p * D.PLAY_MS; ticks[0](); samples.push(polyArea()); assert(Math.abs(context.DixieFire.liveArea - samples[samples.length - 1]) < 0.01, 'KPI area equals polygon area'); }
    assert(samples.every(v => v >= a - 0.01 && v <= b + 0.01), 'no value beyond its endpoints, segment ' + i);
    assert(samples.every((v, k) => !k || v > samples[k - 1]), 'segment ' + i + ' grows at every sample');
    assert(samples.every((v, k) => !k || v / samples[k - 1] <= Math.pow(b / a, 0.5) + 1e-9), 'no jump inside segment ' + i);
    assert(Math.abs(samples[4] - b) < 0.01, 'segment ' + i + ' reaches its milestone');
    now += 100; ticks[0]();
  }
  // Pause freezes, resume continues without a jump, Back is smooth, restart snaps to ignition.
  fire.update({ step: 4, playing: false }, { spread: true }); now += 3000; ticks[0]();
  fire.update({ step: 5, playing: true }, { spread: true }); now += 1200; ticks[0]();
  const beforePause = polyArea(); fire.update({ step: 5, playing: false }, { spread: true });
  now += 5000; ticks[0](); assert.equal(polyArea(), beforePause, 'pause freezes the exact size');
  fire.update({ step: 5, playing: true }, { spread: true }); now += 400; ticks[0]();
  const afterResume = polyArea(); assert(afterResume > beforePause && afterResume < table[4], 'resume continues smoothly toward the milestone');
  fire.update({ step: 4, playing: false }, { spread: true }); now += 300; ticks[0]();
  const back = polyArea(); assert(back < afterResume && back > table[3], 'Back eases down toward the previous milestone instead of snapping');
  fire.update({ step: 0, playing: true }, { spread: true });
  assert(Math.abs(polyArea() - table[0]) < 0.01, 'restart during Play returns to the first ignition state');
  assert.equal(ticks.length, 1);
  assert.equal(viewer.entities.values.length, 64);
  assert.equal(sources.length, 5);
  assert.equal(listeners, 1); assert.equal(panels, 1); assert.equal(flights, 1);
  for (const collection of [viewer.entities, ...sources.map(ds => ds.entities)]) {
    for (const entity of collection.values) {
      assert(entity.id && !allIds.has(entity.id), 'Regional ID collision: ' + entity.id);
      allIds.add(entity.id);
    }
  }
  console.log(`PASS: ${retry ? 'failed-load retry' : 'concurrent/repeated initialization'}; one ignition, correct origin, ${allIds.size} unique IDs, initialization reaches camera setup.`);
}
(async () => { await check(false); await check(true); })().catch(error => { console.error(error); process.exitCode = 1; });
