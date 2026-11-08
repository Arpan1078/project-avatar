/* Workbook narrative and step selection; no scoring or sensor feeds. */
(function () {
  'use strict';
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let cached;
  function scenario(data) {
    if (cached) return cached;
    const records = data.timeline.records;
    const dates = ['2021-07-13', '2021-07-13', '2021-07-13', '2021-07-13', '2021-07-13', '2021-07-13', '2021-07-13 / 2021-07-14', '2021-07-14'];
    const short = ['6:48 AM', 'Daytime', 'Unknown time', '4:30 PM', '5:12 PM', '5:42 PM', 'Overnight', '8:00 AM'];
    const sizes = [null, null, null, '~600–800 sq ft', '~40 × 40 ft', '~2 acres', 'Hundreds of acres', '~500 acres'];
    // The workbook row with no clock time ('Unknown time') is not a replay step: its camera flag is merged into the next step (4:30 PM).
    const steps = records.map((r, i) => ({ r, i })).filter(({ r }) => !/time unknown/i.test(r.time.label)).map(({ r, i }) => {
      const inherited = records.find(e => e.id === r.observation.inheritsObservationFromEvent);
      const observation = inherited ? `${r.observation.text}: ${inherited.observation.text}` : r.observation.text;
      const dateLabel = i === 6 ? 'July 13–14, 2021' : i === 7 ? 'July 14, 2021' : 'July 13, 2021';
      const label = `${dateLabel}, ${r.time.label} (Pacific)`;
      return {
        id: r.id, recordIndex: i, date: dates[i], time: short[i], ampm: '', label,
        timestamp: null, precision: r.time.precision, size: sizes[i], record: r,
        status: r.historicalContext.workbookType, observation,
        level: inherited ? inherited.firewatchBehavior.levelText : r.firewatchBehavior.levelText,
        caption: escape(`${label} — ${r.historicalContext.workbookType} (not independently verified): ${r.historicalContext.text}. Hypothetical Firewatch: ${observation}`)
      };
    });
    cached = { key: 'dixie', steps, ampm: '', compareCols: ['Hypothetical Firewatch', 'Historical benchmark'],
      people: { intro: 'Simulated volunteer roster (5 of 18 free this evening), paged when the provisional alert fires. Prototype only: no sourced CAL FIRE / Butte County staffing; see Nearby help for documented stations.' },
      burnsTab: () => ({ items: [] }),
      extraLine: '' };
    return cached;
  }
  function compute(data, state) {
    const sc = scenario(data), k = Math.min(state.step, sc.steps.length - 1), now = sc.steps[k], r = now.record, ri = now.recordIndex;   // k = replay step shown; ri = workbook record index (keys fire areas and evidence)
    const sources = r.provenance.sourceText.map(escape).join('; ');
    const pathBuildings = DixieFire.buildingsInPath(data, ri);
    // Milestone area comes from DixieFire.areas (the same value that sizes the map polygon).
    const fmt = DixieFire.format(DixieFire.areas[ri]).replace('~', '').split(' ');
    const areaValues = '~' + fmt[0], areaUnits = fmt.slice(1).join(' ');
    const areaNote = ri < 3 ? 'Illustrative starting size for the replay; the workbook documents no area at this step.' : ri === 3 ? 'Workbook range 600–800 sq ft; the map uses the lower end. Simulated footprint, not a surveyed perimeter.'
      : ri === 4 ? 'Approximate 40 × 40 ft dimensions converted to area, not a surveyed perimeter.'
      : ri === 6 ? 'Workbook says "hundreds of acres" overnight without an acreage; the map shows an illustrative 200 acres.' : now.status + '; workbook estimate, not independently verified';
    const o = data.config.origin, bf = (data.geography.buildings && data.geography.buildings.features) || [];
    const nearestKm = bf.length ? Math.min(...bf.map(f => Math.hypot((f.geometry.coordinates[0] - o.longitude) * 111.32 * Math.cos(o.latitude * Math.PI / 180), (f.geometry.coordinates[1] - o.latitude) * 111.32))) : null;
    const buildingNote = (nearestKm === null ? 'Building dataset unavailable. ' : `${bf.length} OpenStreetMap building points loaded; nearest is ${nearestKm.toFixed(1)} km from ignition (OSM may be incomplete in the canyon). `) + 'Mapped building reference points in the selected-step illustrative envelope, including the fire footprint; not confirmed residences or a complete 2021 inventory. No forecast horizon. Overnight holds the last supported footprint.';
    // Prototype evidence score: every number below comes from ConfidenceEngine.evaluate (config + evidence files).
    const ev = data.confidence ? ConfidenceEngine.evaluate(data.confidence.config, data.confidence.evidence, ri) : null;
    const bandColor = ev ? { low: '#F26B2E', medium: '#E8B04A', high: '#5FBF77' }[ev.band] : 'var(--dim)';
    const ptsText = p => p > 0 ? '+' + p : p < 0 ? '-' + Math.abs(p) : '+0';
    const detected = ev ? ev.signals.filter(s => s.state === 'detected' || s.state === 'negative') : [];
    const missing = ev ? ev.signals.filter(s => s.state === 'unavailable' || s.state === 'not_checked') : [];
    const reasons = !ev ? [{ label: 'Confidence weights not supplied', pts: 'Unknown', color: 'var(--dim)' }]
      : detected.map(s => ({ label: escape(s.label) + ' <small>(' + s.status + (s.carried ? ', carried' : '') + ')</small>', pts: ptsText(s.points), color: s.points > 0 ? 'var(--text)' : s.points < 0 ? 'var(--calm)' : 'var(--dim)' }))
        .concat([{ label: detected.length ? missing.length + ' sources unavailable, not counted as negative' : 'No evidence has arrived; ' + missing.length + ' sources unavailable', pts: '—', color: 'var(--dim)' }]);
    const evidenceRows = !ev ? [] : ev.signals.map(s => {
      const link = s.sourceRef ? ' <a href="' + escape(s.sourceRef) + '" target="_blank" rel="noopener noreferrer">source</a>' : ' (no source supplied)';
      return [escape(s.label), escape(s.state) + ' · ' + escape(s.status) + ' · <b>' + (s.state === 'detected' || s.state === 'negative' ? ptsText(s.points) + ' pts' : '0 pts') + '</b><br>' + escape(s.sourceName) + link + '<br>Time: ' + escape(s.timeLabel || 'not documented') + (s.observedAt ? '' : ' (no observation timestamp)') + (s.adjustment ? '<br><i>' + escape(s.adjustment) + '</i>' : '') + '<br><small>' + escape(s.explanation) + '</small>'];
    }).concat([['Prototype weights', escape(Object.entries(data.confidence.config.weights).map(([t, w]) => t.replace(/_/g, ' ') + ' +' + w).join('; ')) + '<br><small>Configurable in data/regions/california/confidence-config.json. Not calibrated or validated; correlated satellite/camera signals are discounted and capped.</small>']]);
    const confNote = !ev ? 'Confidence weights not supplied' : 'Prototype score, not a probability. ' + ev.alertReason + ' Provisional threshold; ' + (ev.alert ? 'alert would trigger' : 'no alert') + '. Workbook level: ' + (now.level || 'not specified') + '.';
    // Simulated volunteer response, same pattern as the earlier prototype: paged when the provisional alert fires.
    const roster = [['Volunteer 1', 'near Magalia', 'Responding', true], ['Volunteer 2', 'Oroville', 'Responding', true], ['Volunteer 3', 'Paradise', 'Responding', true], ['Volunteer 4', 'out of town', 'Can\u2019t make it', false], ['Volunteer 5', 'at work', 'No reply', false]];
    const paged = !!(ev && ev.alert);
    const peopleRows = roster.map(([who, note, status, yes]) => ({ who, note, status: paged ? status : 'Not paged yet', color: paged && yes ? 'var(--fire-soft)' : 'var(--dim)', dot: paged && yes ? 'var(--fire)' : paged ? 'var(--dim)' : '#4A4238' }));
    const responding = peopleRows.filter(p => paged && p.dot === 'var(--fire)').length;
    // ---- One-hour spread forecast (illustrative model) from the CURRENT milestone area; same zone drives map, KPI and highlights ----
    const fc = data.forecast, area = DixieFire.areas[ri];
    const fa = fc ? SpreadForecast.assess(fc.config, fc.inputs, area) : null;
    const zone = fc ? DixieFire.zoneXY(fc, area) : null;
    const lon0 = o.longitude, lat0 = o.latitude, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const barrier = fa && data.geography.roads ? SpreadForecast.barrier(data.geography.roads, (lo, la) => [(lo - lon0) * kx, (la - lat0) * 111320], fa.headBearingDeg, Math.sqrt(area / Math.PI), Math.sqrt(area / Math.PI) + Math.max(fa.headDistanceM, fc.config.barrierLookaheadM)) : null;
    const forecastRows = !fa ? [] : fa.factors.map(f => [f.label, f.effect, f.text]).concat([
      ['Barriers', barrier ? 'Possible slowing' : 'None mapped', barrier ? barrier.name + ', ~' + Math.round(barrier.distM) + ' m ahead: a possible slowing factor, not a guaranteed stop' : 'No mapped road crosses the projected path (OSM coverage may be incomplete)'],
      ['Horizon', fa.horizonMinutes + ' min', 'Head of fire ~' + Math.round(fa.headDistanceM) + ' m toward ' + fa.directionName + '; illustrative model, not a validated forecast']]);
    const towns = (data.geography.towns && data.geography.towns.features) || [];
    let community = null;
    for (const f of towns) { const x = (f.geometry.coordinates[0] - lon0) * kx, y = (f.geometry.coordinates[1] - lat0) * 111320, km = Math.hypot(x, y) / 1000; if (!community || km < community.km) community = { name: f.properties.name, km, x, y }; }
    const communityText = !community ? 'No mapped community data' : community.name + ', ' + community.km.toFixed(1) + ' km ' + SpreadForecast.compass(Math.atan2(community.x, community.y) * 180 / Math.PI) + ' of ignition; ' + (zone && SpreadForecast.inside(zone, community.x, community.y) ? 'inside the projected zone' : 'outside the projected 60-min zone');
    const hasBuildings = !!(data.geography.buildings && data.geography.buildings.features.length);
    // ---- Simulated alert workflow (state.alertAt = step where the score first crossed the threshold going forward) ----
    const at = state.alertAt, fired = ev && at !== null && at !== undefined && state.step >= at;
    const alertRows = !fired ? [] : [
      ['Alert generated', 'Simulated: score ' + ev.score + ' reached the provisional ' + ev.threshold, true],
      ['Alert queued', 'Simulated: no real message was sent', true],
      ['Alert acknowledged', state.step > at ? 'Simulated assumption, not a real acknowledgement' : 'Pending (simulated)', state.step > at],
      ['Dispatch confirmed', state.step > at ? 'Simulated assumption, not a real dispatch' : 'Pending (simulated)', state.step > at]
    ].map(([who, status, done]) => ({ who, status, color: done ? 'var(--fire-soft)' : 'var(--dim)', dot: done ? 'var(--fire)' : '#4A4238' }));
    const help = RegionalMap.nearestStations ? RegionalMap.nearestStations(3).map(s => s.name.replace(/, .*$/, '') + ' ~' + s.min + ' min (est.)').join('; ') : '';
    const alertPopup = !fired || !state.alertOpen ? null : { time: now.time, score: ev.score, threshold: ev.threshold, evidence: ev.summary,
      spread: fa ? 'Next 60 min toward ' + fa.directionName + ', head ~' + Math.round(fa.headDistanceM) + ' m (illustrative model)' : 'Unavailable',
      buildings: hasBuildings ? pathBuildings.length + ' mapped (OSM coverage may be incomplete)' : 'Unavailable: no building data', help };
    const tile = (label, value, unit = '', color = 'var(--text)', note = '') => ({ label, value, unit, color, note });
    return {
      sc, k, now, ampm: '', full: state.mode === 'full', conf: ev ? ev.score : null, confidence: ev,
      reasons, confUnit: '', confLabel: 'prototype score', confNote,
      statusLabel: ev ? (ev.alert ? 'Dixie replay: provisional alert' : 'Dixie replay: no alert yet') : 'Dixie Fire historical replay', statusColor: 'var(--text)', ringColor: bandColor,
      peopleRows, alertRows, alertPopup, forecastRows, responding, fireType: null, typeColor: null,
      wind: { dir: fc ? SpreadForecast.compass(fc.inputs.windToDeg + 180) : 'SW', text: (fc ? fc.inputs.windMph : 10) + ' mph (scenario assumption)', towardDeg: fc ? fc.inputs.windToDeg : 45, mph: fc ? fc.inputs.windMph : 10 },
      map: { dixieFire: { step: ri, playing: !!state.playing, headBearing: fc ? fc.inputs.windToDeg : 45, windMph: fc ? fc.inputs.windMph : 10, forecast: fc || undefined } }, drone: null, pathHomes: pathBuildings, help: { rows: [], from: null, status: {}, lineTo: null }, tokens: {}, flags: [], rules: null,
      tiles: [tile('Time', now.time, '', 'var(--text)', now.label),
        tile('Confidence', ev ? ev.score : '—', ev ? 'pts' : '', bandColor, confNote),
        Object.assign(tile('Area burned', areaValues, areaUnits, 'var(--fire)', areaNote), { key: 'area' }),
        tile('Buildings in path', !hasBuildings ? 'Data unavailable' : pathBuildings.length, !hasBuildings ? '' : 'mapped', pathBuildings.length ? 'var(--fire-soft)' : 'var(--text)', buildingNote),
        tile('Volunteer Response', responding, 'of 5', 'var(--text)', paged ? 'Simulated: paged at the provisional alert; 18 on the roster' : 'Simulated: not paged until the provisional alert'),
        tile('Response time', '14', 'min', 'var(--text)', 'Modeled estimate for the hypothetical Firewatch alert to first responders; not a historical 2021 response time.')],
      facts: [['Replay time', escape(now.label)], ['Nearest community', escape(communityText)], ['Prototype score', ev ? ev.score + ' pts: ' + (ev.alert ? 'alert threshold reached' : 'below alert threshold') + ' (provisional ' + ev.threshold + ')' : 'Unavailable'], ['Historical context', escape(r.historicalContext.text)], ['Workbook status', escape(now.status) + '; not independently verified'], ['Hypothetical level', escape(now.level || 'Not specified')]],
      dataRows: [...evidenceRows, ['Alert decision', escape(ev ? ev.alertReason + ' Provisional threshold; the score is a prototype and not a calibrated probability.' : 'Unavailable')], ['Workbook', `Timeline today, row ${r.provenance.row}`], ['Original source / assumption', sources], ['Historical status', escape(now.status)], ['Hypothetical observation', escape(now.observation)], ['Proposed Firewatch behavior', escape(now.level || 'Not specified')], ['Inherited workbook note', r.provenance.inheritedNotes.map(n => escape(n.text)).join('; ')], ['Map fire label', 'Short map labels ("Simulated fire · area", "Likely path"). The fire is a simulated, terrain-draped footprint sized from the workbook area, not a verified perimeter. Between timeline milestones its size is interpolated (simulated, not observed). Likely path is an illustrative 1.4× envelope with no forecast horizon or probability.'], ['Weather', 'Scenario assumptions (no sourced hourly Dixie weather in the data package): 98°F, 14% humidity, no recent rain, extreme fire risk. Not historical measurements.'], ['Wind', 'Scenario assumption: toward NE (45°), ~10 mph, up-canyon afternoon flow. No sourced Dixie weather is in the data package; not historical weather.'], ['Camera limitation', 'November 2026 pointing snapshot; terrain visibility unverified']],
      firmsNote: buildingNote + ' No actual camera, satellite or drone detections are asserted. Historical weather, fuel measurements, confidence weights and response times are unavailable.',
      goes: [], firms: [], compare: [{ label: '911 call', note: 'Timeline today row 9: Dixie Fire (Wikiwand), workbook 2021 fact; not independently verified. Call time, not arrival.', ours: '—', other: 'July 13, 5:12 PM', color: 'var(--dim)' }, { label: 'Dispatch / arrival', note: 'No sourced response timings', ours: '—', other: '—', color: 'var(--dim)' }],
      conditions: { badge: 'Fire risk: Extreme', badgeClass: 'flag', note: 'Hot, dry canyon', weather: [['Wind', 'SW 10 mph'], ['Humidity', (fc ? fc.inputs.humidityPct : 14) + '%'], ['Temp', '98°F'], ['Rain', 'none in 6 weeks']] }
    };
  }
  // Prototype score for any replay step (used by the dashboard to detect the alert-threshold crossing).
  function evaluateStep(data, k) { const steps = scenario(data).steps, ri = steps[Math.max(0, Math.min(steps.length - 1, k | 0))].recordIndex; return ConfidenceEngine.evaluate(data.confidence.config, data.confidence.evidence, ri); }
  window.DixieScenario = { scenario, compute, evaluateStep };
})();
