/* Geographic map adapter. Uses absolute coordinates; never consumes Kansas STORY geometry. */
(function () {
  'use strict';
  const manifestPath = document.currentScript && document.currentScript.dataset.region;
  const active = !!manifestPath;
  let loading, initializing, data, viewer, mapRoot, compass, info, handler, initialized = false;
  let groups = {}, dataSources = {}, details = new Map(), owners = new Map(), pinned = false, selected = null, lastPointer = 0;
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = s => Cesium.Color.fromCssColorString(s);
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
    data = { manifest, config, incident, sources, mapSources, overrides, resources, geography, timeline };
    return data;
  }
  function sourceLinks(record) {
    return [...record.provenance.sourceRefs, ...(record.mapSourceRefs || [])].map(id => [...data.sources.records, ...data.mapSources.records].find(s => s.id === id)).filter(s => s && s.url && /^https?:/.test(s.url)).map(s => `<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(new URL(s.url).hostname)}</a>`).join(', ');
  }
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
      body += `<span class="muted">Recorded ${escape(o.asOf)} snapshot; not verified 2021 pointing. Cameras pan. Bearing/FOV match does not prove terrain visibility or detection.</span><br>`;
    } else if (kind === 'stations') {
      body += `${escape(record.address)}<br>${escape(data.overrides.records.find(r => r.recordId === record.id)?.note || (record.location.verificationStatus === 'usgs_national_structures_location' ? 'USGS National Structures Dataset reference point.' : 'Workbook coordinate; not independently confirmed.'))}<br>Staffing, equipment and availability unknown.<br>`;
    } else if (kind === 'aviation') {
      body += 'Airport/base reference point: approximate workbook coordinates.<br>Base existence is documented; current aircraft availability and response time are unknown.<br>';
    } else {
      body += `${escape(record.pointUsed || 'Documented water source')}<br>Dam/reference location, not a verified dip or scoop site. Current access and suitability unknown.<br>`;
    }
    return body + `Source: ${sourceLinks(record)}`;
  }
  function icon(text, ink) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
    const g = canvas.getContext('2d'); g.fillStyle = '#211d18'; g.strokeStyle = ink; g.lineWidth = 3;
    g.beginPath(); g.roundRect(4, 4, 40, 40, 8); g.fill(); g.stroke();
    g.fillStyle = ink; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 24, 25);
    return canvas;
  }
  function marker(group, id, position, name, ink, glyph, html, offset = 0, label = true) {
    const entity = viewer.entities.getOrCreateEntity(id);
    Object.assign(entity, { parent: groups[group], name,
      position: Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude),
      billboard: { image: icon(glyph, ink), scale: 0.6, pixelOffset: new Cesium.Cartesian2(offset, 0), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
      label: label ? { text: name, font: '500 13px Barlow, sans-serif', fillColor: color('#EDE3CF'), outlineColor: color('#15120F'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, 24), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, group === 'ignition' ? 150000 : 80000) } : undefined
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
    const cfg = data.config;
    marker('ignition', 'regional-ignition', cfg.origin, data.incident.name + ' ignition', '#F26B2E', 'F', '<b>' + escape(data.incident.name) + ' ignition</b><br>' + cfg.origin.latitude + ', ' + cfg.origin.longitude + '<br>Historical incident: ' + escape(data.incident.historical.date) + '<br>Phase 2: geographic context only. No fire progression or current detection.<br>' + sourceLinks({ provenance: { sourceRefs: data.incident.historical.origin.sourceRefs } }));
    const placedCameras = new Map();
    for (const record of data.resources.cameras.filter(hasPosition)) {
      const key = record.location.latitude + ',' + record.location.longitude, index = placedCameras.get(key) || 0;
      const total = data.resources.cameras.filter(r => hasPosition(r) && r.location.latitude + ',' + r.location.longitude === key).length;
      placedCameras.set(key, index + 1);
      marker('cameras', record.id, record.location, record.name, '#E8B04A', 'C' + (index + 1), resourceHtml('cameras', record), (index - (total - 1) / 2) * 28, index === 0);
    }
    for (const record of data.resources.stations.filter(hasPosition)) marker('stations', record.id, record.location, record.name, '#EDE3CF', 'S', resourceHtml('stations', record));
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
          entity.point = { pixelSize: name === 'towns' ? 5 : 3, color: color(ink), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, name === 'buildings' ? 25000 : 150000) };
          if (name === 'towns') entity.label = { text: title, font: '500 12px Barlow, sans-serif', fillColor: color(ink), outlineColor: color('#15120F'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, pixelOffset: new Cesium.Cartesian2(0, -15), disableDepthTestDistance: Infinity };
        }
        details.set(entity.id, `<b>${escape(title)}</b><br>${escape(fc.metadata?.attribution)}<br>${name === 'buildings' ? 'OSM building reference point; not a verified home or structure-at-risk count.' : 'Mapped geographic context; not a fire barrier or operational forecast.'}${p.osmUrl ? '<br><a target="_blank" rel="noopener noreferrer" href="' + escape(p.osmUrl) + '">OpenStreetMap feature</a>' : ''}`);
      }
      await viewer.dataSources.add(ds); dataSources[name] = ds;
      for (const entity of ds.entities.values) owners.set(entity.id, ds);
    }
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
    info.addEventListener('click', e => { if (e.target.closest('[data-close-regional]')) { info.hidden = true; pinned = false; selected = null; } });
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
  function updateNorth() {
    if (!compass || compass.hidden) return;
    const degrees = Cesium.Math.toDegrees(viewer.camera.heading);
    compass.querySelector('[data-wind="north"]').setAttribute('transform', 'rotate(' + (-degrees) + ' 28 28)');
    // Preserve the rotating compass, but do not imply Kansas replay wind is California weather.
    compass.querySelector('[data-wind="arrow"]').setAttribute('transform', 'rotate(' + (-degrees) + ' 28 28)');
    if (selected && (selected.isShowing === false || owners.get(selected.id)?.show === false)) { info.hidden = true; pinned = false; selected = null; }
  }
  function update(state) {
    if (!initialized) return;
    const layers = state.layers || {};
    groups.cameras.show = layers.sat !== false;
    groups.stations.show = layers.stations !== false || layers.help !== false;
    groups.aviation.show = layers.help !== false;
    groups.water.show = layers.water !== false;
    for (const [name, ds] of Object.entries(dataSources)) ds.show = name === 'buildings' ? layers.houses !== false : name === 'water' || name === 'creeks' ? layers.water !== false : true;
    if (compass) {
      compass.hidden = layers.wind === false;
      compass.querySelector('.windtext').innerHTML = '<b>North</b><br>' + escape(data.incident.name);
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
    const records = [...data.resources.stations, ...data.resources.aviation.filter(r => r.recordType === 'base')];
    return '<div class="tabintro">' + escape(data.manifest.name) + ' documented locations. Current staffing, aircraft availability and response times are unknown.</div><ul>' + records.map(r => '<li class="row"><span class="who">' + escape(r.name) + '</span><span class="muted">' + (hasPosition(r) ? distanceKm(r.location).toFixed(1) + ' km (straight line)' : 'Coordinates unknown') + '</span></li>').join('') + '</ul>';
  }
  window.RegionalMap = runtime;
})();
