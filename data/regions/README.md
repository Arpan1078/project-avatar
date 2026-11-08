# Regional data contract (version 1.0.0)

Phase 2 activates the California geographic view through `regional-map.js` and the `data-region` attribute of its script tag. The selected manifest supplies `mapConfigPath`. Legacy Kansas files remain archived in place; the active regional loader does not request their GeoJSON or instantiate their map entities. The original scenario definitions, confidence calculation, `story.js`, `satellite.js`, drone controller and calculator are retained. See `california/MAP-REPORT.md` for active map scope.

## Layout and extension

`index.json` lists region IDs and relative manifest paths. Each region directory owns a `region.json` manifest, incident files, resource collections, a timeline collection and source references. File names are resolved relative to that manifest, never inferred from a state name. To add another state, create its directory and manifest using a stable ID such as `us-or`, add its sources and collections with the same contract, and register the manifest. Additional incidents belong in the manifest's `incidents` array. Additional replay timelines can be added to the collections map and referenced by the incident's `replay.timelinePath`. No dashboard code needs changing to author another package. To activate another region, supply its `mapConfigPath` with the same resource collection contract and select its manifest in the script tag.

The Kansas story origin is deliberately unchanged. Regional map cameras and geometry are configured separately in each region's `map.json`. The current runtime uses local miles relative to `STORY.ORIGIN`, a fixed Kansas data-file list, inline scenario definitions, simulated GOES-East/VIIRS data and a fixed CDT clock. The regional adapter isolates those legacy dependencies; Dixie simulation integration remains Phase 3. Workbook references to GOES-18, a camera-first mode and an outage source are replay proposals, not implemented features.

## Common fields

- `schemaVersion`: version of this contract. Breaking field or meaning changes require a new major version.
- `regionId`: the owning manifest ID. Resource IDs are region-prefixed; original camera IDs remain in `externalId`.
- Resource collections: `{schemaVersion, regionId, kind, workbookId, records}`. An aviation record is explicitly a `base` or `operator`; it is not an identified aircraft.
- `location.latitude` and `location.longitude`: decimal-degree numbers or `null`, each named explicitly. Never use Kansas local offsets, zero placeholders, copied nearby coordinates or geocoded guesses. Source datum is not declared in this workbook. A future GeoJSON adapter must explicitly use `[longitude, latitude]` and confirm the datum.
- `location.pointMeaning`: distinguishes camera mounts, stations, airport estimates and dam reference points. A dam coordinate is not a verified water-access point.
- `availability`, `responseTimeMinutes` and other unsupplied operational fields remain `null`. Null means unknown, never zero, unavailable, available or false. A listed resource does not imply dispatchability.
- `verification` preserves the workbook's confidence wording, but separately records independent verification status and the claimed snapshot date. `inventoryAsOf: null` means no current inventory validation occurred.
- `provenance` retains workbook sheet, row, cell range, exact source text, source IDs, inherited sheet notes and cell comments. The original values, cached formulas and formats are preserved in `workbook-source.json`; references to that snapshot resolve via `sources.json`.
- `workbookGeometry` holds cached calculated values, not independently observed distances. Distances are straight-line km, not driving routes or response times. Cached values are not recalculated or silently updated during import. Camera view/range flags are also cached formulas and do not establish line of sight or detection.

## Claim categories

Categories apply to claims, not just entire records. A real camera location can coexist with unverified snapshot orientation and a hypothetical observation. Do not promote an entire mixed row to historical fact.

| Category | Meaning |
| --- | --- |
| `verified_historical_fact` | A specific historical claim checked against the cited authoritative source. Phase 1 verifies the Dixie date, origin and named location only. |
| `real_geographic_location` | A record intended to identify a real place. Its coordinate accuracy/currentness still depends on `verification`; this category alone is not certification. |
| `current_resource_inventory` | A resource inventory verified for a stated date. No records qualify in this import; verified-inventory arrays are empty. |
| `hypothetical_2026_observation` | A proposed observation using selected November 2026 sensors, not a measured or historical detection. |
| `simulated_firewatch_behavior` | Proposed replay inputs, levels or actions. These do not change the existing scoring or pipeline. |
| `unknown_unverified` | Unsourced, approximate, incomplete or not independently checked claims, including workbook history awaiting confirmation. |

`workbookConfidence` and `workbookType` retain terms such as “Official” and “2021 fact” verbatim. They are source assertions, not automatic promotion to verified status. Do not turn workbook INFO/WATCH/ALERT labels into numerical confidence weights.

## Time and historical separation

The incident date is 2021-07-13. The workbook describes a hypothetical replay of that fire with selected resources/sensors as of 2026-11-07. That is a resource snapshot date, not a new ignition date or the date of a measured detection. `replayDate` and detection timestamps are null. Keep textual local clock labels, approximate windows, “time unknown,” and “next day” as supplied. The region uses `America/Los_Angeles`; do not reuse the Kansas fixed UTC offset or create UTC timestamps from incomplete labels.

Timeline rows separate `historicalContext`, `observation` and `firewatchBehavior`. Even rows marked “2021 fact” contain hypothetical camera/satellite statements. Those observations remain hypothetical. `implemented: false` means the imported replay behavior has not been connected to Firewatch. It does not disable existing Kansas behavior.

## Reproducible import and lightweight validation

Run from the repository root:

1. `powershell -File scripts/read-dixie-workbook.ps1` reads the XLSX through .NET ZIP/XML into the source snapshot. Where unsigned script files are disallowed, run the reviewed script as an in-session script block: `& ([scriptblock]::Create((Get-Content -Raw -LiteralPath scripts/read-dixie-workbook.ps1)))`. No persistent execution-policy change is needed.
2. `node scripts/import-dixie-region.cjs` builds the normalized California files from that snapshot.
3. `node scripts/validate-region-data.cjs` checks manifests, record mappings, sources, nulls, coordinates, classifications and workbook hash.

The importer is specifically mapped to this workbook's seven sheets. Review mappings if the workbook layout changes. It deliberately stops if the origin or sheet set changes; the validator checks all expected source records. The exporter does not modify the workbook or recalculate formulas. The source registry records the limited CAL FIRE verification performed for this import; a future workbook revision requires review of that evidence before reusing its verification claim.

## Phase 2 geographic refresh

Run `scripts/fetch-california-geography.ps1` from the repository root with public network access, then `node scripts/build-california-geography.cjs`. The latter clips and simplifies source geometry, writes attribution, and creates a separate station-coordinate supplement. Raw responses with query URLs are retained in `reference-data/california-map-cache/`. Run `node scripts/validate-california-map.cjs` and `node scripts/validate-region-data.cjs` after changes. No browser automation is used. The importer preserves an existing map configuration when regenerating the Phase 1 workbook records.
