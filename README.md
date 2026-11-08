# Project Avatar
Team Firebenders - Firewatch (WSU College of Innovation and Design)

## Running the dashboard

The map uses CesiumJS with a free Cesium ion token, which is kept out of git.

1. Copy `config.example.js` to `config.js` (git-ignored).
2. Paste your token from https://ion.cesium.com/tokens into `config.js`.
3. Open `index.html` with VS Code Live Server ("Go Live").

Real map data (water, creeks, power lines, roads, buildings, towns and fire
departments) is in `data/`, from OpenStreetMap contributors, USGS and HIFLD.
Re-download it with `python scripts/fetch-data.py`. The dashboard reads these
files over http, so open it with Live Server (not as a `file://` page).

The simulated story (fire start, station, planned burn, neighbor, water truck)
is placed on that real geography in `story.js`, in miles east/north of the fire
start. Fire colors and glow (wildfire, planned burn, escaped burn) are in
`fire-types.js`.
