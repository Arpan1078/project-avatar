/* =====================================================================
   fire-types.js: one definition of each KIND of fire and how it looks.

   Used by the 3D map (fire edge, glow, embers, callout cards, the
   registered burn area outline) and by the dashboard (status heading,
   confidence ring, header badge, legend). Change a color here and it
   changes everywhere.

   color   main color (edge line, cards, ring, badge, legend)
   glow    the soft glow along the fire edge:
             alpha         strength (0..1)
             power         how wide the glow spreads inside the line (Cesium glowPower)
             width         line width in pixels, including the glow
             pulseSeconds  0 = steady; otherwise one slow pulse every N seconds
   ember   glowing dots inside the burned area (ember, emberHot = brighter ones)
   label   name shown in the legend and on map cards

   In CSS the colors are available as var(--ft-wildfire), var(--ft-planned),
   var(--ft-escaped).
   ===================================================================== */
(function () {
  'use strict';

  const FIRE_TYPES = {
    // Real fire / Power data off scenarios.
    wildfire: {
      label: 'Wildfire',
      color: '#FF4A1C',
      glow: { alpha: 0.85, power: 0.2, width: 16, pulseSeconds: 0 },
      ember: '#FF8A3D', emberHot: '#FFC07A'
    },
    // A registered burn, while it is inside its area and before its end time.
    planned: {
      label: 'Planned burn',
      color: '#E8B04A',
      glow: { alpha: 0.5, power: 0.12, width: 11, pulseSeconds: 0 },     // softer, steady
      ember: '#F2C46B', emberHot: '#FFE2A6'
    },
    // Fire outside the registered area (or still burning after the end time).
    escaped: {
      label: 'Escaped burn',
      color: '#FF2D4D',
      glow: { alpha: 0.9, power: 0.22, width: 16, pulseSeconds: 2.6 },   // slow pulse
      ember: '#FF5A5F', emberHot: '#FFB8A8'
    }
  };

  for (const key in FIRE_TYPES) document.documentElement.style.setProperty('--ft-' + key, FIRE_TYPES[key].color);
  window.FIRE_TYPES = FIRE_TYPES;
})();
