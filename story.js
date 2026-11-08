/* =====================================================================
   story.js: where the simulated story happens, on real geography.

   The fire, people and equipment are simulated. The places they sit on are
   real (see data/ and scripts/fetch-data.py):
   - Fire start: on the real 345 kV Oklahoma Gas & Electric transmission line
     (OpenStreetMap), in grassland (USGS NLCD class 71) about 8 mi south of
     Medicine Lodge, Barber County, Kansas. A cluster of real buildings sits
     2.0 to 2.4 mi downwind (NNE to NE), the nearest pond is about 0.4 mi away.
   - District station ("Cottonwood Creek station", simulated): the hamlet of
     Stubbs, 11.3 mi SSE. It is not a real fire station; real departments are
     shown separately ("Help nearby").
   - Planned burn ("Section 22", simulated registration): a half-mile square of
     grassland 4.4 mi north of the station, just SW of a real highway, so the
     escape to the NE "jumps the road". Real buildings ~2.2 mi NE of the escape.

   Positions are MILES EAST and MILES NORTH of the fire start: [east, north].
   Used by map3d.js, mapdata.js, satellite.js and the dashboard.
   ===================================================================== */
(function () {
  'use strict';

  // The fire start, on the real power line.
  const ORIGIN = { lat: 37.16610, lon: -98.60898 };
  const METERS_PER_MILE = 1609.344;
  const METERS_PER_DEG_LAT = 111320;
  const cosLat = Math.cos(ORIGIN.lat * Math.PI / 180);

  // [east, north] miles -> [lon, lat] degrees, and back.
  const toLonLat = p => [
    ORIGIN.lon + (p[0] * METERS_PER_MILE) / (METERS_PER_DEG_LAT * cosLat),
    ORIGIN.lat + (p[1] * METERS_PER_MILE) / METERS_PER_DEG_LAT
  ];
  const toLocal = (lon, lat) => [
    ((lon - ORIGIN.lon) * METERS_PER_DEG_LAT * cosLat) / METERS_PER_MILE,
    ((lat - ORIGIN.lat) * METERS_PER_DEG_LAT) / METERS_PER_MILE
  ];

  // Planned burn: the registered half-mile square (160 acres).
  const SECTION_22 = { center: [1.87, -6.61], halfMi: 0.25, label: 'Registered burn: Section 22, 10:00 am to 2:00 pm' };

  const STORY = {
    ORIGIN, METERS_PER_MILE, METERS_PER_DEG_LAT, toLonLat, toLocal,

    // Fictional district boundary (~24 x 19 mi, ~460 sq mi) around the fire and station.
    DISTRICT_CORNERS: [[-11.0, 4.5], [13.0, 4.8], [13.3, -14.5], [-10.8, -14.2]],

    // District station (simulated), at the hamlet of Stubbs.
    STATION: toLocal(-98.5659, 37.0067),
    STATION_NAME: 'Cottonwood Creek station',

    // Neighbor who sends the photo at 1:59: a real building 2 mi east of the fire.
    REPORTER: toLocal(-98.57218, 37.16798),

    // Lease water truck (simulated). Snapped to the nearest real road by mapdata.js.
    WATER_TRUCK: [1.5, -0.3],

    SECTION_22,

    // Where each fire starts (a fire grows downwind from its start point).
    PLACES: {
      line:   [0, 0],                                                       // Cottonwood Creek fire
      burn:   [SECTION_22.center[0] - 0.18, SECTION_22.center[1] - 0.18],    // lit in the SW of Section 22
      escape: [SECTION_22.center[0] + 0.42, SECTION_22.center[1] + 0.42]     // 0.6 mi NE, across the highway
    },

    // Weekend permitted burns (simulated, both out), on open land.
    BURNS: [
      { at: [4.4, -8.9], radiusMi: 0.45, label: 'Permitted burn, Sat (out)' },
      { at: [-3.6, -4.2], radiusMi: 0.35, label: 'Permitted burn, Sun (out)' }
    ],

    // Starting cameras, looking downwind, tilted 45 degrees down.
    //   district: the fire, the station and the area the fire spreads into.
    //   burn:     Section 22, the escape and the buildings downwind.
    CAMERAS: {
      district: { target: [1.6, -4.2], headingDeg: 20, pitchDeg: -45, rangeM: 33000 },
      burn:     { target: [2.9, -5.6], headingDeg: 30, pitchDeg: -45, rangeM: 12500 }
    },

    // GOES pixels: one fixed grid ~2 km (1.243 mi) apart. The grid is placed so
    // the fire start is in cell [0, 0], the whole registered square is in one
    // cell (burnCell) and the escape is in the next cell north (escapeCell).
    GOES: { pixelMi: 1.243, cell00: [0.50, 0.557], burnCell: [1, -6], escapeCell: [1, -5] },

    // Help nearby: simulated status of the real fire departments (dot colors).
    HELP_STATUS: {
      available:  { text: 'Available', color: '#5FBF77' },
      headsup:    { text: 'Heads-up', color: '#E8B04A' },
      responding: { text: 'Responding', color: '#E8B04A' },
      busy:       { text: 'Busy, on its own fire', color: '#8A7F70' }
    },

    // VIIRS hotspot over the escape (12:50 pass).
    FIRMS_ESCAPE: [SECTION_22.center[0] + 0.50, SECTION_22.center[1] + 0.50]
  };

  window.STORY = STORY;
})();
