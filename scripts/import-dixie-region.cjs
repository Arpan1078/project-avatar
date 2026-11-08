/* Phase 1 only. Normalize a read-only workbook snapshot; never load or edit dashboard code. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'data/regions/california');
const workbook = JSON.parse(fs.readFileSync(path.join(dir, 'workbook-source.json'), 'utf8'));
const schemaVersion = '1.0.0';
const regionId = 'us-ca';
const incidentId = 'us-ca-dixie-2021';
const replayId = 'us-ca-dixie-2026-hypothetical';
const categories = ['verified_historical_fact', 'real_geographic_location', 'current_resource_inventory', 'hypothetical_2026_observation', 'simulated_firewatch_behavior', 'unknown_unverified'];
const asOf = '2026-11-07'; // Workbook's stated snapshot date, not a live inventory verification date.
const officialUrl = 'https://www.fire.ca.gov/incidents/2021/7/13/dixie-fire';
const sheets = new Map(workbook.sheets.map(s => [s.name, s]));
const expectedSheets = ['Summary', 'Inputs', 'Cameras', 'Stations', 'Aircraft', 'Water', 'Timeline today'];
if (JSON.stringify([...sheets.keys()]) !== JSON.stringify(expectedSheets)) throw Error('Workbook sheets changed; review mapping');
const cell = (sheet, ref) => sheets.get(sheet).rows.flatMap(r => r.cells).find(c => c.ref === ref);
const value = (sheet, ref) => cell(sheet, ref)?.value ?? null;
const num = (sheet, ref) => { const v = value(sheet, ref); if (v === null || v === '') return null; if (typeof v !== 'number' || !Number.isFinite(v)) throw Error(`Non-numeric ${sheet}!${ref}`); return v; };
const hashId = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const sourceEntries = new Map();
function addSource(url, citation, location) {
  const id = 'source-' + hashId(url || citation);
  if (!sourceEntries.has(id)) sourceEntries.set(id, { id, kind: url ? 'external_reference' : 'workbook_attribution', url, citations: [], workbookOccurrences: [], verification: { status: 'not_independently_checked', checkedOn: null, verifiedClaims: [] } });
  const s = sourceEntries.get(id);
  if (!s.citations.includes(citation)) s.citations.push(citation);
  if (!s.workbookOccurrences.some(p => p.sheet === location.sheet && p.cell === location.cell)) s.workbookOccurrences.push(location);
  return id;
}
const cellSources = new Map();
for (const sheet of workbook.sheets) for (const row of sheet.rows) for (const c of row.cells) {
  const text = typeof c.value === 'string' ? c.value : '';
  const urls = [...text.matchAll(/https?:\/\/[^\s;]+/g)].map(m => m[0].replace(/[.,]$/, ''));
  if (c.hyperlink?.target?.startsWith('http')) urls.push(c.hyperlink.target);
  const ids = [...new Set(urls)].map(url => addSource(url, text, { sheet: sheet.name, cell: c.ref }));
  if (!ids.length && text === 'Firebender team estimate (not an official figure)') ids.push(addSource(null, text, { sheet: sheet.name, cell: c.ref }));
  if (ids.length) cellSources.set(sheet.name + '!' + c.ref, ids);
}
const refs = (sheet, ...cells) => [...new Set(cells.flatMap(c => cellSources.get(sheet + '!' + c) || []))];
const sourceText = (sheet, ref) => value(sheet, ref);
function provenance(sheet, row, endColumn, sourceCells, noteCells = []) {
  const raw = sheets.get(sheet).rows.find(r => r.row === row);
  return { workbookId: 'dixie-reference-workbook', sheet, row, range: `A${row}:${endColumn}${row}`, sourceRefs: refs(sheet, ...sourceCells), sourceText: sourceCells.map(c => sourceText(sheet, c)), inheritedNotes: noteCells.map(c => ({ cell: c, text: value(sheet, c) })), cellComments: raw.cells.filter(c => c.comment).map(c => ({ cell: c.ref, ...c.comment })) };
}
function location(sheet, row, latColumn, lonColumn, pointMeaning, status = 'workbook_coordinates_unverified') {
  const latitude = num(sheet, latColumn + row), longitude = num(sheet, lonColumn + row);
  return { latitude, longitude, pointMeaning, verificationStatus: latitude === null || longitude === null ? 'coordinates_missing' : status, datumInWorkbook: null };
}
function derived(sheet, row, cols) {
  return { basis: 'workbook_cached_formulas', recalculatedDuringImport: false, originRef: incidentId + '#historical.origin', values: Object.fromEntries(Object.entries(cols).map(([key, col]) => [key, num(sheet, col + row)])), formulaCells: Object.values(cols).map(c => c + row) };
}
function verification(sheet, summaryRow, notes = []) {
  return { status: 'not_independently_verified', inventoryAsOf: null, workbookSnapshotAsOf: asOf, workbookConfidence: { sheet: 'Summary', cell: 'D' + summaryRow, text: value('Summary', 'D' + summaryRow) }, notes: [value(sheet, 'A2'), ...notes].filter(Boolean) };
}
function collection(kind, records, extra = {}) { return { schemaVersion, regionId, kind, workbookId: 'dixie-reference-workbook', records, ...extra }; }
function write(name, data) { if (name === 'region.json' && fs.existsSync(path.join(dir, name))) { const existing = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); if (existing.mapConfigPath) Object.assign(data, { mapConfigPath: existing.mapConfigPath, enabledInDashboard: existing.enabledInDashboard, lifecycle: existing.lifecycle, notes: existing.notes }); } fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n'); }
const cameraRows = sheets.get('Cameras').rows.filter(r => r.row >= 5 && r.row <= 11);
const cameras = cameraRows.map(({ row: r }) => ({
  id: regionId + ':camera:' + value('Cameras', 'A' + r), category: 'real_geographic_location',
  externalId: value('Cameras', 'A' + r), name: value('Cameras', 'B' + r),
  location: location('Cameras', r, 'C', 'D', 'camera_mount'), elevationMeters: num('Cameras', 'E' + r),
  orientationSnapshot: { facingDegrees: num('Cameras', 'F' + r), fieldOfViewDegrees: num('Cameras', 'G' + r), asOf, observedAt: null, basis: 'workbook_reports_public_camera_list_snapshot', dynamic: true },
  workbookGeometry: { ...derived('Cameras', r, { distanceToOriginKm: 'H', bearingToOriginDegrees: 'I' }), originInHorizontalView: value('Cameras', 'J' + r) === 'Yes', withinConfiguredRange: value('Cameras', 'K' + r) === 'Yes', classificationCells: ['J' + r, 'K' + r], terrainLineOfSightVerified: false, notEvidenceOfDetection: true },
  availability: null, detectionTimestamp: null,
  verification: verification('Cameras', 10, ['The list was only partially read. Facing and field of view are snapshots, not current coverage guarantees.', 'Horizontal alignment does not establish terrain visibility or smoke detection.']),
  provenance: provenance('Cameras', r, 'K', ['A13'], ['A2', 'A13', 'A14'])
}));
const stationIds = ['station-36-jarbo-gap', 'station-37-concow', 'station-38-concow-lake', 'station-60-brush-creek', 'station-61-berry-creek', 'oroville-fs'];
const stations = stationIds.map((id, i) => { const r = i + 5; return {
  id: regionId + ':' + id, category: 'real_geographic_location', name: value('Stations', 'A' + r), address: value('Stations', 'B' + r),
  location: location('Stations', r, 'C', 'D', 'station'), workbookGeometry: derived('Stations', r, { distanceToOriginKm: 'E' }),
  notes: value('Stations', 'F' + r), staffing: null, apparatus: null, availability: null, responseTimeMinutes: null,
  verification: verification('Stations', 7, ['Summary mentions four missing station coordinates; the Stations sheet actually has five.']),
  provenance: provenance('Stations', r, 'G', ['G' + r], ['A2', 'A12'])
}; });
const aviationIds = ['chico-regional-airport', 'aero-flite', 'porter-flying-services', 'jones-aviation', 'c-and-j-applicators', 'pacific-valley-aviation', 'andersons-flying-service'];
const aircraft = aviationIds.map((id, i) => { const r = i + 5; return {
  id: regionId + ':aviation:' + id, category: i === 0 ? 'real_geographic_location' : 'unknown_unverified',
  recordType: i === 0 ? 'base' : 'operator', name: value('Aircraft', 'A' + r), typeFromWorkbook: value('Aircraft', 'B' + r), locationName: value('Aircraft', 'C' + r),
  location: location('Aircraft', r, 'D', 'E', i === 0 ? 'airport_reference_point_not_dispatch_location' : 'operator_location', 'approximate_team_estimate'),
  workbookGeometry: derived('Aircraft', r, { distanceToOriginKm: 'F' }),
  capabilityClaim: { category: 'unknown_unverified', text: value('Aircraft', 'G' + r), verified: false },
  aircraftCount: null, tailNumbers: null, availability: null, contractedForFireResponse: null, cardedForFireResponse: null, responseTimeMinutes: null,
  verification: verification('Aircraft', 8, i === 0 ? ['Aircraft!D5 cell comment marks airport coordinates as approximate (team estimate). No fleet or operational readiness established.'] : ['This is an operator listing, not a verified aircraft or dispatchable resource. Do not copy Chico airport coordinates into an operator record.']),
  provenance: provenance('Aircraft', r, 'H', ['H' + r], ['A2', 'A13'])
}; });
const waterIds = ['north-fork-feather-river', 'cresta-reservoir', 'poe-reservoir', 'rock-creek-reservoir', 'belden-forebay', 'lake-almanor', 'lake-oroville'];
const water = waterIds.map((id, i) => { const r = i + 5; return {
  id: regionId + ':water:' + id, category: 'real_geographic_location', name: value('Water', 'A' + r), pointUsed: value('Water', 'B' + r),
  location: location('Water', r, 'C', 'D', i > 0 && i < 6 ? 'dam_reference_point_not_water_access_point' : 'waterbody_point_not_supplied'),
  workbookGeometry: derived('Water', r, { distanceToOriginKm: 'E' }), notes: value('Water', 'F' + r),
  availability: null, accessVerified: null, scoopingSuitabilityVerified: null, currentWaterLevel: null,
  verification: verification('Water', 9, ['Dam reference coordinates do not establish a usable intake, dipping site, or scooping corridor. Current access, depth and aviation suitability are unknown.']),
  provenance: provenance('Water', r, 'G', ['G' + r], ['A2'])
}; });
const timeline = Array.from({ length: 8 }, (_, i) => { const r = i + 5; return {
  id: replayId + ':event-' + (i + 1), category: 'simulated_firewatch_behavior', order: i + 1,
  time: { label: value('Timeline today', 'A' + r), timezone: 'America/Los_Angeles', timestamp: null, replayDate: null, precision: r === 6 || r === 7 || r === 11 ? 'unspecified_window' : 'workbook_local_clock_only' },
  historicalContext: { category: 'unknown_unverified', basisYear: 2021, text: value('Timeline today', 'B' + r), workbookType: value('Timeline today', 'E' + r), verificationStatus: 'not_independently_verified', sourceScope: 'Workbook row attribution; does not verify hypothetical observation' },
  observation: { category: 'hypothetical_2026_observation', text: value('Timeline today', 'C' + r), actualHistoricalDetection: false, detectionTimestamp: null, evidenceStatus: 'team_replay_assumption_not_observation', inheritsObservationFromEvent: r === 8 ? replayId + ':event-3' : null },
  firewatchBehavior: { category: 'simulated_firewatch_behavior', levelText: value('Timeline today', 'D' + r), implemented: false, confidenceWeight: null, notes: 'Imported scenario proposal only; no existing dashboard scoring or pipeline is modified.' },
  provenance: provenance('Timeline today', r, 'F', ['F' + r], ['A2'])
}; });
const officialId = refs('Inputs', 'C4')[0];
Object.assign(sourceEntries.get(officialId).verification, { status: 'selected_claims_verified', checkedOn: asOf, verifiedClaims: ['Incident name Dixie Fire', 'Historical incident date 2021-07-13', 'Origin latitude 39.871306 and longitude -121.389439', 'Location above Cresta Dam, Feather River Canyon'], note: 'CAL FIRE page reviewed during Phase 1. Its published start time is 07/13/2021 5:15 PM, distinct from workbook fault and 911-call times. Other workbook history and 2026 resource claims were not independently checked.' });
const inputs = [4,5,6,7].map(r => ({ name: value('Inputs', 'A' + r), value: value('Inputs', 'B' + r), category: r <= 5 ? 'verified_historical_fact' : r === 6 ? 'simulated_firewatch_behavior' : 'unknown_unverified', sourceText: value('Inputs', 'C' + r), provenance: provenance('Inputs', r, 'C', ['C' + r]) }));
const summaryCategories = { 5: ['verified_historical_fact', 'real_geographic_location'], 6: ['unknown_unverified', 'simulated_firewatch_behavior'], 7: ['real_geographic_location', 'unknown_unverified'], 8: ['unknown_unverified'], 9: ['real_geographic_location', 'unknown_unverified'], 10: ['real_geographic_location', 'unknown_unverified'], 11: ['hypothetical_2026_observation', 'simulated_firewatch_behavior'] };
const incident = {
  schemaVersion, regionId, id: incidentId, name: 'Dixie Fire',
  historical: { date: '2021-07-13', origin: { latitude: num('Inputs', 'B4'), longitude: num('Inputs', 'B5'), category: 'verified_historical_fact', sourceRefs: [officialId], workbookCells: ['Inputs!B4', 'Inputs!B5'], verificationStatus: 'verified_against_cal_fire' },
    verifiedFacts: [ { id: incidentId + ':date', category: 'verified_historical_fact', value: '2021-07-13', meaning: 'Historical incident date, not a hypothetical detection timestamp', sourceRefs: [officialId] }, { id: incidentId + ':location', category: 'verified_historical_fact', value: 'Above the Cresta Dam, Feather River Canyon', sourceRefs: [officialId] } ] },
  replay: { id: replayId, category: 'simulated_firewatch_behavior', description: value('Summary', 'A2'), basisYear: 2021, resourceSnapshotAsOf: asOf, replayDate: null, actualIncident: false, actualHistoricalDetections: false, implemented: false, timelinePath: 'timeline.json', assumptions: ['2021 fire behavior reused in a hypothetical replay with selected November 2026 sensors/resources.', 'Workbook clock labels are not observed 2026 timestamps.', 'Camera-first and outage-source behaviors are proposals, not existing dashboard features.'], confidenceWeights: null },
  inputs,
  summaryClaims: Array.from({ length: 7 }, (_, i) => { const r = i + 5; return { id: incidentId + ':summary-' + (i + 1), question: value('Summary', 'B' + r), text: value('Summary', 'C' + r), categories: summaryCategories[r], workbookConfidence: value('Summary', 'D' + r), verificationStatus: r === 5 ? 'origin_and_location_verified_only' : 'not_independently_verified', provenance: provenance('Summary', r, 'E', ['E' + r], ['A2']) }; })
};
if (incident.historical.origin.latitude !== 39.871306 || incident.historical.origin.longitude !== -121.389439) throw Error('Workbook origin differs from authorized Dixie origin');
write('dixie-incident.json', incident);
write('cameras.json', collection('cameras', cameras));
write('stations.json', collection('stations', stations));
write('aircraft.json', collection('aviation', aircraft, { verifiedCurrentInventory: [], inventoryNote: 'No individually identified aircraft or current fleet/availability verified in Phase 1. Records are bases/operators, not aircraft assets.', generalCapabilityClaim: { category: 'unknown_unverified', text: value('Aircraft', 'A13'), provenance: { sheet: 'Aircraft', cell: 'A13' } } }));
write('water.json', collection('water', water));
write('timeline.json', collection('timeline', timeline, { incidentId, replayId, hypothetical: true, resourceSnapshotAsOf: asOf, replayDate: null }));
write('sources.json', { schemaVersion, regionId, workbook: { id: 'dixie-reference-workbook', ...workbook.source, snapshotPath: 'workbook-source.json', intendedResourceSnapshotAsOf: asOf }, records: [...sourceEntries.values()] });
write('region.json', { schemaVersion, id: regionId, slug: 'california', name: 'California', countryCode: 'US', subdivisionCode: 'US-CA', timezone: 'America/Los_Angeles', lifecycle: 'data_foundation_only', enabledInDashboard: false, coordinates: { format: 'named_decimal_degree_latitude_longitude', sourceDatum: 'not_explicitly_stated_in_workbook', missingValue: null }, incidents: [{ id: incidentId, path: 'dixie-incident.json', replayIds: [replayId] }], collections: { cameras: 'cameras.json', stations: 'stations.json', aviation: 'aircraft.json', water: 'water.json', timeline: 'timeline.json' }, sourcesPath: 'sources.json', workbookSnapshotPath: 'workbook-source.json', categories, verifiedCurrentInventory: [], notes: ['Inventory presence does not imply dispatch availability.', 'No map camera position or Kansas origin is changed.'] });
console.log(`Imported ${cameras.length} cameras, ${stations.length} stations, ${aircraft.length} aviation entries, ${water.length} water resources, ${timeline.length} replay events; ${sourceEntries.size} source references.`);
