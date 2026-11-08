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
  const sources = [], allIds = new Set();
  const noop = () => {};
  const element = () => ({ style: {}, addEventListener: noop, getContext: () => ({ beginPath: noop, roundRect: noop, fill: noop, stroke: noop, fillText: noop }) });
  const context = {
    URL, console, performance, ResizeObserver: class { observe() {} },
    document: { baseURI: 'https://firewatch.local/index.html', currentScript: { dataset: { region: 'data/regions/california/region.json' } }, createElement: element },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, new URL(url).pathname.slice(1)), 'utf8')) }),
    Cesium: {
      Color: { fromCssColorString: () => ({ withAlpha() { return this; } }) },
      Cartesian3: { fromDegrees: (longitude, latitude, height) => ({ longitude, latitude, height }) },
      Cartographic: { fromDegrees: () => ({}) },
      Cartesian2: class {}, DistanceDisplayCondition: class {}, BoundingSphere: class {}, HeadingPitchRange: class {},
      HeightReference: { CLAMP_TO_GROUND: 1 }, LabelStyle: { FILL_AND_OUTLINE: 1 },
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
  vm.runInContext(fs.readFileSync(path.join(root, 'regional-map.js'), 'utf8'), context);
  const viewer = {
    entities: new EntityCollection(), clock: {},
    dataSources: { async add(ds) { sources.push(ds); return ds; } },
    scene: { canvas: element(), globe: { getHeight: () => 0 }, postRender: { addEventListener: () => listeners++ } },
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
  assert.equal(viewer.entities.values.length, 22);
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
