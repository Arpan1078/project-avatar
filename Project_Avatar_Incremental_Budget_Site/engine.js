
(function(g){
function fresh(C,id='cottonwood'){const p=C.presets.find(x=>x.id===id)||C.presets[0];return {version:4,preset:p.id,name:p.name,theme:'system',model:'autel',drones:1,owned:0,trainees:2,years:1,grant:0,budget:15000,tax:0,reserve:10,annualReserve:5,inflation:3,existingInternet:true,existingPower:true,existingHosting:false,coveredInsurance:false,portablePower:false,newSatellite:false,ownSupp:false,suppression:'none',suppDrones:0,agent:'water',buyAgents:false,newAgentLiters:0,suppSorties:40,newGenerator:false,agMode:'none',agHours:0,agMobs:0,agPilots:0,aviationCovered:false,aviationConfirmed:false,aid:true,aidMinutes:p.aidMinutes,aidConfirmed:false,aidExtra:0,water:'existing',waterVerified:false,newPump:false,newAccess:false,alerts:120,recipients:p.volunteers,sms:true,email:true,gust:20,wind:10,available:p.available,notes:'',custom:[],prices:Object.fromEntries(C.rates.map(r=>[r.id,r.value])),dronePrices:Object.fromEntries(C.models.map(m=>[m.id,m.price]))};}
function calc(s,C){const r=s.prices,m=C.models.find(m=>m.id===s.model);if(!m)throw Error('Choose a drone.');
for(const k of ['drones','owned','trainees','years','grant','budget','tax','reserve','annualReserve','inflation','suppDrones','newAgentLiters','suppSorties','agHours','agMobs','agPilots','aidMinutes','aidExtra','alerts','recipients','gust','wind','available']){s[k]=Number(s[k]);if(!Number.isFinite(s[k])||s[k]<0||s[k]>1e8)throw Error('Check '+k);}
for(const k of ['drones','owned','trainees','years','suppDrones','agPilots'])if(s[k]%1)throw Error('Use whole numbers for '+k);
if(s.years<1||s.years>10||s.owned>s.drones||s.tax>100)throw Error('Check years, tax or aircraft counts.');
Object.values(r).concat(Object.values(s.dronePrices)).forEach(x=>{if(!Number.isFinite(Number(x))||Number(x)<0||Number(x)>1e9)throw Error('Check prices.');});
const rows=[],warnings=[],unconfirmed=[];function add(label,cat,q,p,period='setup',tax=false,years=[]){if(q&&Number(p))rows.push({label,category:cat,quantity:q,unit:Number(p),amount:q*Number(p),period,tax,years});}function ann(label,cat,q,p){add(label,cat,q,p,'annual');}function cycles(life){let a=[];for(let y=life+1;y<=s.years;y+=life)a.push(y);return a;}function equip(label,cat,buy,total,p,life=5){add(label,cat,buy,p,'setup',true);if(cycles(life).length)add(label+' replacement',cat,total,p,'replacement',true,cycles(life));}
const n=s.drones,sites=m.id==='dock'?n:Math.min(1,n),price=Number(s.dronePrices[m.id]),sp=s.suppression==='none'?0:s.suppDrones;
equip(m.name,'New aircraft/equipment',m.id==='existing'?0:n-s.owned,n,price||(m.id==='existing'?8000:0));
cycles(2).filter(y=>!cycles(5).includes(y)).forEach(y=>add('Future verification batteries','New aircraft/equipment',n*m.packs,m.battery,'replacement',true,[y]));
add('New pilot course/test fees','Training',n?s.trainees:0,r.training);
if(n+sp){if(!s.coveredInsurance)ann('Additional insurance/rider allowance','System operation',1,r.insurance);ann('Additional aircraft maintenance','System operation',n+sp,r.service);}
if(!s.existingInternet&&n){equip('NEW connection equipment','New aircraft/equipment',sites,sites,r.router,7);ann('NEW cellular connection','Connectivity',sites*12,r.cell);}
if(!s.existingPower&&n)equip('NEW station backup power','New aircraft/equipment',sites,sites,r.power,7);
if(s.portablePower)equip('NEW portable power kit','New aircraft/equipment',1,1,r.portable,7);
if(s.newSatellite){equip('NEW ground satellite equipment','Connectivity',1,1,r.satHardware,7);ann('NEW ground satellite service','Connectivity',12,r.satMonthly);}
if(m.id==='dock'&&n){add('Dock installation','New aircraft/equipment',n,r.dockInstall);add('Remote operations planning','System setup',1,r.dockApprovals);ann('Dock vendor software','System operation',n*12,r.dockSoftware);warnings.push('Docking does not authorize remote flight. Confirm site power, network, pilot coverage and approvals.');}
add('Final app configuration/onboarding','Application',1,r.setup);add('Additional APPLICATION-only work','Application',r.appHours,r.appRate);
if(!s.existingHosting)ann('Hosting/data allowance','Application',12,r.hosting);ann('APPLICATION-only support','Application',12,r.support);
if(s.sms&&s.alerts*s.recipients){const segments=s.alerts*s.recipients*2*1.2;ann('SMS delivery + carrier allowance','Alerts',segments,r.sms);ann('Messaging number/campaign','Alerts',12,r.number);add('Messaging registration','Alerts',1,r.smsSetup);}
if(s.email)ann('Email delivery','Alerts',s.alerts*s.recipients,r.email);
if(s.newPump)equip('NEW water-source pump/adapter/hose','New water access',1,1,r.pump,7);if(s.newAccess)add('NEW access works','New water access',1,r.access);
if(s.water!=='existing'&&!s.waterVerified){unconfirmed.push('Natural water source: permission, seasonal water, bank/vehicle access, suction/lift and pump compatibility are not verified.');}
if(sp){let v=s.suppression==='t50'?Number(r.t50):s.suppression==='retrofit'?Number(r.donor)+Number(r.retrofit):Number(r.customSupp);equip('NEW suppression aircraft/payload','Experimental suppression',s.ownSupp?0:sp,sp,v);
add('New payload engineering/validation','Experimental suppression',1,r.engineering);add('New operational/insurance review','Experimental suppression',1,r.suppReview);add('System-specific suppression training FEES','Training',2,r.suppTraining);
if(s.newGenerator)equip('NEW suppression charging generator','Experimental suppression',1,1,r.generator,7);
if(s.suppression==='t50')cycles(2).filter(y=>!cycles(5).includes(y)).forEach(y=>add('Future T50 batteries','Experimental suppression',sp*3,r.t50Battery,'replacement',true,[y]));
if(s.agent==='co2')add('Pressure/custom-agent R&D','Experimental suppression',1,r.co2Engineering);
warnings.push('Experimental suppression is not a validated safe/effective fire-control capability. Engineering, agent compatibility, airspace, charging and insurer review remain necessary.');
if(s.suppression==='t50'&&s.gust>13.42)warnings.push('Entered gust exceeds the T50 reference ~13.4 mph wind limit. Do not assume it can fly.');}
if(s.buyAgents){if(s.agent==='co2')ann('EXTRA custom-agent purchase','Extra consumables',s.suppSorties,r.co2);else ann('EXTRA water/agent purchase','Extra consumables',s.newAgentLiters,r[s.agent]);}
if(s.agMode!=='none'){
add('Additional aviation coordination course FEES','Aviation expenses',s.agPilots,r.aviationTraining);
if(s.agMode==='volunteer'){
 if(!s.aviationCovered){ann('Aircraft operating EXPENSE reimbursement, no pilot wages','Aviation expenses',s.agHours,r.aviationHour);ann('Aircraft mobilization EXPENSES, no wages','Aviation expenses',s.agMobs,r.aviationMob);}
 if(!s.aviationConfirmed)unconfirmed.push('Volunteer aviation arrangement not confirmed: donated pilot time does not make aircraft fuel, maintenance or insurance free.');
 if(s.aviationCovered&&!s.aviationConfirmed)unconfirmed.push('Zero department aircraft expenses rely on an UNCONFIRMED donor/funding commitment.');
}else if(s.agMode==='agency'){
 if(!s.aviationConfirmed)unconfirmed.push('Agency-coordinated aviation: availability and who pays must be confirmed. No contract costs have been invented.');
}else if(s.agMode==='quoted'){
 ann('Quoted aircraft EXPENSE reimbursement, no wages','Aviation expenses',s.agHours,r.aviationHour);ann('Quoted aircraft mobilization EXPENSES','Aviation expenses',s.agMobs,r.aviationMob);
 if(!s.aviationConfirmed)unconfirmed.push('Aircraft-expense agreement is not confirmed. Obtain a quote separating any out-of-scope payroll.');
}
warnings.push('Kansas uses contracted firefighting aircraft. A pilot may also be a volunteer firefighter; that does not establish free aircraft operation.');}
if(s.aid){ann('EXTRA department mutual-aid charges by agreement','Mutual aid',1,s.aidExtra);if(!s.aidConfirmed)unconfirmed.push('Mutual-aid timing, availability and reimbursement arrangement not confirmed; do not count it as guaranteed arrival.');}
s.custom.forEach(x=>{let q=Number(x.quantity),p=Number(x.price);if(!Number.isFinite(q)||!Number.isFinite(p)||q<0||p<0||!['setup','annual'].includes(x.period))throw Error('Check extra cost.');add(x.name||'Extra system cost','Other incremental costs',q,p,x.period,x.period==='setup');});
const base=rows.filter(x=>x.period==='setup').reduce((a,x)=>a+x.amount,0),tax=rows.filter(x=>x.period==='setup'&&x.tax).reduce((a,x)=>a+x.amount*s.tax/100,0),reserve=(base+tax)*s.reserve/100,setup=base+tax+reserve;
const flow=Array.from({length:s.years},(_,i)=>{let annual=0,replacements=0,tx=0,f=(1+s.inflation/100)**i;rows.forEach(x=>{if(x.period==='annual')annual+=x.amount*f;if(x.period==='replacement'&&x.years.includes(i+1)){replacements+=x.amount*f;if(x.tax)tx+=x.amount*f*s.tax/100;}});let reserve=(annual+replacements+tx)*s.annualReserve/100;return {year:i+1,annual,replacements,tax:tx,reserve,total:annual+replacements+tx+reserve};});
const total=setup+flow.reduce((a,y)=>a+y.total,0);if(s.gust>m.wind&&n)warnings.push('Entered wind/gust exceeds the reference planning limit. Use ground reports/dispatch and coordinated aid rather than assuming a drone launch.');if(n&&s.available<2)warnings.push('Fewer than two people available: review actual pilot/support coverage before assigning a mission.');
if(s.newSatellite)warnings.push('Satellite is ground backhaul, not a direct satellite aircraft-command link.');
if(s.owned||m.id==='existing')warnings.push('Owned assets use a new planning replacement cycle; adjust for actual remaining life before a multi-year budget.');
return {rows,setup,base,tax,reserve,flow,total,net:Math.max(0,total-s.grant),annual:flow[0].total,year1:setup+flow[0].total,year1Net:Math.max(0,setup+flow[0].total-s.grant),warnings,unconfirmed,volunteerWages:0,otherWages:0,aidMinutes:s.aid?s.aidMinutes:null,existingResourceCost:0};}
g.AvatarCost={fresh,calc};if(typeof module!=='undefined')module.exports=g.AvatarCost;
})(typeof window!=='undefined'?window:globalThis);
