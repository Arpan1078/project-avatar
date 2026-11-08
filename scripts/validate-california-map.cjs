'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base=path.join(root,'data/regions/california');
const crypto=require('node:crypto');
const read=f=>JSON.parse(fs.readFileSync(path.join(base,f),'utf8').replace(/^\uFEFF/,''));
const cfg=read('map.json'),seen=[],bounds=cfg.contextBounds;
let bytes=0,features=0;
for(const source of read('geography/sources.json').records){
 const raw=fs.readFileSync(path.join(root,source.cachePath));
 assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),source.sha256);
 assert.equal(JSON.parse(raw).features.length,source.sourceRecordCount);
}
const structureSource=JSON.parse(fs.readFileSync(path.join(root,'reference-data/california-map-cache/structures.json'),'utf8'));
for(const supplement of read('geography/resource-verification.json').records){
 const feature=structureSource.features.find(f=>f.attributes.objectid===supplement.sourceFeatureId);
 assert(feature);assert.equal(supplement.location.latitude,feature.geometry.y);assert.equal(supplement.location.longitude,feature.geometry.x);
}
function coords(c){if(typeof c[0]==='number'){assert(Number.isFinite(c[0])&&Number.isFinite(c[1]));assert(c[0]>=bounds[0]-1e-6&&c[0]<=bounds[2]+1e-6&&c[1]>=bounds[1]-1e-6&&c[1]<=bounds[3]+1e-6,'Outside California extent');}else c.forEach(coords);}
for(const [kind,file] of Object.entries(cfg.geographicLayers)){
 const fc=read(file);assert.equal(fc.type,'FeatureCollection');assert.equal(fc.metadata.regionId,'us-ca');
 bytes+=fs.statSync(path.join(base,file)).size;features+=fc.features.length;
 for(const f of fc.features){coords(f.geometry.coordinates);if(f.geometry.type==='MultiPolygon')for(const polygon of f.geometry.coordinates)for(const ring of polygon){assert(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));}}
 if(kind==='powerlines')assert.equal(fc.features.length,0);
}
assert(bytes<3_000_000,'Keep geographic payload bounded');
const stub=()=>({innerHTML:'',classList:{toggle(){}},addEventListener(){},querySelector(){return null},getAttribute(){return null},focus(){}}),els=new Map();
const context={console,performance,Event,URL,setInterval,clearInterval,requestAnimationFrame(){return 1},cancelAnimationFrame(){},DroneUI:{update(){}},Cesium:{Color:class{},Cartographic:class{},Cartesian2:class{}},document:{baseURI:'https://firewatch.local/index.html',currentScript:{dataset:{region:'data/regions/california/region.json'}},documentElement:{style:{setProperty(){}}},getElementById(id){if(id==='thermalFeed')return null;if(!els.has(id))els.set(id,stub());return els.get(id)},querySelector:stub},fetch:async url=>{const u=new URL(url);seen.push(u.pathname);assert(u.pathname.startsWith('/data/regions/california/'),'Legacy geographic fetch: '+url);return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,u.pathname.slice(1)),'utf8'))};}};
context.window=context;vm.createContext(context);
for(const file of ['story.js','fire-types.js','regional-map.js','spread-forecast.js','dixie-fire.js','confidence-engine.js','dixie-scenario.js','mapdata.js','satellite.js','map3d.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
(async()=>{
 await context.MapData.load();assert.equal(context.MapData.error,null);assert.equal(context.MapData.loaded,true);assert.equal(context.MapData.buildings.length,0);assert.equal(context.MapData.power.length,0);
 const data=context.RegionalMap.data;
 assert.equal(data.resources.cameras.length,7);assert.equal(data.resources.stations.filter(r=>Number.isFinite(r.location.latitude)).length,4);
 assert.equal(data.resources.aviation.filter(r=>r.recordType==='base'&&Number.isFinite(r.location.latitude)).length,1);
 assert.equal(data.resources.water.filter(r=>Number.isFinite(r.location.latitude)).length,5);
 assert.equal(data.config.origin.latitude,39.871306);assert.equal(data.config.origin.longitude,-121.389439);
 assert.equal(context.Map3D.pathHomes({place:'line',acres:200,path:true},35).length,0);assert.equal(context.Map3D.forecast({place:'line',acres:200,path:true},35),null);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const SCENARIO_MODULES'))[1];
 vm.runInContext(inline.slice(0,inline.indexOf('DroneUI.init(')),context);
 context.assert=assert;
 context.setInterval=callback=>{context.playTick=callback;return 1;};
 context.clearInterval=()=>{};
 vm.runInContext(`
 assert.equal(state.scenario,'dixie');
 assert.equal(incidentMenu().length,1);
 const dixieSteps=scenario().steps;
 assert.equal(dixieSteps.length,7);assert(!dixieSteps.some(x=>/unknown/i.test(x.time+x.record.time.label)));
 assert.equal(dixieSteps[0].date,'2021-07-13');
 assert.equal(dixieSteps[6].date,'2021-07-14');
 const knownClocks=dixieSteps.filter(s=>s.precision==='workbook_local_clock_only').map(s=>{
   const parts=s.record.time.label.match(/([0-9]+):([0-9]+) (AM|PM)/);
   return (s.date==='2021-07-14'?1440:0)+(Number(parts[1])%12+(parts[3]==='PM'?12:0))*60+Number(parts[2]);
 });
 assert(knownClocks.every((minute,i)=>i===0||minute>knownClocks[i-1]));
 assert.equal(dixieSteps.map(s=>s.record.order).join(','),'1,2,4,5,6,7,8');
 assert(dixieSteps.every(s=>s.timestamp===null && s.record.observation.detectionTimestamp===null));
 for(let i=0;i<7;i++){
   goTo(i);const ri=dixieSteps[i].recordIndex;assert.equal(compute().now.id,dixieSteps[i].id);
   const dashboard=compute();
   assert.equal(dashboard.tiles.map(t=>t.label).join('|'),'Time|Confidence|Area burned|Buildings in path|Volunteer Response|Response time');
   assert.equal(dashboard.tiles[0].value,dixieSteps[i].time);
   const ev=ConfidenceEngine.evaluate(RegionalMap.data.confidence.config,RegionalMap.data.confidence.evidence,ri);assert.equal(dashboard.tiles[1].value,ev.score);assert.equal(dashboard.conf,ev.score);assert.equal(ev.score,Math.max(0,Math.min(100,ev.signals.reduce((t,x)=>t+x.points,0))));assert([0,0,25,25,55,75,75][i]===ev.score);assert.equal(ev.alert,i>=5);assert.equal(dashboard.tiles[5].value,'14');assert.equal(dashboard.tiles[5].unit,'min');assert.equal(dashboard.tiles[4].value,ev.alert?3:0);assert.equal(dashboard.tiles[4].unit,'of 5');assert.equal(dashboard.peopleRows.length,5);assert(!/unavailable|Not assessed/i.test(JSON.stringify(dashboard.conditions)));assert(dashboard.conditions.weather.length>=3);assert.equal(dashboard.map.dixieFire.step,ri);assert(ev.signals.filter(x=>x.state==='unavailable').every(x=>x.points===0));assert(!/%/.test(String(dashboard.confNote))||/not a probability/.test(dashboard.confNote));
   assert.equal(dashboard.pathHomes.length,DixieFire.buildingsInPath(RegionalMap.data,ri).length);
   assert(dashboard.compare.every(c=>c.ours==='—'));
   assert(droneFeed(dashboard).includes('SIMULATED FEED'));
   assert(!/Section 22|12:58|ETA 6/.test(droneFeed(dashboard)));
   for(const mode of ['simple','full'])for(const tab of TABS){
     state.mode=mode;state.tab=tab.key;render();
     assert(!/Kansas|Cottonwood|Section 22|legacy timeline|gusts 55/i.test(regions.footer.innerHTML+regions.aside.innerHTML+regions.toolbar.innerHTML+regions.tiles.innerHTML+regions.conditions.innerHTML));
   }
   if(i<6){goTo(state.step+1);assert.equal(state.step,i+1);goTo(state.step-1);assert.equal(state.step,i);}
 }
 goTo(0);togglePlay();assert.equal(state.playing,true);togglePlay();assert.equal(state.playing,false);
 togglePlay();for(let i=1;i<7;i++){playTick();assert.equal(state.step,i);}playTick();assert.equal(state.playing,false);
 assert.equal(compute().conf,compute().confidence.score);assert.equal(compute().goes.length,0);
 goTo(3);assert.equal(compute().tiles[2].value,'~1,600');assert.equal(compute().tiles[2].unit,'sq ft');
 goTo(6);assert.equal(compute().tiles[2].value,'~500');assert.equal(compute().tiles[2].unit,'acres');
 const synthetic={config:RegionalMap.data.config,geography:{buildings:{features:[
   {id:'inside',geometry:{type:'Point',coordinates:[-121.389439,39.871306]}},
   {id:'outside',geometry:{type:'Point',coordinates:[-121.5,39.9]}}
 ]}}};
 assert.equal(DixieFire.buildingsInPath(synthetic,7).map(f=>f.id).join(','),'inside');
 assert.equal(DixieFire.buildingsInPath(synthetic,0).map(f=>f.id).join(','),'inside');
 assert(RegionalMap.helpHtml().includes('Chico Regional Airport'));
 assert(RegionalMap.helpHtml().includes('Cresta Reservoir'));
 assert(RegionalMap.helpHtml().includes('not available resources'));
 console.log('PASS: all 7 Dixie steps, July 13/14 rollover, Back/Next, Play/Pause, and 80 step/view/tab renders.');
 `,context);
 vm.runInContext(`if(typeof SCENARIOS!=='undefined')throw Error('Kansas scenario table still active');if(Object.keys(SCENARIO_MODULES).join()!=='dixie')throw Error('Unexpected scenario modules');const opts=incidentMenu();if(opts.length!==1||opts[0][0]!=='dixie'||!/Dixie Fire/.test(opts[0][1]))throw Error('Incident menu');state.scenario='dixie';let count=0;for(let k=0;k<8;k++){state.step=k;const v=compute();if(v.drone!==null)throw Error('Unapproved regional drone flight');for(const mode of ['simple','full']){state.mode=mode;for(const tab of TABS){state.tab=tab.key;render();count++;}}}if(!/value=.dixie./.test(regions.scenarioSelect.innerHTML)||regions.scenarioSelect.value!=='dixie')throw Error('Incident selector');console.log('PASS: incident selector lists only Dixie, default dixie; '+count+' step/mode/tab renders; Kansas scenario table not present.');`,context);
 assert(!els.get('mapOverlays').innerHTML.includes('Section 22'));
 vm.runInContext(`
const T = RegionalMap.data.confidence.config.alertThreshold;
const scores = scenario().steps.map((_, k) => DixieScenario.evaluateStep(RegionalMap.data, k).score);
const cross = scores.findIndex(s => s >= T);
if (!(cross > 0)) throw Error('no threshold crossing in the replay');
goTo(0); state.alertAt = null; state.alertOpen = false; let fires = 0;
for (let k = 1; k < scores.length; k++) { const was = state.alertOpen; goTo(k); if (state.alertOpen && !was) fires++;
  if (k === cross) { if (!state.alertOpen || state.alertAt !== cross) throw Error('alert must open at the crossing'); state.alertOpen = false; } }
if (fires !== 1) throw Error('exactly one popup per crossing, got ' + fires);
if (state.alertOpen) throw Error('dismissed popup must stay dismissed on later steps');
if (compute().alertPopup) throw Error('no popup after dismiss');
if (compute().alertRows.length !== 4) throw Error('alert workflow rows stay in the Alerts tab');
goTo(cross - 1); if (state.alertAt !== null || compute().alertRows.length) throw Error('alert re-arms when back below the threshold');
goTo(cross); if (!state.alertOpen) throw Error('alert can trigger again after going back');
const pop = compute().alertPopup; if (!pop || pop.score !== scores[cross] || !/Next 60 min/.test(pop.spread) || !pop.buildings || !pop.help) throw Error('popup content');
const html = dixieAlertHtml(pop); if (!/POTENTIAL WILDFIRE DETECTED/.test(html) || !/View incident/.test(html) || !/SIMULATED ALERT/.test(html) || /hypothetical Firewatch|No message has been sent/i.test(html) || !/data-act="closeAlert"/.test(html)) throw Error('popup html');
state.mode = 'full'; state.tab = 'alerts'; render(); if (!/Alert generated/.test(regions.aside.innerHTML) || !/Alert queued/.test(regions.aside.innerHTML) || !/Dispatch confirmed/.test(regions.aside.innerHTML) || !/simulated/i.test(regions.aside.innerHTML)) throw Error('Alerts tab workflow');
const modal = document.getElementById('alertModal'); if (!/POTENTIAL WILDFIRE DETECTED/.test(modal.innerHTML) || modal.hidden !== false) throw Error('popup rendered in the top-level modal'); if (/POTENTIAL WILDFIRE DETECTED/.test(regions.overlays.innerHTML)) throw Error('popup must not live inside the map overlay');
state.alertOpen = false; render(); if (modal.hidden !== true || /POTENTIAL/.test(modal.innerHTML)) throw Error('popup dismissed');
goTo(0); if (state.alertAt !== null || state.alertOpen) throw Error('restart re-arms');
goTo(scores.length - 1); if (!state.alertOpen || state.alertAt !== scores.length - 1) throw Error('jumping past the threshold triggers once');
// Buildings KPI = map calculation; missing data is not a misleading zero
const k = compute(); if (k.tiles[3].value !== k.pathHomes.length) throw Error('KPI must equal the geographic count');
const saved = RegionalMap.data.geography.buildings; RegionalMap.data.geography.buildings = { features: [] };
const missing = compute(); if (missing.tiles[3].value !== 'Data unavailable') throw Error('missing buildings must not show 0');
RegionalMap.data.geography.buildings = saved;
if (!compute().forecastRows.length || !/Illustrative|illustrative/.test(JSON.stringify(compute().forecastRows))) throw Error('forecast driver rows');
goTo(0); state.alertAt = null; state.alertOpen = false; state.tab = 'alerts'; render();
console.log('PASS: alert fires once per upward crossing (re-arms on Back/restart, jump handled), dismisses, logs simulated workflow; buildings KPI matches the geographic count; missing data shows unavailable.');
`,context);
 console.log(`PASS: ${features} California GeoJSON features, ${(bytes/1024/1024).toFixed(2)} MiB; 7 cameras, 4 located stations, 5 water points, 1 base. ${seen.length} regional fetches, no Kansas data requested.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
