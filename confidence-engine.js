/* Region-independent, evidence-based PROTOTYPE confidence scoring.
   Inputs: a config (weights, families, threshold; see data/regions/<state>/confidence-config.json) and an
   evidence file (signals per replay step). Output: a score plus a per-signal contribution breakdown.
   The score is additive points (clamped 0..100) and is NOT a calibrated probability.
   Rules: detected signals add their weight; negative signals add their (usually negative) weight;
   unavailable / not_checked signals add 0 (missing information is never negative evidence);
   correlated signals share a "family" so the strongest counts fully and the rest are discounted and capped;
   signals in one `group` (e.g. repeated scans of one hotspot) count once. */
(function (root) {
  'use strict';
  const STATES = ['detected', 'negative', 'unavailable', 'not_checked'];
  const STATUSES = ['historical', 'live', 'simulated', 'hypothetical'];

  // Latest definition of each signal id up to `step`. carry:false signals only apply on the step that defines them.
  function resolveSignals(evidence, step) {
    const byId = new Map();
    for (const s of evidence.steps) {
      if (s.step > step) continue;
      for (const sig of s.signals) byId.set(sig.id, Object.assign({}, sig, { sinceStep: s.step, carried: s.step < step }));
    }
    return [...byId.values()].filter(sig => sig.carry !== false || sig.sinceStep === step);
  }

  function evaluate(config, evidence, step) {
    const rows = resolveSignals(evidence, step).map(sig => {
      if (!STATES.includes(sig.state)) throw Error('Unknown signal state: ' + sig.state);
      if (!STATUSES.includes(sig.status)) throw Error('Unknown signal status: ' + sig.status);
      const weight = sig.state === 'detected' ? (config.weights[sig.type] || 0) : sig.state === 'negative' ? (config.negativeWeights[sig.type] || 0) : 0;
      const mult = config.statusMultipliers && config.statusMultipliers[sig.status] != null ? config.statusMultipliers[sig.status] : 1;
      return Object.assign(sig, { weight, raw: weight * mult, points: weight * mult, adjustment: '' });
    });
    // 1. One count per observation group.
    const groups = new Map();
    for (const r of rows) if (r.group && r.raw > 0) { const g = groups.get(r.group); if (!g || r.raw > g.raw) groups.set(r.group, r); }
    for (const r of rows) if (r.group && r.raw > 0 && groups.get(r.group) !== r) { r.points = 0; r.adjustment = 'same observation as another signal; not independent'; }
    // 2. Correlated families: strongest full, others discounted, family total capped.
    for (const fam of Object.values(config.families || {})) {
      const members = rows.filter(r => fam.types.includes(r.type) && r.points > 0).sort((a, b) => b.points - a.points);
      let total = 0;
      members.forEach((r, i) => {
        if (i > 0) { r.points *= fam.corroborationFactor; r.adjustment = `corroborating, counted at ${Math.round(fam.corroborationFactor * 100)}% (correlated with ${members[0].label})`; }
        const room = Math.max(0, fam.cap - total);
        if (r.points > room) { r.points = room; r.adjustment = (r.adjustment ? r.adjustment + '; ' : '') + `family cap ${fam.cap}`; }
        total += r.points;
      });
    }
    for (const r of rows) r.points = Math.round(r.points);
    // The displayed score is always the clamped sum of the displayed per-signal points.
    const sum = rows.reduce((t, r) => t + r.points, 0), score = Math.max(0, Math.min(100, sum));
    const t = config.alertThreshold, b = config.bands;
    const band = score < b.mediumFrom ? 'low' : score < b.highFrom ? 'medium' : 'high';
    const alert = score >= t;
    const contributing = rows.filter(r => r.points !== 0).map(r => `${r.label} ${r.points > 0 ? '+' : ''}${r.points}`);
    return {
      score, rawSum: sum, clamped: sum !== score, band, alert, threshold: t, signals: rows, scoreKind: 'prototype_score_not_probability',
      alertReason: alert ? `Score ${score} reached the provisional alert threshold ${t}.` : `Score ${score} is below the provisional alert threshold ${t} (${t - score} points short).`,
      summary: contributing.length ? contributing.join(', ') : 'No evidence has contributed yet'
    };
  }
  const api = { evaluate, resolveSignals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ConfidenceEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
