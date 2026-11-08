/* Phase 3A: workbook narrative only; no scoring, sensor feeds or fire geometry. */
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
    const steps = records.map((r, i) => {
      const inherited = records.find(e => e.id === r.observation.inheritsObservationFromEvent);
      const observation = inherited ? `${r.observation.text}: ${inherited.observation.text}` : r.observation.text;
      const dateLabel = i === 6 ? 'July 13–14, 2021' : i === 7 ? 'July 14, 2021' : 'July 13, 2021';
      const label = `${dateLabel}, ${r.time.label} (Pacific)`;
      return {
        id: r.id, date: dates[i], time: short[i], ampm: '', label,
        timestamp: null, precision: r.time.precision, size: sizes[i], record: r,
        status: r.historicalContext.workbookType, observation,
        level: inherited ? inherited.firewatchBehavior.levelText : r.firewatchBehavior.levelText,
        caption: escape(`${label} — ${r.historicalContext.workbookType} (not independently verified): ${r.historicalContext.text}. Hypothetical Firewatch: ${observation}`)
      };
    });
    cached = { key: 'dixie', steps, ampm: '', compareCols: ['Hypothetical Firewatch', 'Historical benchmark'],
      people: { intro: 'Response times and resource availability are unknown.' },
      burnsTab: () => ({ items: [] }),
      extraLine: 'Historical replay, not live data. November 2026 capabilities are hypothetical. Unknown-time steps follow workbook order, not measured detection times.' };
    return cached;
  }
  function compute(data, state) {
    const sc = scenario(data), k = Math.min(state.step, sc.steps.length - 1), now = sc.steps[k], r = now.record;
    const sources = r.provenance.sourceText.map(escape).join('; ');
    return {
      sc, k, now, ampm: '', full: state.mode === 'full', conf: null,
      reasons: [{ label: 'Confidence weights not supplied', pts: 'Unknown', color: 'var(--dim)' }],
      statusLabel: 'Dixie Fire historical replay', statusColor: 'var(--text)', ringColor: 'var(--dim)',
      peopleRows: [], alertRows: [], responding: null, fireType: null, typeColor: null,
      wind: { dir: 'unknown', text: 'Not configured', towardDeg: null, mph: null },
      map: {}, drone: null, pathHomes: [], help: { rows: [], from: null, status: {}, lineTo: null }, tokens: {}, flags: [], rules: null,
      tiles: ['Confidence', 'Fire size', 'Homes in path', 'Volunteer Response', 'Ahead of 911 Responder', 'Response time'].map(label => ({ label, value: label === 'Fire size' ? now.size || 'Unknown' : 'Unknown', unit: '', color: 'var(--text)' })),
      facts: [['Replay time', escape(now.label)], ['Historical context', escape(r.historicalContext.text)], ['Workbook status', escape(now.status) + '; not independently verified'], ['Hypothetical level', escape(now.level || 'Not specified')]],
      dataRows: [['Workbook', `Timeline today, row ${r.provenance.row}`], ['Original source / assumption', sources], ['Historical status', escape(now.status)], ['Hypothetical observation', escape(now.observation)], ['Proposed Firewatch behavior', escape(now.level || 'Not specified')], ['Inherited workbook note', r.provenance.inheritedNotes.map(n => escape(n.text)).join('; ')], ['Camera limitation', 'November 2026 pointing snapshot; terrain visibility unverified']],
      firmsNote: 'No actual camera or satellite detections are asserted. Detection timestamps, confidence weights and response times are unknown.',
      goes: [], firms: [], compare: [{ label: '911 call', ours: 'Unknown', other: 'July 13, 5:12 PM', color: 'var(--dim)' }],
      conditions: { badge: 'Historical replay', badgeClass: '', note: 'Dixie Fire · July 13–14, 2021 · Hypothetical November 2026 capabilities', weather: [] }
    };
  }
  window.DixieScenario = { scenario, compute };
})();
