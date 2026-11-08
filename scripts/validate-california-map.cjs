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
for(const file of ['story.js','fire-types.js','regional-map.js','dixie-scenario.js','mapdata.js','satellite.js','map3d.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
(async()=>{
 await context.MapData.load();assert.equal(context.MapData.error,null);assert.equal(context.MapData.loaded,true);assert.equal(context.MapData.buildings.length,0);assert.equal(context.MapData.power.length,0);
 const data=context.RegionalMap.data;
 assert.equal(data.resources.cameras.length,7);assert.equal(data.resources.stations.filter(r=>Number.isFinite(r.location.latitude)).length,4);
 assert.equal(data.resources.aviation.filter(r=>r.recordType==='base'&&Number.isFinite(r.location.latitude)).length,1);
 assert.equal(data.resources.water.filter(r=>Number.isFinite(r.location.latitude)).length,5);
 assert.equal(data.config.origin.latitude,39.871306);assert.equal(data.config.origin.longitude,-121.389439);
 assert.equal(context.Map3D.pathHomes({place:'line',acres:200,path:true},35).length,0);assert.equal(context.Map3D.forecast({place:'line',acres:200,path:true},35),null);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const SCENARIOS'))[1];
 vm.runInContext(inline.slice(0,inline.indexOf('DroneUI.init(')),context);
 context.assert=assert;
 context.setInterval=callback=>{context.playTick=callback;return 1;};
 context.clearInterval=()=>{};
 vm.runInContext(`
 assert.equal(state.scenario,'dixie');
 assert.equal(SCENARIO_MENU.length,1);
 const dixieSteps=scenario().steps;
 assert.equal(dixieSteps.length,8);
 assert.equal(dixieSteps[0].date,'2021-07-13');
 assert.equal(dixieSteps[7].date,'2021-07-14');
 const knownClocks=dixieSteps.filter(s=>s.precision==='workbook_local_clock_only').map(s=>{
   const parts=s.record.time.label.match(/([0-9]+):([0-9]+) (AM|PM)/);
   return (s.date==='2021-07-14'?1440:0)+(Number(parts[1])%12+(parts[3]==='PM'?12:0))*60+Number(parts[2]);
 });
 assert(knownClocks.every((minute,i)=>i===0||minute>knownClocks[i-1]));
 assert.equal(dixieSteps.map(s=>s.record.order).join(','),'1,2,3,4,5,6,7,8');
 assert(dixieSteps.every(s=>s.timestamp===null && s.record.observation.detectionTimestamp===null));
 for(let i=0;i<8;i++){
   goTo(i);assert.equal(compute().now.id,dixieSteps[i].id);
   for(const mode of ['simple','full'])for(const tab of TABS){
     state.mode=mode;state.tab=tab.key;render();
     assert(!/Kansas|Cottonwood|Section 22|legacy timeline/i.test(regions.footer.innerHTML+regions.aside.innerHTML+regions.toolbar.innerHTML));
   }
   if(i<7){goTo(state.step+1);assert.equal(state.step,i+1);goTo(state.step-1);assert.equal(state.step,i);}
 }
 goTo(0);togglePlay();assert.equal(state.playing,true);togglePlay();assert.equal(state.playing,false);
 togglePlay();for(let i=1;i<8;i++){playTick();assert.equal(state.step,i);}playTick();assert.equal(state.playing,false);
 assert.equal(compute().conf,null);assert.equal(compute().goes.length,0);
 console.log('PASS: all 8 Dixie steps, July 13/14 rollover, Back/Next, Play/Pause, and 80 step/view/tab renders.');
 `,context);
 vm.runInContext(`let count=0;for(const key of ['real','realNoPower','outage','burn']){state.scenario=key;for(let k=0;k<SCENARIOS[key].steps.length;k++){state.step=k;const v=compute();if(v.drone!==null)throw Error('Unapproved regional drone flight');for(const mode of ['simple','full']){state.mode=mode;for(const tab of TABS){state.tab=tab.key;render();count++;}}}}console.log('PASS: '+count+' legacy step/view/tab combinations run against the regional data adapter.');`,context);
 assert(!els.get('mapOverlays').innerHTML.includes('Section 22'));
 console.log(`PASS: ${features} California GeoJSON features, ${(bytes/1024/1024).toFixed(2)} MiB; 7 cameras, 4 located stations, 5 water points, 1 base. ${seen.length} regional fetches, no Kansas data requested.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
