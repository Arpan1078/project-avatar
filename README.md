# Project Avatar
Team Firebenders - Firewatch (WSU College of Innovation and Design)

## Running the dashboard

The map uses CesiumJS with a free Cesium ion token, which is kept out of git.

1. Copy `config.example.js` to `config.js` (git-ignored).
2. Paste your token from https://ion.cesium.com/tokens into `config.js`.
3. Open `index.html` with VS Code Live Server ("Go Live").

Map feature positions are in `map3d.js`, in miles east/north of the fire start.
