/* Persistent map/camera windows. Geometry is local to the map stage; no viewer is recreated. */
(function () {
  'use strict';
  let stage, map, drone, content, control, options, latest;
  let opened = false, primary = 'map', minimized = false, rect = null;
  let contentKey = '', dashboard = true, resizeFrame = null, gesture = null;
  let clickStart = null, moved = false, positioned = false;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function bounds() { return { w: stage.clientWidth, h: stage.clientHeight }; }
  function constrain(r) {
    const { w, h } = bounds();
    const width = clamp(r.w, Math.min(260, w), w);
    const height = clamp(r.h, Math.min(170, h), h);
    return { x: clamp(r.x, 0, Math.max(0, w - width)), y: clamp(r.y, 0, Math.max(0, h - (minimized ? 32 : height))), w: width, h: height };
  }
  function defaultRect() {
    const { w, h } = bounds();
    const width = Math.min(w, Math.max(260, w * 0.34));
    const height = Math.min(h, width * 9 / 16 + 112);
    return constrain({ x: w - width - 12, y: h - height - 12, w: width, h: height });
  }
  function resizeMap() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; options.resizeMap(); });
  }
  function layout() {
    if (!stage.clientWidth || !stage.clientHeight) return;
    if (!rect) rect = defaultRect();
    rect = constrain(rect);
    drone.hidden = !opened;
    stage.classList.toggle('camera-open', opened);
    control.setAttribute('aria-expanded', String(opened));
    const dronePrimary = opened && primary === 'drone' && !minimized;
    for (const [el, isPrimary] of [[map, !dronePrimary], [drone, dronePrimary]]) {
      el.classList.toggle('primary', isPrimary);
      el.classList.toggle('floating', !isPrimary);
      el.removeAttribute('style');
      if (!isPrimary) Object.assign(el.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: (el === drone && minimized ? 32 : rect.h) + 'px' });
    }
    drone.classList.toggle('minimized', minimized);
    drone.querySelector('[data-window="minimize"]').textContent = minimized ? 'Restore' : 'Minimize';
    drone.querySelector('[data-window="swap"]').textContent = dronePrimary ? 'Swap' : 'Expand';
    resizeMap();
  }
  function refresh() {
    if (!latest) return;
    const key = opened ? [latest.sc.key, latest.k, latest.drone && latest.drone.onScene, latest.drone && latest.drone.active].join('|') : '';
    if (key !== contentKey) {
      contentKey = key;
      content.innerHTML = opened ? options.content(latest) : '';
      options.animate(latest);
    }
  }
  function open() {
    if (!opened && !positioned) rect = defaultRect();
    opened = true; minimized = false;
    refresh(); layout();
  }
  function close() {
    opened = false; primary = 'map'; minimized = false;
    refresh(); layout(); control.focus();
  }
  function swap() {
    if (!opened) return;
    primary = primary === 'map' ? 'drone' : 'map'; minimized = false; layout();
  }
  function update(v, view) {
    latest = v;
    const active = view !== 'calculator', changed = dashboard !== active;
    dashboard = active;
    refresh(); layout();
    if (changed) options.animate(latest);
  }
  function pointerDown(e) {
    if (e.button !== 0) return;
    const floating = e.target.closest('.view-window.floating');
    if (!floating || floating.hidden) return;
    clickStart = { x: e.clientX, y: e.clientY }; moved = false;
    const handle = e.target.closest('.window-resize');
    const header = e.target.closest('.windowbar');
    if (!handle && (!header || e.target.closest('button'))) return;
    e.preventDefault(); e.stopPropagation();
    const target = handle || header;
    gesture = { pointer: e.pointerId, target, resize: !!handle, x: e.clientX, y: e.clientY, rect: { ...rect } };
    target.setPointerCapture(e.pointerId);
  }
  function pointerMove(e) {
    if (clickStart && Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y) > 5) moved = true;
    if (!gesture || gesture.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    positioned = true;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y, r = gesture.rect;
    const { w, h } = bounds();
    rect = gesture.resize ? constrain({ ...r, w: Math.min(r.w + dx, w - r.x), h: Math.min(r.h + dy, h - r.y) }) : constrain({ ...r, x: r.x + dx, y: r.y + dy });
    layout();
  }
  function pointerEnd(e) {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    e.stopPropagation();
    if (gesture.target.hasPointerCapture(e.pointerId)) gesture.target.releasePointerCapture(e.pointerId);
    gesture = null;
  }
  function click(e) {
    const button = e.target.closest('[data-window]');
    if (button) {
      e.preventDefault(); e.stopPropagation();
      if (button.dataset.window === 'close') close();
      else if (button.dataset.window === 'swap') swap();
      else { minimized = !minimized; if (minimized) primary = 'map'; layout(); }
      return;
    }
    const floating = e.target.closest('.view-window.floating');
    if (!floating || moved || e.target.closest('button, a, input, summary, .windowbar, .window-resize, #mapOverlays, .maplabels, .satinfo')) return;
    // A click swaps; a drag on the small map remains a Cesium camera gesture.
    e.preventDefault(); e.stopPropagation(); swap();
  }
  function init(config) {
    options = config;
    stage = document.getElementById('mapStage'); map = document.getElementById('mapWindow');
    drone = document.getElementById('droneWindow'); content = document.getElementById('droneContent'); control = document.getElementById('droneControl');
    stage.addEventListener('pointerdown', pointerDown, true);
    stage.addEventListener('pointermove', pointerMove, true);
    stage.addEventListener('pointerup', pointerEnd, true);
    stage.addEventListener('pointercancel', pointerEnd, true);
    stage.addEventListener('click', click, true);
    stage.addEventListener('keydown', e => {
      if (e.key === 'Escape' && opened) { close(); e.preventDefault(); return; }
      if (!e.target.matches('.window-resize') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      positioned = true;
      rect = constrain({ ...rect, w: rect.w + (e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0), h: rect.h + (e.key === 'ArrowDown' ? 16 : e.key === 'ArrowUp' ? -16 : 0) });
      layout();
    });
    const observer = new ResizeObserver(() => { layout(); });
    observer.observe(stage);
    const mapObserver = new ResizeObserver(resizeMap);
    mapObserver.observe(document.getElementById('mapSurface'));
    // These observers and handlers live for the single dashboard lifetime.
    layout();
  }
  window.DroneUI = { init, open, update };
})();
