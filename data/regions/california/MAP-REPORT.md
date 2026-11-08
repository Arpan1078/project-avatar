# Phase 2 California map report

The active Cesium view is centered on the documented Dixie ignition at **39.871306, -121.389439**, in Feather River Canyon, California. The existing viewer, World Terrain, aerial imagery, dark styling, orbit/zoom controls, reset control, credits, Simple/Full layouts, collapsible legend and draggable/resizable map-camera swap are retained. No complete Dixie progression is implemented.

## Active map data

| Layer | Included |
| --- | --- |
| Incident | Dixie ignition marker; historical date and CAL FIRE source in its callout |
| Cameras | All 7 workbook camera IDs, at recorded coordinates; co-located paired cameras use separate screen offsets without moving their geographic positions |
| Fire stations | 4 USGS reference locations: Jarbo Gap 36, Concow 37, Concow Lake 38 and Stirling City 13 |
| Water markers | 5 workbook dam/reference points: Cresta, Poe, Rock Creek, Belden Forebay and Lake Almanor |
| Aerial support | Chico Regional Airport, explicitly approximate workbook airport coordinates; no aircraft availability claim |
| Roads | 787 grouped multiline features from 3,789 USGS state/local road records |
| Streams/rivers | 155 grouped multiline features from 2,721 named USGS NHD flowlines, including North Fork Feather River |
| Water polygons | 222 clipped USGS NHD polygons, including nearby lakes/reservoirs and the in-bounds part of Lake Oroville |
| Buildings | 364 in-bounds OSM footprint reference points from a public ArcGIS mirror; 373 source records intersected the box |
| Places | 31 points from 29 USGS GNIS populated-place records; some source records have multiple points |
| Power lines | Omitted: no incident-specific utility route independently verified |

Geographic context is clipped to **west -121.58, south 39.70, east -121.20, north 40.04**. More distant documented resource markers are retained separately. The six geographic layer files total approximately **1.54 MiB**. Lines are simplified to 0.00005 degrees and rounded to six decimal places. Same-named line parts are grouped without connecting unrelated segments. These display layers are not a routing graph.

Camera callouts show names/IDs, straight-line distance, facing, FOV, elevation, source and the workbook's recorded horizontal-view match. They explicitly identify the **November 7, 2026 snapshot**, not verified 2021 pointing. No bearing/FOV match is treated as terrain line of sight or actual detection. The existing Satellite chip controls these recorded camera markers in Phase 2; no synthetic Kansas satellite pixels are rendered.

USGS station evidence lives in `geography/resource-verification.json`. It corroborates Jarbo Gap near its workbook coordinates and supplies positions for Concow 37 and Concow Lake 38 by station number/name/address. Stirling City is an additional mapped station. The original workbook import files and their missing values remain unchanged. The Nearby help tab lists sourced regional locations without estimated response times or invented availability.

## Scope and limitations

- Legacy scoring and timelines are retained as a **legacy demo**, not relabeled as Dixie history. The map ignores their fire polygons, registered burns, fictional district boundary, roads/routes, help-status colors, fault marker, forecast zone and synthetic satellite detections. Legacy geographic popups/outcome banners are not placed on the California map. The confidence overlay remains available and explains the Phase 2 boundary.
- Map-related home counts have no active Dixie forecast to count against. The forecast panel explicitly says that progression and structures at risk await Phase 3.
- The wind control preserves the rotating north compass. No Kansas wind streaks or unverified California weather are drawn. Power, permitted-burn, risk and likely-path chips remain present with Phase 2 explanations; they do not invent geometry.
- The drone picture-in-picture interface remains usable, including repeated swaps. It displays **camera unavailable** because no Dixie drone deployment or footage has been authorized. The thermal renderer remains in the code for a later simulation phase; it is not presented as Dixie footage.
- Brush Creek 60, Berry Creek 61 and Oroville FS still lack sourced map coordinates in this package. Unverified aviation operators are not mapped as available aircraft.
- North Fork Feather River and Lake Oroville have no workbook point coordinates; actual USGS river/polygon geometry supplies context without inventing those missing workbook points. Reservoir markers are dam reference locations, not verified dip/scoop access sites.
- Building and place data are contemporary source snapshots and may include older records. They are not a verified reconstruction of structures surviving the 2021 fire, occupied homes or an operational exposure count.
- Terrain and aerial imagery still require the existing working Cesium configuration and network connection. The geographic JSON is served locally after download. A failed regional load produces an error, never a fallback to Kansas geometry.

## Sources and attribution

- [USGS National Transportation Dataset](https://cartowfs.nationalmap.gov/arcgis/rest/services/transportation/MapServer): U.S. Census TIGER/Line and USFS-derived roads; public domain.
- [USGS National Hydrography Dataset](https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer): water polygons and flowlines; public domain.
- [USGS GNIS](https://cartowfs.nationalmap.gov/arcgis/rest/services/geonames/MapServer): geographic place records; public domain.
- [USGS National Structures Dataset](https://cartowfs.nationalmap.gov/arcgis/rest/services/structures/MapServer): station reference points; public domain.
- [Public OSM building mirror](https://services6.arcgis.com/Do88DoK2xjTUCXd1/ArcGIS/rest/services/OSM_NA_Buildings/FeatureServer): OpenStreetMap contributors, [ODbL attribution/license](https://www.openstreetmap.org/copyright).
- Workbook resource source URLs remain attached to each marker. [Butte County](https://www.buttecounty.ca.gov/563/Chico-Air-Attack-Base) documents Chico's air-attack base, without establishing current availability.

`geography/sources.json` records source endpoints, query bounds, source counts, retrieval date and raw-response SHA-256 hashes. Raw paginated downloads and exact query URLs are in `reference-data/california-map-cache/`. Overpass endpoints rejected or timed out requests, so the public USGS/ArcGIS sources above were used instead.

## Verification performed

Lightweight checks passed for JavaScript syntax, JSON structure, bounds, closed polygon rings, source provenance and the workbook import. A Node-only adapter check exercised 290 retained scenario/step/view/tab combinations and confirmed that all runtime geography requests use the California directory. No browser tests or screenshots were run. Scenario definitions, confidence mathematics, story coordinates, satellite engine, drone window controller and calculator were compared with their prior tracked versions and remain unchanged.

## Manual checks

1. Start through the usual local web server. Confirm Feather River Canyon and the labeled Dixie ignition; Reset view should return there after orbit/zoom.
2. Confirm California roads, river/lake geometry and town labels. Zoom in for building points. No Kansas district, Section 22, routes, utility lines or synthetic hotspots should appear, even during timeline playback.
3. Click each camera, including both members of the paired sites. Check distance, FOV/facing, source link, snapshot date and visibility caveat.
4. Inspect Jarbo Gap, Concow 37, Concow Lake 38 and Stirling City. Check unknown availability. Zoom out to inspect Chico Airport and the more distant reservoir markers.
5. Toggle Water, Homes, Fire stations/Help nearby and Satellite; stations are visible while either station/help control is on. Verify the north compass rotates with the camera and the legend expands/collapses.
6. Open Drone, drag/resize/minimize it, swap it with the live map repeatedly, and test map rotation/zoom in the small window. Camera-unavailable is expected in Phase 2.
7. Switch Simple/Full views, scenarios, timeline steps and calculator. Confirm layout and legacy scoring still work and the browser console has no errors. No Dixie fire growth should occur yet.
