'use strict';
// Lightweight filesystem/data checks only: no browser, Cesium initialization or network calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const regions = path.join(root, 'data/regions');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const relative = (base, file) => {
  assert.equal(typeof file, 'string');
  const p = path.resolve(base, file);
  assert(p.startsWith(base + path.sep), 'Path must stay within its package: ' + file);
  return p;
};
const walk = (v, fn) => { if (v && typeof v === 'object') { fn(v); for (const x of Object.values(v)) walk(x, fn); } };
const registry = read(path.join(regions, 'index.json'));
const globalIds = new Set();
let resourceCount = 0, timelineCount = 0;
for (const entry of registry.regions) {
  const manifestPath = relative(regions, entry.manifest), base = path.dirname(manifestPath), region = read(manifestPath);
  assert.equal(region.id, entry.id); assert.equal(region.schemaVersion, '1.0.0');
  assert.equal(typeof region.enabledInDashboard, 'boolean');
  if (region.enabledInDashboard) assert(region.mapConfigPath, 'Enabled region must supply a map configuration');
  assert.equal(region.categories.length, 6);
  const sources = read(relative(base, region.sourcesPath));
  const sourceIds = new Set(sources.records.map(s => s.id));
  assert.equal(sourceIds.size, sources.records.length);
  const raw = read(relative(base, region.workbookSnapshotPath));
  const bookPath = relative(root, sources.workbook.path);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(bookPath)).digest('hex');
  assert.equal(digest, sources.workbook.sha256, 'Workbook changed since extraction');
  assert.equal(digest, raw.source.sha256);
  const cells = new Map(raw.sheets.flatMap(s => s.rows.flatMap(r => r.cells.map(c => [s.name + '!' + c.ref, c]))));
  const value = (s, c) => cells.get(s + '!' + c)?.value ?? null;
  const nullable = v => v === '' || v === undefined ? null : v;
  const validate = obj => walk(obj, v => {
    if (v.category) assert(region.categories.includes(v.category), 'Unknown category: ' + v.category);
    if (v.sourceRefs) for (const id of v.sourceRefs) assert(sourceIds.has(id), 'Unresolved source: ' + id);
    if (v.location?.latitude !== undefined) {
      for (const [key, limit] of [['latitude', 90], ['longitude', 180]]) {
        const n = v.location[key]; assert(n === null || (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit));
      }
    }
  });
  for (const s of sources.records) {
    if (s.url) assert(['https:', 'http:'].includes(new URL(s.url).protocol));
    for (const at of s.workbookOccurrences) assert(cells.has(at.sheet + '!' + at.cell));
  }
  for (const s of raw.sheets) for (const r of s.rows) for (const c of r.cells) {
    if (c.formula !== null) assert.equal(typeof c.formula, 'string');
    assert.notEqual(c.formula, 'System.Xml.XmlElement');
    if (typeof c.value === 'string') for (const match of c.value.matchAll(/https?:\/\/[^\s;]+/g)) {
      const url = match[0].replace(/[.,]$/, '');
      assert(sources.records.some(x => x.url === url && x.workbookOccurrences.some(a => a.sheet === s.name && a.cell === c.ref)), 'Lost source URL');
    }
  }
  const collections = Object.fromEntries(Object.entries(region.collections).map(([key, file]) => [key, read(relative(base, file))]));
  const mappings = {
    cameras: { sheet: 'Cameras', columns: { externalId: 'A', name: 'B', 'location.latitude': 'C', 'location.longitude': 'D', elevationMeters: 'E', 'orientationSnapshot.facingDegrees': 'F', 'orientationSnapshot.fieldOfViewDegrees': 'G', 'workbookGeometry.values.distanceToOriginKm': 'H', 'workbookGeometry.values.bearingToOriginDegrees': 'I' } },
    stations: { sheet: 'Stations', columns: { name: 'A', address: 'B', 'location.latitude': 'C', 'location.longitude': 'D', 'workbookGeometry.values.distanceToOriginKm': 'E', notes: 'F' } },
    aviation: { sheet: 'Aircraft', columns: { name: 'A', typeFromWorkbook: 'B', locationName: 'C', 'location.latitude': 'D', 'location.longitude': 'E', 'workbookGeometry.values.distanceToOriginKm': 'F', 'capabilityClaim.text': 'G' } },
    water: { sheet: 'Water', columns: { name: 'A', pointUsed: 'B', 'location.latitude': 'C', 'location.longitude': 'D', 'workbookGeometry.values.distanceToOriginKm': 'E', notes: 'F' } },
    timeline: { sheet: 'Timeline today', columns: { 'time.label': 'A', 'historicalContext.text': 'B', 'observation.text': 'C', 'firewatchBehavior.levelText': 'D', 'historicalContext.workbookType': 'E' } }
  };
  for (const [key, col] of Object.entries(collections)) {
    assert.equal(col.regionId, region.id); assert.equal(col.schemaVersion, region.schemaVersion); validate(col);
    const mapping = region.id === 'us-ca' ? mappings[key] : null;
    if (mapping) {
      const sourceRows = raw.sheets.find(s => s.name === mapping.sheet).rows.filter(r => r.row >= 5 && r.cells.length > 1);
      assert.deepEqual(col.records.map(r => r.provenance.row), sourceRows.map(r => r.row), 'Omitted/duplicated workbook rows');
    }
    for (const record of col.records) {
      assert(!globalIds.has(record.id), 'Duplicate record ID'); globalIds.add(record.id);
      assert(record.id.startsWith(region.id + ':') || record.id.startsWith(region.id + '-'));
      const p = record.provenance;
      assert.equal(p.workbookId, sources.workbook.id);
      assert(cells.has(p.sheet + '!A' + p.row));
      assert(p.sourceRefs.length > 0);
      for (const n of p.inheritedNotes) assert.equal(n.text, value(p.sheet, n.cell));
      for (const c of p.cellComments) assert.deepEqual({ author: c.author, text: c.text }, cells.get(p.sheet + '!' + c.cell).comment);
      if (mapping) for (const [field, column] of Object.entries(mapping.columns)) {
        const actual = field.split('.').reduce((o, k) => o[k], record);
        assert.equal(actual, nullable(value(mapping.sheet, column + p.row)), `Mismatch ${record.id} ${field}`);
      }
      if (key === 'timeline') {
        timelineCount++;
        assert.equal(record.observation.category, 'hypothetical_2026_observation');
        assert.equal(record.observation.actualHistoricalDetection, false);
        assert.equal(record.observation.detectionTimestamp, null);
        assert.equal(record.time.timestamp, null);
        assert.equal(record.firewatchBehavior.confidenceWeight, null);
        assert.equal(record.firewatchBehavior.implemented, false);
      } else { resourceCount++; assert.equal(record.availability, null); }
    }
  }
  for (const item of region.incidents) {
    const incident = read(relative(base, item.path)); validate(incident);
    assert.equal(incident.id, item.id); assert.equal(incident.regionId, region.id);
    assert.equal(incident.replay.replayDate, null); assert.equal(incident.replay.actualHistoricalDetections, false);
    if (incident.id === 'us-ca-dixie-2021') {
      assert.equal(incident.historical.origin.latitude, 39.871306); assert.equal(incident.historical.origin.longitude, -121.389439);
      assert.equal(incident.inputs.length, 4); assert.equal(incident.summaryClaims.length, 7);
      for (const input of incident.inputs) assert.equal(input.value, value('Inputs', 'B' + input.provenance.row));
      for (const claim of incident.summaryClaims) {
        assert.equal(claim.text, value('Summary', 'C' + claim.provenance.row));
        assert.equal(claim.workbookConfidence, value('Summary', 'D' + claim.provenance.row));
      }
      for (const [key, expected] of [['cameras', 0], ['stations', 5], ['aviation', 6], ['water', 2]]) {
        assert.equal(collections[key].records.filter(r => r.location.latitude === null || r.location.longitude === null).length, expected);
      }
      assert.equal(collections.aviation.records[0].location.verificationStatus, 'approximate_team_estimate');
      assert.equal(collections.aviation.records[0].provenance.cellComments[0].text, 'Approximate airport coordinates (team estimate).');
      assert.equal(collections.aviation.verifiedCurrentInventory.length, 0);
      for (const c of collections.cameras.records) {
        const r = c.provenance.row;
        assert.equal(c.workbookGeometry.originInHorizontalView, value('Cameras', 'J' + r) === 'Yes');
        assert.equal(c.workbookGeometry.withinConfiguredRange, value('Cameras', 'K' + r) === 'Yes');
        assert.equal(c.workbookGeometry.terrainLineOfSightVerified, false);
      }
    }
  }
  console.log(`${region.id}: workbook hash, all source URLs, provenance, field mappings, missing coordinates and claim separation OK`);
}
console.log(`PASS: ${resourceCount} resource records and ${timelineCount} hypothetical timeline rows. No dashboard runtime loaded.`);
