/* One-hour wildfire spread forecast: ILLUSTRATIVE, configurable, NOT a validated fire-behavior model.
   Region-independent. Replace `assess()` with a validated model (for example Rothermel) and keep the same output
   shape: { headBearingDeg, headDistanceM, lengthToBreadth, e, factors[], horizonMinutes }.
   All coefficients come from the region's forecast-config.json; nothing here is a measured spread rate.
   Shape: Huygens-style elliptical growth. A point on the current fire edge moves outward along its radial direction by
   d(phi) = headDistance * (1 - e) / (1 - e * cos(phi)), phi = angle between that direction and the spread (head) bearing. */
(function (root) {
  'use strict';
  const ACRE = 4046.8564224, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = deg => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  // inputs: { windToDeg, windMph, windGustMph|null, humidityPct, slopePct|null (along the spread direction) }
  function assess(config, inputs, area) {
    const mph = inputs.windMph, slope = inputs.slopePct;
    const windF = 1 + config.wind.perMph * mph;
    const slopeKnown = Number.isFinite(slope);
    const slopeF = slopeKnown ? clamp(1 + config.slope.perPct * slope, config.slope.min, config.slope.max) : 1;
    const fuelF = config.fuel.factor;
    const humKnown = Number.isFinite(inputs.humidityPct);
    const humF = humKnown ? clamp(1 + (config.humidity.refPct - inputs.humidityPct) * config.humidity.perPct, config.humidity.min, config.humidity.max) : 1;
    const acres = area / ACRE, sr = config.sizeRamp;
    // Small fires spread less than established ones: ramp up to 1 at fullAtAcres, then grow slowly (log) to maxFactor at maxAtAcres.
    const sizeF = acres <= sr.fullAtAcres ? clamp(sr.minFactor + (1 - sr.minFactor) * Math.sqrt(acres / sr.fullAtAcres), sr.minFactor, 1) : 1 + (sr.maxFactor - 1) * Math.min(1, Math.log(acres / sr.fullAtAcres) / Math.log(sr.maxAtAcres / sr.fullAtAcres));
    const headDistanceM = config.baseSpreadMPerHr * (config.horizonMinutes / 60) * windF * slopeF * fuelF * humF * sizeF;
    const lengthToBreadth = clamp(1 + config.lengthToBreadth.perMph * mph, 1, config.lengthToBreadth.max);
    const e = Math.sqrt(1 - 1 / (lengthToBreadth * lengthToBreadth));
    const eff = f => f > 1.05 ? 'Faster' : f < 0.95 ? 'Slower' : 'Little effect';
    const factors = [
      { key: 'wind', label: 'Wind', effect: 'Main factor', assumed: true, text: `From ${compass(inputs.windToDeg + 180)} ${mph} mph, spreading toward ${compass(inputs.windToDeg)}; gusts ${Number.isFinite(inputs.windGustMph) ? inputs.windGustMph + ' mph' : 'unavailable'}` },
      { key: 'slope', label: 'Slope', effect: slopeKnown ? (Math.abs(slope) < 2 ? 'Little effect' : slope > 0 ? 'Faster' : 'Slower') : 'Unavailable', assumed: false, text: slopeKnown ? `${slope.toFixed(1)}% along the spread direction (Cesium terrain)` : 'Terrain not sampled yet; no slope effect applied' },
      { key: 'fuel', label: 'Fuel', effect: eff(fuelF), assumed: !!config.fuel.assumed, text: config.fuel.label + (config.fuel.assumed ? ' (scenario assumption; no measured fuel model)' : '') },
      { key: 'humidity', label: 'Humidity', effect: humKnown ? eff(humF) : 'Unavailable', assumed: true, text: humKnown ? `${inputs.humidityPct}% (scenario assumption)` : 'Unavailable' }
    ];
    return { headBearingDeg: inputs.windToDeg, headDistanceM, lengthToBreadth, e, factors, horizonMinutes: config.horizonMinutes, directionName: compass(inputs.windToDeg) };
  }

  // Forecast zone: current outline (local [east, north] meters) pushed outward by d(phi). Always contains the current fire.
  function expand(a, outlineXY) {
    const hb = a.headBearingDeg * Math.PI / 180;
    return outlineXY.map(p => {
      const r = Math.hypot(p[0], p[1]) || 1e-9, phi = Math.atan2(p[0], p[1]) - hb;
      const d = a.headDistanceM * (1 - a.e) / (1 - a.e * Math.cos(phi));
      return [p[0] + p[0] / r * d, p[1] + p[1] / r * d];
    });
  }
  // Farthest point of the zone along the spread direction (where the "Next 60 min" label sits).
  function tip(a, ring) {
    const sb = Math.sin(a.headBearingDeg * Math.PI / 180), cb = Math.cos(a.headBearingDeg * Math.PI / 180);
    return ring.reduce((best, p) => p[0] * sb + p[1] * cb > best[0] * sb + best[1] * cb ? p : best, ring[0]);
  }
  function inside(ring, x, y) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const A = ring[i], B = ring[j];
      if ((A[1] > y) !== (B[1] > y) && x < (B[0] - A[0]) * (y - A[1]) / (B[1] - A[1]) + A[0]) c = !c;
    }
    return c;
  }
  // First mapped road crossing the spread direction between startM and endM from the ignition (a possible slowing factor only).
  function barrier(roadsFC, toLocal, bearingDeg, startM, endM) {
    const sb = Math.sin(bearingDeg * Math.PI / 180), cb = Math.cos(bearingDeg * Math.PI / 180);
    const ax = sb * startM, ay = cb * startM, bx = sb * endM, by = cb * endM;
    let best = null;
    const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const f of roadsFC.features) for (const line of lines(f.geometry)) {
      let prev = toLocal(line[0][0], line[0][1]);
      for (let i = 1; i < line.length; i++) {
        const q = toLocal(line[i][0], line[i][1]);
        const rx = bx - ax, ry = by - ay, sx = q[0] - prev[0], sy = q[1] - prev[1], den = rx * sy - ry * sx;
        if (den !== 0) {
          const t = ((prev[0] - ax) * sy - (prev[1] - ay) * sx) / den, u = ((prev[0] - ax) * ry - (prev[1] - ay) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { const dist = startM + t * (endM - startM); if (!best || dist < best.distM) best = { distM: dist, name: (f.properties && (f.properties.name || f.properties.ref)) || 'Mapped road' }; }
        }
        prev = q;
      }
    }
    return best;
  }
  const api = { assess, expand, tip, inside, barrier, compass };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpreadForecast = api;
})(typeof window !== 'undefined' ? window : globalThis);
