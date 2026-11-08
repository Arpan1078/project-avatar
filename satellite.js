/* =====================================================================
   satellite.js: satellite fire detections for the Firewatch dashboard

   Two data sources, in the SAME field names and structure as the real feeds,
   so the backend can replace the simulated data without changing the
   dashboard or the map:

   - NOAA GOES-East Fire Detection (ABI Fire/Hot Spot Characterization)
       { latitude, longitude, scan_time, fire_mask, fire_mask_label, frp_mw, satellite }
       scan_time: ISO timestamp (UTC). frp_mw: fire radiative power, megawatts.
   - NASA FIRMS active fire hotspots (VIIRS, same names as the FIRMS CSV/API)
       { latitude, longitude, acq_date, acq_time, confidence, frp, satellite, instrument, daynight }
       acq_date "YYYY-MM-DD" and acq_time "HHMM" are UTC, as in FIRMS.
       confidence: "low" | "nominal" | "high". daynight: "D" | "N".

   Public functions (window.Satellite):
     getGoesDetections(scenario, time)  -> GOES detections from the latest scan at or before `time`
     getFirmsHotspots(scenario, time)   -> FIRMS hotspots from the latest VIIRS pass at or before `time`
     getGoesScanTime(scenario, time)    -> ISO time of that latest GOES scan (even with no detections)
     getFirmsPassInfo(scenario, time)   -> { lastPass: ISO | null, note: text | null }
     toIso(scenario, clock, ampm)       -> ISO timestamp for a scenario clock time, e.g. ('real', '1:57', 'pm')
     describe(obj), formatTime(iso)     -> plain-words text for info cards and the Data tab
   `scenario` is a scenario key: 'real', 'realNoPower', 'outage' or 'burn'.
   `time` is an ISO timestamp (or a Date).
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Data source setting ---------- */

  // "simulated" = the made-up data below. "api" = read from the backend.
  const DATA_SOURCE = 'simulated';

  // When DATA_SOURCE is "api", the backend is expected to answer something like:
  //   GET  https://YOUR-BACKEND.example/api/fires?bbox=-99.3,37.0,-98.7,37.4&since=2026-03-12T18:00:00Z
  //   200  {
  //          "goes":  [ { "latitude": 37.205, "longitude": -98.979, "scan_time": "2026-03-12T18:57:00Z",
  //                       "fire_mask": 13, "fire_mask_label": "High probability fire", "frp_mw": 18.4,
  //                       "satellite": "GOES-East" } ],
  //          "firms": [ { "latitude": 37.152, "longitude": -98.889, "acq_date": "2026-04-15", "acq_time": "1750",
  //                       "confidence": "nominal", "frp": 6.2, "satellite": "N", "instrument": "VIIRS",
  //                       "daynight": "D" } ]
  //        }
  // const API_URL = 'https://YOUR-BACKEND.example/api/fires';
  // In "api" mode the dashboard should fetch that into `apiCache` (e.g. once a
  // minute) and the getters below filter it by time; see readApi().
  const apiCache = { goes: [], firms: [], goesScans: [], firmsPasses: [] };

  /* ---------- Fire mask codes (GOES ABI Fire Detection) ---------- */

  const FIRE_MASK = {
    10: 'Processed fire',
    11: 'Saturated fire',
    12: 'Cloud contaminated fire',
    13: 'High probability fire',
    14: 'Medium probability fire',
    15: 'Low probability fire'
  };
  // Strongest first (used to pick the "headline" detection).
  const MASK_STRENGTH = [10, 11, 13, 14, 15, 12];

  /* ---------- Scenario dates and clock ---------- */

  // Scenario days (assumed dates) and the local UTC offset (Kansas, CDT = UTC-5).
  const SCENARIO_DATE = { real: '2026-03-12', realNoPower: '2026-03-12', outage: '2026-04-16', burn: '2026-04-15' };
  const UTC_OFFSET_HOURS = -5;

  function toIso(scenario, clock, ampm) {
    const [y, mo, d] = SCENARIO_DATE[scenario].split('-').map(Number);
    const [h, m] = clock.split(':').map(Number);
    const h24 = (h % 12) + (ampm === 'pm' ? 12 : 0);
    return new Date(Date.UTC(y, mo - 1, d, h24 - UTC_OFFSET_HOURS, m)).toISOString().replace('.000Z', 'Z');
  }
  // "1:57 pm" from an ISO time (local clock).
  function formatTime(iso) {
    const t = new Date(new Date(iso).getTime() + UTC_OFFSET_HOURS * 3600e3);
    const h = t.getUTCHours(), m = t.getUTCMinutes();
    return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }
  const ms = t => new Date(t).getTime();

  /* ---------- Where the simulated pixels are ---------- */

  // Same anchor and units as the map: miles east/north of the fire start (story.js).
  const STORY = window.STORY;
  function latLon(e, n) {
    const [lon, lat] = STORY.toLonLat([e, n]);
    return { latitude: +lat.toFixed(5), longitude: +lon.toFixed(5) };
  }

  // GOES pixels sit on one fixed grid about 2 km (1.243 mi) apart (story.js).
  // Cell [0, 0] contains the Cottonwood Creek fire start; BURN is the cell
  // holding Section 22 (the planned burn); ESC is the cell north of it, where
  // the escape is.
  const GOES_PIXEL_MI = STORY.GOES.pixelMi;
  const GOES_CELL_00 = STORY.GOES.cell00;   // center of cell [0, 0], miles east/north
  const BURN = STORY.GOES.burnCell, ESC = STORY.GOES.escapeCell;
  const goesCell = (i, j) => latLon(GOES_CELL_00[0] + i * GOES_PIXEL_MI, GOES_CELL_00[1] + j * GOES_PIXEL_MI);

  /* ---------- Simulated GOES timelines ----------
     scans:   when GOES-East scanned (every 5 minutes; times are assumed).
     changes: [scan time, pixels] where each pixel is [cell i, cell j, fire_mask, frp_mw].
              Each scan reports the pixels of the latest change at or before it. */
  const GOES_SIM = {
    // Real fire: first seen 1:52 (low probability), high probability by 1:57,
    // then processed fire spreading to 2, then 3 to 4 pixels downwind (NNE).
    real: {
      scans: { first: '1:42 pm', last: '2:37 pm', everyMin: 5 },
      changes: [
        ['1:42 pm', []],
        ['1:52 pm', [[0, 0, 15, 3.1]]],
        ['1:57 pm', [[0, 0, 13, 18.4]]],
        ['2:02 pm', [[0, 0, 10, 46.0], [0, 1, 10, 12.5]]],
        ['2:07 pm', [[0, 0, 10, 58.2], [0, 1, 10, 24.7]]],
        ['2:12 pm', [[0, 0, 10, 70.3], [0, 1, 10, 41.0], [-1, 0, 14, 8.6]]],
        ['2:17 pm', [[0, 0, 10, 82.5], [0, 1, 10, 63.8], [-1, 0, 10, 15.2]]],
        ['2:22 pm', [[0, 0, 10, 96.1], [0, 1, 11, 142.7], [-1, 0, 10, 21.4], [-1, 1, 13, 17.9]]]
      ]
    },
    // Power data off: the replay assumes the first GOES detection at 2:04,
    // then the same upgrade pattern.
    realNoPower: {
      scans: { first: '1:44 pm', last: '2:39 pm', everyMin: 5 },
      changes: [
        ['1:44 pm', []],
        ['2:04 pm', [[0, 0, 15, 9.8]]],
        ['2:09 pm', [[0, 0, 13, 27.5]]],
        ['2:14 pm', [[0, 0, 10, 52.0], [0, 1, 10, 19.3]]],
        ['2:19 pm', [[0, 0, 10, 74.6], [0, 1, 10, 48.1], [-1, 0, 10, 13.0]]],
        ['2:29 pm', [[0, 0, 10, 101.2], [0, 1, 11, 151.0], [-1, 0, 10, 26.5], [-1, 1, 10, 22.4]]],
        ['2:34 pm', [[0, 0, 10, 118.7], [0, 1, 11, 188.3], [-1, 0, 10, 35.9], [-1, 1, 10, 41.6]]]
      ]
    },
    // Power outage: GOES keeps scanning and sees nothing.
    outage: {
      scans: { first: '10:32 am', last: '10:57 am', everyMin: 5 },
      changes: [['10:32 am', []]]
    },
    // Planned burn: Section 22 pixel from the burn's start, then a new pixel
    // outside the registered area over the escape at 12:48.
    burn: {
      scans: { first: '8:58 am', last: '1:03 pm', everyMin: 5 },
      changes: [
        ['8:58 am',  []],
        ['10:03 am', [[...BURN, 14, 4.2]]],
        ['10:18 am', [[...BURN, 13, 9.7]]],
        ['12:28 pm', [[...BURN, 10, 31.5]]],
        ['12:48 pm', [[...BURN, 10, 33.0], [...ESC, 15, 5.4]]]
      ]
    }
  };

  /* ---------- Simulated FIRMS (VIIRS) passes ----------
     passes: [local time, hotspots]; each hotspot [miles east, miles north, confidence, frp, daynight].
     note:   shown when the latest pass had no hotspots. All pass times are assumed. */
  const FIRMS_SIM = {
    real: {
      passes: [['1:30 pm', []]],
      note: 'Last VIIRS pass about 1:30 pm, before the fire started (assumed). Next pass tonight.'
    },
    realNoPower: {
      passes: [['1:30 pm', []]],
      note: 'Last VIIRS pass about 1:30 pm, before the fire started (assumed). Next pass tonight.'
    },
    outage: {
      passes: [['2:10 am', []]],
      note: 'Last VIIRS pass about 2:10 am (assumed). Next pass early this afternoon.'
    },
    burn: {
      passes: [
        ['1:45 am', []],
        ['12:50 pm', [[...STORY.FIRMS_ESCAPE, 'nominal', 6.2, 'D']]]   // afternoon pass over the escape
      ],
      note: 'Last VIIRS pass about 1:45 am (assumed). Next pass about 12:50 pm (assumed).'
    }
  };

  /* ---------- Simulated getters ---------- */

  function goesScanTimes(scenario) {
    const s = GOES_SIM[scenario].scans, out = [];
    const ampm = c => c.split(' ');
    let t = ms(toIso(scenario, ...ampm(s.first)));
    const end = ms(toIso(scenario, ...ampm(s.last)));
    for (; t <= end; t += s.everyMin * 60e3) out.push(t);
    return out;
  }

  function simGoes(scenario, time) {
    const sim = GOES_SIM[scenario];
    if (!sim) return { scan: null, detections: [] };
    const now = ms(time);
    const scan = goesScanTimes(scenario).filter(t => t <= now).pop();
    if (scan === undefined) return { scan: null, detections: [] };
    let pixels = [];
    for (const [clock, px] of sim.changes) if (ms(toIso(scenario, ...clock.split(' '))) <= scan) pixels = px;
    const scanIso = new Date(scan).toISOString().replace('.000Z', 'Z');
    return {
      scan: scanIso,
      detections: pixels.map(([i, j, mask, frp]) => Object.assign(goesCell(i, j), {
        scan_time: scanIso,
        fire_mask: mask,
        fire_mask_label: FIRE_MASK[mask],
        frp_mw: frp,
        satellite: 'GOES-East'
      }))
    };
  }

  function simFirms(scenario, time) {
    const sim = FIRMS_SIM[scenario];
    if (!sim) return { pass: null, hotspots: [], note: null };
    const now = ms(time);
    let pass = null, spots = [];
    for (const [clock, hs] of sim.passes) {
      const t = toIso(scenario, ...clock.split(' '));
      if (ms(t) <= now) { pass = t; spots = hs; }
    }
    const hotspots = pass ? spots.map(([e, n, confidence, frp, daynight]) => {
      const iso = pass;                                  // UTC acquisition time
      return Object.assign(latLon(e, n), {
        acq_date: iso.slice(0, 10),
        acq_time: iso.slice(11, 13) + iso.slice(14, 16),   // "HHMM", UTC
        confidence, frp,
        satellite: 'N',                                  // FIRMS code for Suomi NPP
        instrument: 'VIIRS',
        daynight
      });
    }) : [];
    return { pass, hotspots, note: hotspots.length ? null : sim.note };
  }

  // "api" mode: filter whatever the backend returned by time (placeholder).
  function readApi(kind, time) {
    const now = ms(time);
    if (kind === 'goes') {
      const scans = apiCache.goesScans.filter(t => ms(t) <= now);
      const scan = scans[scans.length - 1] || null;
      return { scan, detections: apiCache.goes.filter(d => d.scan_time === scan) };
    }
    const passes = apiCache.firmsPasses.filter(t => ms(t) <= now);
    const pass = passes[passes.length - 1] || null;
    const hotspots = apiCache.firms.filter(h => pass && `${h.acq_date}T${h.acq_time.slice(0, 2)}:${h.acq_time.slice(2)}:00Z` === pass);
    return { pass, hotspots, note: null };
  }

  const goes = (scenario, time) => (DATA_SOURCE === 'api' ? readApi('goes', time) : simGoes(scenario, time));
  const firms = (scenario, time) => (DATA_SOURCE === 'api' ? readApi('firms', time) : simFirms(scenario, time));

  /* ---------- Plain-words text ---------- */

  function firmsTime(h) {
    return formatTime(`${h.acq_date}T${h.acq_time.slice(0, 2)}:${h.acq_time.slice(2)}:00Z`);
  }
  function describe(o) {
    if (o.fire_mask !== undefined) {
      return `GOES-East: ${o.fire_mask_label} · ${Math.round(o.frp_mw)} MW · Scan ${formatTime(o.scan_time)} · ` +
        `${o.latitude.toFixed(2)} N, ${Math.abs(o.longitude).toFixed(2)} W`;
    }
    return `FIRMS VIIRS: Confidence: ${o.confidence} · ${o.frp.toFixed(1)} MW · ${firmsTime(o)} · ${o.daynight === 'D' ? 'Day' : 'Night'} pass`;
  }
  // Strongest detection of a list (for headlines such as "high probability").
  function strongest(detections) {
    return detections.slice().sort((a, b) => MASK_STRENGTH.indexOf(a.fire_mask) - MASK_STRENGTH.indexOf(b.fire_mask))[0] || null;
  }

  window.Satellite = {
    DATA_SOURCE,
    FIRE_MASK,
    GOES_PIXEL_M: 2000,       // GOES ABI fire pixel, about 2 km over Kansas
    VIIRS_PIXEL_M: 375,       // VIIRS I-band pixel
    getGoesDetections: (scenario, time) => goes(scenario, time).detections,
    getFirmsHotspots: (scenario, time) => firms(scenario, time).hotspots,
    getGoesScanTime: (scenario, time) => goes(scenario, time).scan,
    getFirmsPassInfo: (scenario, time) => { const f = firms(scenario, time); return { lastPass: f.pass, note: f.note }; },
    toIso, formatTime, describe, firmsTime, strongest,
    apiCache
  };
})();
