/* Geographic map adapter. Uses absolute coordinates; never consumes Kansas STORY geometry. */
(function () {
  'use strict';
  const manifestPath = document.currentScript && document.currentScript.dataset.region;
  const active = !!manifestPath;
  let loading, initializing, data, viewer, mapRoot, compass, info, handler, fire, initialized = false;
  let pathStep, pathIds = [], groups = {}, dataSources = {}, details = new Map(), owners = new Map(), pinned = false, selected = null, lastPointer = 0;
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = s => Cesium.Color.fromCssColorString(s);
  const MAJOR_TOWNS = new Set(['Stirling City', 'Magalia', 'Concow', 'Cresta', 'Poe', 'Belden', 'Rock Creek', 'Pulga', 'Paradise']);
  const hasPosition = r => Number.isFinite(r.location?.latitude) && Number.isFinite(r.location?.longitude);
  const runtime = { active, load, init, update, resetView, helpHtml, get data() { return data; } };
  async function json(url) {
    const response = await fetch(url);
    if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }
  function load() { return loading || (loading = loadRegion()); }
  async function loadRegion() {
    const manifestUrl = new URL(manifestPath, document.baseURI);
    const resolve = file => new URL(file, manifestUrl).href;
    const manifest = await json(manifestUrl.href);
    if (!manifest.mapConfigPath) throw Error('Selected region has no map configuration');
    const config = await json(resolve(manifest.mapConfigPath));
    const incidentEntry = manifest.incidents.find(i => i.id === config.incidentId);
    if (!incidentEntry) throw Error('Map incident is not registered');
    const keys = ['cameras', 'stations', 'aviation', 'water'];
    const [incident, sources, mapSources, overrides, ...collections] = await Promise.all([
      json(resolve(incidentEntry.path)), json(resolve(manifest.sourcesPath)), json(resolve(config.mapSourcesPath)),
      json(resolve(config.resourceOverridesPath)), ...keys.map(k => json(resolve(manifest.collections[k])))
    ]);
    if (incident.historical.origin.latitude !== config.origin.latitude || incident.historical.origin.longitude !== config.origin.longitude) throw Error('Map origin does not match the documented incident');
    const resources = Object.fromEntries(keys.map((k, i) => [k, collections[i].records]));
    for (const supplement of overrides.records) {
      const record = resources.stations.find(r => r.id === supplement.recordId);
      if (!record) throw Error('Station supplement has no workbook match');
      record.workbookLocation = { ...record.location };
      record.location = { ...record.location, ...supplement.location };
      record.mapSourceRefs = supplement.sourceRefs;
      record.mapSourceUrl = supplement.sourceUrl;
    }
    resources.stations.push(...overrides.additionalStations);
    const geography = Object.fromEntries(await Promise.all(Object.entries(config.geographicLayers).map(async ([k, file]) => [k, await json(resolve(file))])));
    const bounds = config.contextBounds;
    function checkCoordinates(coords) {
      if (typeof coords[0] === 'number') {
        if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1]) || coords[0] < bounds[0] - 0.00001 || coords[0] > bounds[2] + 0.00001 || coords[1] < bounds[1] - 0.00001 || coords[1] > bounds[3] + 0.00001) throw Error('Geographic feature outside active region');
      } else coords.forEach(checkCoordinates);
    }
    for (const fc of Object.values(geography)) {
      if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw Error('Invalid regional GeoJSON');
      fc.features.forEach(f => checkCoordinates(f.geometry.coordinates));
    }
    for (const list of Object.values(resources)) for (const record of list) if (hasPosition(record)) {
      const b = config.resourceBounds, p = record.location;
      if (p.longitude < b[0] || p.longitude > b[2] || p.latitude < b[1] || p.latitude > b[3]) throw Error('Resource outside regional resource bounds');
    }
    const timeline = await json(resolve(incident.replay.timelinePath));
    let confidence = null;   // prototype evidence-based scoring inputs (config + replay evidence); optional per region
    if (manifest.confidence) {
      const [cfg, evidence] = await Promise.all([json(resolve(manifest.confidence.configPath)), json(resolve(manifest.confidence.evidencePath))]);
      for (const s of evidence.steps) if (!timeline.records[s.step] || timeline.records[s.step].id !== s.eventId) throw Error('Evidence step does not match the timeline event');
      confidence = { config: cfg, evidence };
    }
    data = { manifest, config, incident, sources, mapSources, overrides, resources, geography, timeline, confidence };
    return data;
  }
  function sourceLinks(record) {
    return [...record.provenance.sourceRefs, ...(record.mapSourceRefs || [])].map(id => [...data.sources.records, ...data.mapSources.records].find(s => s.id === id)).filter(s => s && s.url && /^https?:/.test(s.url)).map(s => `<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(new URL(s.url).hostname)}</a>`).join(', ');
  }
  // Illustrative travel-time estimate: straight line x 1.4 road factor at 30 mph. Not routed, not a dispatch time.
  const travelMin = km => Math.max(1, Math.round(km * 1.4 / 48.28 * 60));
  function distanceKm(p) {
    const o = data.config.origin, rad = x => x * Math.PI / 180;
    const a = Math.sin(rad(p.latitude - o.latitude) / 2) ** 2 + Math.cos(rad(o.latitude)) * Math.cos(rad(p.latitude)) * Math.sin(rad(p.longitude - o.longitude) / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function resourceHtml(kind, record) {
    let body = `<b>${escape(record.name)}</b><br>${distanceKm(record.location).toFixed(1)} km from incident ignition (straight line)<br>`;
    if (kind === 'cameras') {
      const o = record.orientationSnapshot, g = record.workbookGeometry;
      body += `Camera ID: ${escape(record.externalId)}<br>Facing: ${o.facingDegrees.toFixed(2)}&deg; &middot; FOV: ${o.fieldOfViewDegrees.toFixed(2)}&deg;<br>Elevation: ${record.elevationMeters} m<br>Origin in recorded horizontal view: <b>${g.originInHorizontalView ? 'Yes' : 'No'}</b><br>`;
      body += `Coordinates: ${record.location.latitude.toFixed(5)}, ${record.location.longitude.toFixed(5)} (${escape(record.location.verificationStatus.replace(/_/g, ' '))})<br>Data status: workbook camera-list snapshot, not live; no 2021 footage is asserted.<br><span class="muted">Recorded ${escape(o.asOf)} snapshot; not verified 2021 pointing. Cameras pan. Bearing/FOV match does not prove terrain visibility or detection.</span><br>`;
    } else if (kind === 'stations') {
      body += `${escape(record.address)}<br>Est. travel ~${travelMin(distanceKm(record.location))} min (straight line &times; 1.4 &divide; 30 mph; illustrative, not routed)<br>Availability unknown<br>${escape(data.overrides.records.find(r => r.recordId === record.id)?.note || (record.location.verificationStatus === 'usgs_national_structures_location' ? 'USGS National Structures Dataset reference point.' : 'Workbook coordinate; not independently confirmed.'))}<br>Staffing, equipment and availability unknown.<br>`;
    } else if (kind === 'aviation') {
      body += 'Airport/base reference point: approximate workbook coordinates.<br>Base existence is documented; current aircraft availability and response time are unknown.<br>';
    } else {
      body += `${escape(record.pointUsed || 'Documented water source')}<br>Dam/reference location, not a verified dip or scoop site. Current access and suitability unknown.<br>`;
    }
    return body + `Source: ${sourceLinks(record)}`;
  }
  function icon(text, ink, fill = '#211d18') {
    if (text && text.camera) return cameraIcon(text.n);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
    const g = canvas.getContext('2d'); g.fillStyle = fill; g.strokeStyle = ink; g.lineWidth = 3;
    g.beginPath(); g.roundRect(4, 4, 40, 40, 8); g.fill(); g.stroke();
    g.fillStyle = ink; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 24, 25);
    return canvas;
  }
  // Monitoring-camera icon: small CCTV camera (body, lens, mount) in amber on a dark tile with a thin amber border.
  function cameraIcon(n) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
    const g = canvas.getContext('2d'), amber = '#E8B04A';
    g.fillStyle = 'rgba(21, 18, 15, 0.92)'; g.strokeStyle = amber; g.lineWidth = 2;
    g.beginPath(); g.roundRect(4, 4, 40, 40, 8); g.fill(); g.stroke();
    g.fillStyle = amber; g.strokeStyle = amber;
    g.beginPath(); g.roundRect(10, 14, 22, 13, 3); g.fill();            // body
    g.beginPath(); g.moveTo(32, 17); g.lineTo(39, 13); g.lineTo(39, 28); g.lineTo(32, 24); g.closePath(); g.fill();   // lens hood
    g.fillStyle = 'rgba(21, 18, 15, 0.92)'; g.fillRect(16, 18, 6, 5);   // window on body
    g.fillStyle = amber; g.fillRect(19, 27, 4, 6); g.fillRect(13, 33, 16, 3);   // mount and base
    if (n) { g.font = 'bold 12px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText(String(n), 41, 40); }   // 1, 2 when cameras share a location
    return canvas;
  }
  // Fire-station label: compact dark pill, cream name, amber time, dark-orange accent (two colors, so drawn as an image).
  function stationPill(name, time) {
    const canvas = document.createElement('canvas'), g = canvas.getContext('2d'), font = '600 13px Barlow, sans-serif';
    g.font = font;
    const w1 = g.measureText(name).width, w2 = time ? g.measureText(' · ' + time).width : 0;
    canvas.width = Math.ceil(w1 + w2 + 20); canvas.height = 22;
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = 'rgba(21, 18, 15, 0.9)'; g.strokeStyle = '#8F3A17'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(0.5, 0.5, canvas.width - 1, 21, 3); g.fill(); g.stroke();
    g.fillStyle = '#C2461C'; g.fillRect(0, 0, 4, 22);
    g.fillStyle = '#EDE3CF'; g.fillText(name, 11, 12);
    if (time) { g.fillStyle = '#E8B04A'; g.fillText(' · ' + time, 11 + w1, 12); }
    return canvas;
  }
  function marker(group, id, position, name, ink, glyph, html, offset = 0, label = true, range, fill) {
    const entity = viewer.entities.getOrCreateEntity(id);
    Object.assign(entity, { parent: groups[group], name,
      position: Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude),
      billboard: { image: icon(glyph, ink, fill), scale: 0.6, pixelOffset: new Cesium.Cartesian2(offset, 0), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
      label: label ? { showBackground: typeof label === 'string', backgroundColor: color('#15120F').withAlpha(0.82), backgroundPadding: new Cesium.Cartesian2(6, 3), text: typeof label === 'string' ? label : name, font: '500 13px Barlow, sans-serif', fillColor: color('#EDE3CF'), outlineColor: color('#15120F'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, 24), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, range || (group === 'ignition' ? 150000 : 80000)) } : undefined
    });
    details.set(entity.id, html); return entity;
  }
  async function init(v, root, compassElement) {
    if (initialized) return;
    if (!initializing) initializing = initialize(v, root, compassElement).catch(error => {
      initializing = undefined;
      throw error;
    });
    return initializing;
  }
  async function initialize(v, root, compassElement) {
    await load(); viewer = v; mapRoot = root; compass = compassElement;
    // Ignition is a standalone marker, not a layer parent with the same ID.
    for (const group of ['cameras', 'stations', 'aviation', 'water']) groups[group] = viewer.entities.getOrCreateEntity('regional-' + group);
    const cfg = data.config, cfgOrigin = cfg.origin;
    marker('ignition', 'regional-ignition', cfg.origin, data.incident.name + ' ignition', '#F26B2E', 'F', '<b>' + escape(data.incident.name) + ' ignition</b><br>' + cfg.origin.latitude + ', ' + cfg.origin.longitude + '<br>Historical incident: ' + escape(data.incident.historical.date) + '<br>Historical replay. Fire footprint is illustrative, not a verified perimeter or current detection.<br>' + sourceLinks({ provenance: { sourceRefs: data.incident.historical.origin.sourceRefs } }) + '<br><a href="#" data-zoom-fire>Zoom to fire</a>');
    const placedCameras = new Map();
    for (const record of data.resources.cameras.filter(hasPosition)) {
      const key = record.location.latitude + ',' + record.location.longitude, index = placedCameras.get(key) || 0;
      const total = data.resources.cameras.filter(r => hasPosition(r) && r.location.latitude + ',' + r.location.longitude === key).length;
      placedCameras.set(key, index + 1);
      marker('cameras', record.id, record.location, record.name, '#E8B04A', { camera: true, n: total > 1 ? index + 1 : 0 }, resourceHtml('cameras', record), (index - (total - 1) / 2) * 28, index === 0, 35000);
    }
    groups.help = viewer.entities.getOrCreateEntity('regional-help');
    const located = data.resources.stations.filter(hasPosition).sort((a, b) => distanceKm(a.location) - distanceKm(b.location));
    located.forEach((record, i) => {
      const near = i < 5, km = distanceKm(record.location), shortName = record.name.replace(/, .*$/, '');
      // Orange station icon with a dark outline (stands out on satellite imagery); label is a separate pill below it.
      marker('stations', record.id, record.location, record.name, '#15120F', 'S', resourceHtml('stations', record), 0, false, undefined, '#E85D2A');
      const pill = viewer.entities.getOrCreateEntity('regional-station-label-' + record.id);
      Object.assign(pill, { parent: groups.stations, name: record.name + ' label', position: Cesium.Cartesian3.fromDegrees(record.location.longitude, record.location.latitude),
        billboard: { image: stationPill(shortName, near ? '~' + travelMin(km) + ' min' : ''), verticalOrigin: Cesium.VerticalOrigin.TOP, pixelOffset: new Cesium.Cartesian2(0, 14), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, i < 3 ? 120000 : 45000) } });   // nearest 3 stay visible zoomed out; the rest appear when zoomed in
      details.set(pill.id, resourceHtml('stations', record));
      if (!near) return;
      const line = viewer.entities.getOrCreateEntity('regional-help-line-' + record.id);
      Object.assign(line, { parent: groups.help, name: 'Illustrative connection to ' + record.name,
        polyline: { positions: [Cesium.Cartesian3.fromDegrees(cfgOrigin.longitude, cfgOrigin.latitude), Cesium.Cartesian3.fromDegrees(record.location.longitude, record.location.latitude)], clampToGround: true, width: 2.5, material: new Cesium.PolylineDashMaterialProperty({ color: color('#FFC24D').withAlpha(0.95), dashLength: 14 }) } });
      details.set(line.id, '<b>' + escape(record.name) + '</b><br>Illustrative straight-line connection from the ignition, not a verified road route.<br>Est. travel ~' + travelMin(km) + ' min (' + km.toFixed(1) + ' km &times; 1.4 &divide; 30 mph). Availability unknown.');
    });
    for (const record of data.resources.water.filter(hasPosition)) marker('water', record.id, record.location, record.name, '#A8D4F2', 'W', resourceHtml('water', record));
    for (const record of data.resources.aviation.filter(r => r.recordType === 'base' && hasPosition(r))) marker('aviation', record.id, record.location, record.name + ' (approx.)', '#EDE3CF', 'A', resourceHtml('aviation', record));
    const styles = { roads: ['#8A7F70', 1.2], water: ['#6FAED9', 1], creeks: ['#6FAED9', 1.5], buildings: ['#EDE3CF', 1], towns: ['#EDE3CF', 1], powerlines: ['#C9B98F', 1] };
    for (const [name, fc] of Object.entries(data.geography)) {
      if (name === 'powerlines' && cfg.utilityGeometryVerified !== true) continue;
      if (!fc.features.length || dataSources[name]) continue;
      const [ink, width] = styles[name];
      const ds = await Cesium.GeoJsonDataSource.load(fc, { clampToGround: true, stroke: color(ink), strokeWidth: width, fill: color(ink).withAlpha(0.18), credit: fc.metadata?.attribution || '' });
      ds.name = data.manifest.name + ' ' + name;
      for (const entity of ds.entities.values) {
        const p = entity.properties?.getValue(viewer.clock.currentTime) || {};
        const title = p.name || (name === 'buildings' ? 'Mapped building (use unverified)' : name);
        if (entity.position) {
          entity.billboard = undefined;
          entity.point = { pixelSize: name === 'towns' ? 5 : 3, color: color(ink), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, name === 'buildings' ? 90000 : 150000) };
          if (name === 'towns') entity.label = { distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, MAJOR_TOWNS.has(title) ? 110000 : 35000), text: title, font: '500 12px Barlow, sans-serif', fillColor: color(ink), outlineColor: color('#15120F'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, pixelOffset: new Cesium.Cartesian2(0, -15), disableDepthTestDistance: Infinity };
        }
        details.set(entity.id, `<b>${escape(title)}</b><br>${escape(fc.metadata?.attribution)}<br>${name === 'buildings' ? 'OSM building reference point; not a verified home or structure-at-risk count.' : 'Mapped geographic context; not a fire barrier or operational forecast.'}${p.osmUrl ? '<br><a target="_blank" rel="noopener noreferrer" href="' + escape(p.osmUrl) + '">OpenStreetMap feature</a>' : ''}`);
      }
      await viewer.dataSources.add(ds); dataSources[name] = ds;
      for (const entity of ds.entities.values) owners.set(entity.id, ds);
    }
    fire = DixieFire.create(viewer, cfg.origin);
    details.set('dixie-fire-head', '<b>Head of the fire</b> (simulated, downwind edge)<br>Terrain-draped simulated footprint, not a verified perimeter.<br><a href="#" data-zoom-fire>Zoom to fire</a>');
    buildWind();
    buildInfo();
    viewer.scene.postRender.addEventListener(updateNorth);
    initialized = true;
    resetView(0);
  }
  function buildInfo() {
    info = document.createElement('div'); info.className = 'satinfo regional-info'; info.hidden = true;
    mapRoot.appendChild(info);
    const resizeObserver = new ResizeObserver(() => {
      if (info.hidden) return;
      info.style.left = Math.max(4, Math.min(parseFloat(info.style.left) || 4, mapRoot.clientWidth - info.offsetWidth - 4)) + 'px';
      info.style.top = Math.max(36, Math.min(parseFloat(info.style.top) || 36, mapRoot.clientHeight - info.offsetHeight - 4)) + 'px';
    });
    resizeObserver.observe(mapRoot); // One observer for the single viewer lifetime.
    info.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('[data-zoom-fire]')) { e.preventDefault(); fire.zoom(); return; } if (e.target.closest('[data-close-regional]')) { info.hidden = true; pinned = false; selected = null; } });
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    function showAt(position, click) {
      const hits = viewer.scene.drillPick(position, 12);
      const hit = hits.find(h => h.id?.isShowing !== false && details.has(h.id?.id));
      if (!hit) { if (click || !pinned) { info.hidden = true; selected = null; pinned = false; } return; }
      selected = hit.id; pinned = click || pinned;
      info.innerHTML = '<button type="button" data-close-regional aria-label="Close map details">Close</button><br>' + details.get(hit.id.id);
      info.hidden = false;
      info.style.left = Math.max(4, Math.min(position.x + 14, mapRoot.clientWidth - info.offsetWidth - 4)) + 'px';
      info.style.top = Math.max(36, Math.min(position.y + 14, mapRoot.clientHeight - info.offsetHeight - 4)) + 'px';
    }
    handler.setInputAction(e => showAt(e.position, true), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(e => { if (!pinned && performance.now() - lastPointer > 100) { lastPointer = performance.now(); showAt(e.endPosition, false); } }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    viewer.scene.canvas.addEventListener('mouseleave', () => { if (!pinned) info.hidden = true; });
  }
  /* ---- Animated wind streaks (same look as the Kansas map; California geometry only) ----
     No sourced Dixie weather exists in the data package, so direction and speed are a labeled
     scenario assumption (up-canyon afternoon flow). Streaks follow sampled Cesium terrain. */
  const WIND = { towardDeg: 45, mph: 10, refMph: 10, radiusM: 16000, acrossM: 2600, alongM: 3600, lengthM: 2200, speedMps: 900, liftM: 140, alpha: 0.4, width: 2 };
  const wind = { on: true, collection: null, streaks: [], heights: new Map(), travel: 0, last: 0, t0: 0, fallbackH: 0, speedFactor: 1, assumed: true };
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function windMaterial() {
    return new Cesium.Material({ translucent: true, fabric: { uniforms: { color: new Cesium.Color(0.93, 0.91, 0.86, WIND.alpha) }, source: ['czm_material czm_getMaterial(czm_materialInput materialInput) {', '  czm_material m = czm_getDefaultMaterial(materialInput);', '  m.diffuse = color.rgb;', '  m.alpha = color.a * pow(materialInput.st.s, 1.5);', '  return m;', '}'].join(String.fromCharCode(10)) } });
  }
  function buildWind() {
    const o = data.config.origin, R = WIND.radiusM, material = windMaterial();
    wind.collection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    for (let ac = -R; ac < R; ac += WIND.acrossM) for (let al = -R; al < R; al += WIND.alongM) {
      wind.streaks.push({ across: ac + Math.random() * WIND.acrossM, along0: al + Math.random() * WIND.alongM, speed: WIND.speedMps * (0.85 + Math.random() * 0.3),
        len: WIND.lengthM * (0.75 + Math.random() * 0.5), phase: Math.random() * 6.283, line: wind.collection.add({ width: WIND.width, material, show: false }) });
    }
    wind.cosLat = Math.cos(o.latitude * Math.PI / 180);
    wind.t0 = wind.last = performance.now() / 1000;
    viewer.scene.preUpdate.addEventListener(windTick);
  }
  // Terrain height (m) cached on a 400 m grid; unloaded tiles fall back to the last known height and retry later.
  function terrainAt(e, n) {
    const key = Math.round(e / 400) + ',' + Math.round(n / 400), now = performance.now(), hit = wind.heights.get(key);
    if (hit && (hit.h !== undefined || now - hit.t < 2000)) return hit.h ?? wind.fallbackH;
    const o = data.config.origin, h = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(o.longitude + e / (111320 * wind.cosLat), o.latitude + n / 111320));
    wind.heights.set(key, { h: Number.isFinite(h) ? h : undefined, t: now });
    if (Number.isFinite(h)) { wind.fallbackH = h; return h; }
    return wind.fallbackH;
  }
  function placeStreak(s, travel, t) {
    const o = data.config.origin, R = WIND.radiusM, b = WIND.towardDeg * Math.PI / 180, sin = Math.sin(b), cos = Math.cos(b);
    const raw = s.along0 + s.speed * travel + R, head = (((raw % (2 * R)) + 2 * R) % (2 * R)) - R, across = s.across + 120 * Math.sin(t * 0.6 + s.phase);
    const pt = al => [al * sin + across * cos, al * cos - across * sin];   // wind frame -> [east, north] meters
    const H = pt(head), T = pt(head - s.len), M = pt(head - s.len / 2);
    if (Math.hypot(H[0], H[1]) > R || Math.hypot(T[0], T[1]) > R) { s.line.show = false; return; }
    const lift = Math.max(terrainAt(...H), terrainAt(...M), terrainAt(...T)) + WIND.liftM;
    const at = p => Cesium.Cartesian3.fromDegrees(o.longitude + p[0] / (111320 * wind.cosLat), o.latitude + p[1] / 111320, lift);
    s.line.positions = [at(T), at(H)];
    s.line.show = true;
  }
  function windTick() {
    const now = performance.now() / 1000;
    wind.travel += (now - wind.last) * wind.speedFactor; wind.last = now;
    if (!wind.on || !wind.collection) return;
    for (const s of wind.streaks) placeStreak(s, wind.travel, now - wind.t0);
  }
  function setWind(spec, on) {
    if (spec && Number.isFinite(spec.towardDeg) && Number.isFinite(spec.mph)) { WIND.towardDeg = spec.towardDeg; WIND.mph = spec.mph; }
    wind.speedFactor = WIND.mph / WIND.refMph;
    wind.on = on;
    if (wind.collection) wind.collection.show = on;
  }
  // Buildings inside the simulated likely-path envelope turn orange (real mapped points; none are added or moved).
  function highlightBuildings(step) {
    const ds = dataSources.buildings;
    if (!ds || step === pathStep || !Number.isInteger(step)) return;
    pathStep = step;
    const paint = (ids, ink, size) => ids.forEach(id => { const e = ds.entities.getById(id); if (e && e.point) { e.point.color = color(ink); e.point.pixelSize = size; } });
    paint(pathIds, '#EDE3CF', 3);
    pathIds = DixieFire.buildingsInPath(data, step).map(f => f.id);
    paint(pathIds, '#F26B2E', 5);
  }
  function updateNorth() {
    if (!compass || compass.hidden) return;
    const degrees = Cesium.Math.toDegrees(viewer.camera.heading);
    compass.querySelector('[data-wind="north"]').setAttribute('transform', 'rotate(' + (-degrees) + ' 28 28)');
    // Arrow points where the (assumed) California scenario wind blows toward, relative to camera heading.
    compass.querySelector('[data-wind="arrow"]').setAttribute('transform', 'rotate(' + (WIND.towardDeg - degrees).toFixed(1) + ' 28 28)');
    if (selected && (selected.isShowing === false || owners.get(selected.id)?.show === false)) { info.hidden = true; pinned = false; selected = null; }
  }
  function update(state) {
    if (!initialized) return;
    const layers = state.layers || {};
    fire.update(state.dixieFire, layers);
    setWind(state.wind, layers.wind !== false);
    groups.cameras.show = layers.cameras !== false;
    if (groups.help) groups.help.show = layers.help !== false;
    highlightBuildings(state.dixieFire && state.dixieFire.step);
    groups.stations.show = layers.stations !== false || layers.help !== false;
    groups.aviation.show = layers.help !== false;
    groups.water.show = layers.water !== false;
    for (const [name, ds] of Object.entries(dataSources)) ds.show = name === 'buildings' ? layers.houses !== false : name === 'water' || name === 'creeks' ? layers.water !== false : true;
    if (compass) {
      compass.hidden = layers.wind === false;
      compass.querySelector('.windtext').innerHTML = '<b>Wind from ' + COMPASS[Math.round(((WIND.towardDeg + 180) % 360) / 45) % 8] + ',</b><br>~' + WIND.mph + ' mph · scenario assumption';
    }
    updateNorth(); viewer.scene.requestRender();
  }
  function resetView(duration = 1.5) {
    if (!viewer || !data) return;
    const cfg = data.config, camera = cfg.camera;
    const sampled = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(cfg.origin.longitude, cfg.origin.latitude));
    const center = Cesium.Cartesian3.fromDegrees(cfg.origin.longitude, cfg.origin.latitude, Number.isFinite(sampled) ? sampled : 0);
    viewer.camera.cancelFlight();
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 0), { duration, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(camera.headingDegrees), Cesium.Math.toRadians(camera.pitchDegrees), camera.rangeMeters) });
  }
  function helpHtml() {
    if (!data) return '<div class="tabintro">Regional resources loading.</div>';
    const sections = [['Fire stations', data.resources.stations], ['Aerial support bases', data.resources.aviation.filter(r => r.recordType === 'base')], ['Water reference locations', data.resources.water], ['Unverified aircraft operators; not available resources', data.resources.aviation.filter(r => r.recordType !== 'base')]];
    return '<div class="tabintro">' + escape(data.manifest.name) + ' reference inventory, not a 2021 deployment record. Staffing, aircraft availability and ETAs are unknown; station travel times are illustrative estimates (straight line × 1.4 ÷ 30 mph), not routed or dispatch times. Water access and suitability are unverified.</div>' + sections.map(([title, records]) => '<div class="tabintro">' + title + '</div><ul>' + records.map(r => '<li class="row"><span class="who">' + escape(r.name) + '<small>Source: ' + sourceLinks(r) + (title === 'Fire stations' && hasPosition(r) ? '<br>Availability unknown' : '') + '</small></span><span class="muted">' + (hasPosition(r) ? (title === 'Fire stations' ? '~' + travelMin(distanceKm(r.location)) + ' min est. · ' : '') + distanceKm(r.location).toFixed(1) + ' km (straight line)' : 'Coordinates unknown') + '</span></li>').join('') + '</ul>').join('');
  }
  window.RegionalMap = runtime;
})();
