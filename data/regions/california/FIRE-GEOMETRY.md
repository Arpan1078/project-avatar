# Phase 3B illustrative fire geometry

No time-specific historical perimeter was found in the local regional package.
The renderer uses the documented origin (39.871306, -121.389439) and the
original wildfire colors, seeded effect helper and burned-area texture.

Area anchors from `timeline.json` / workbook `Timeline today`:
- Rows 5–7: no numeric size; ignition symbol and ember only.
- Row 8, 4:30 PM: 600 sq ft, the lower end of the workbook's 600–800 range.
- Row 9, 5:12 PM: 1,600 sq ft, derived from the approximate 40 × 40 ft dimensions.
- Row 10, 5:42 PM: approximately 2 acres; workbook labels this an estimate.
- Row 11, overnight: “Hundreds of acres” is not assigned an invented numeric
  acreage. The last 2-acre footprint remains, explicitly labeled as held.
- Row 12, July 14 at 8 AM: approximately 500 acres.

Shapes are deterministic irregular radial polygons normalized to horizontal
area, not measured perimeters, terrain surface areas or a Kansas grassland
spread model. Cesium drapes fill, boundaries and ember points on terrain.
No slope, wind, fuels, barriers, spotting or canyon direction is inferred.
Forward transitions take 1.1 display seconds, not elapsed incident time;
rewinding restores the earlier footprint immediately.

Likely path toggles a 1.4× radial illustrative envelope. This is a display
assumption with no forecast horizon, probability or structures-at-risk claim.
The incident label remains visible at distance; physical fire sizes are not
enlarged for readability. Ground geometry and 24 ember effects update at most
about seven times per second. Entities and the render listener are reused.

Manual checks: advance and rewind all steps; inspect at close range and tilt;
toggle Likely path independently of the fire; toggle resource layers; swap
the map and drone windows. No browser automation was run.
