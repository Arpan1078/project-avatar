# California Phase 1 import report

Imported all seven sheets from `reference-data/Dixie_Today_Scenario.xlsx`. The workbook is a hypothetical replay of 2021 Dixie Fire behavior using selected sensors/resources as of November 7, 2026. No UI, map positioning, existing scenario, calculator or configuration was changed. Nothing is connected to the runtime yet.

| Sheet | Imported content | Missing coordinates |
| --- | --- | --- |
| Summary | 7 claims, original confidence text and sources; replay framing | Not applicable |
| Inputs | 4 inputs, including the documented origin and workbook range/radius settings | None |
| Cameras | 7 IDs, names, coordinate pairs, elevations, facing/FOV snapshots and cached geometry flags | 0 |
| Stations | 6 station records and addresses | 5 |
| Aircraft | 7 aviation entries: 1 base and 6 operators, not verified individual aircraft | 6 |
| Water | 7 water records, reference-point meanings and notes | 2 |
| Timeline today | 8 ordered rows with historical context separated from hypothetical observations and proposed levels | Not applicable |

All 15 distinct source references (14 URLs plus the team-estimate attribution) are in `sources.json`. Per-record sources, confidence notes and inherited sheet notes are retained. `workbook-source.json` also retains every populated cell, 48 formulas and their cached values, number formats, and the Aircraft!D5 cell comment. No workbook calculations or dates were invented.

## Verified and unverified

The origin **39.871306, -121.389439**, incident date **2021-07-13**, and location above Cresta Dam in Feather River Canyon were checked against the [CAL FIRE Dixie incident page](https://www.fire.ca.gov/incidents/2021/7/13/dixie-fire). This check does not validate the workbook's later resource or detection claims. CAL FIRE's displayed incident start clock is 5:15 PM; the workbook's 6:48 AM fault and 5:12 PM call are separate claims and have not been substituted for it.

Current resource inventory and operational availability were not independently verified. Verified-inventory arrays are empty. Availability, staffing, apparatus counts, aircraft counts/tail numbers, fire contracts/carding, response times, water access and current water levels remain null. Capability descriptions are retained as claims, not availability promises.

- **Stations:** Concow 37, Concow Lake 38, Brush Creek 60, Berry Creek 61 and Oroville FS lack coordinates. Summary!D7 says four are missing, but the actual station sheet has five. Both the source statement and discrepancy are preserved.
- **Aviation:** Aero-Flite, Porter Flying Services, Jones Aviation, C & J Applicators, Pacific Valley Aviation and Anderson's Flying Service lack coordinates. Chico airport's supplied coordinates are explicitly an **approximate team estimate** in Aircraft!D5; that comment is preserved. No operator inherits airport coordinates or fleet availability.
- **Water:** North Fork Feather River and Lake Oroville lack coordinates. The five supplied reservoir locations use dam points; they are not confirmed dip/scoop/intake sites. Access, water depth, permissions and scooping suitability need review.
- **Cameras:** The supplied list was only partially read. Facing and FOV are snapshots. Terrain line of sight was not checked; camera alignment is not evidence of smoke detection. Recheck the full authoritative list and mounting metadata before integration.
- **History and observations:** Early growth, fault and call details rely on the workbook's secondary-source citation and need primary historical evidence. Hypothetical GOES-18/VIIRS observations, smoke visibility, pass timing and “fully confirmed” wording are not measured detections. No exact detection timestamp or confidence weight was created.
- **Proposed behavior:** Camera-first mode and the outage-source flag remain proposals. The imported notes do not assert those features exist in the current code.

## Manual verification

1. Compare each collection's counts and selected rows with all seven workbook sheets, including the Chico coordinate comment.
2. Confirm the Dixie origin, preserved source URLs and per-record confidence/verification notes.
3. Check all 13 incomplete resource coordinate pairs remain null, and operational availability is unknown.
4. Confirm every timeline observation is hypothetical, with no assigned detection timestamp or score weight.
5. Open the existing dashboard normally: Kansas positioning, scenarios, drone, satellite layers, calculator and playback should remain unchanged; no California option is added in Phase 1.
