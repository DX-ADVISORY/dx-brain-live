'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context={console,Intl,Date,URL};context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'expertise-model.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'expertise-v1.js'),'utf8'),context);
const data=JSON.parse(fs.readFileSync(path.join(root,'status/expertise_public_v1.json'),'utf8'));
const V=context.DXExpertiseView;
for(const i of data.industries)for(const n of data.needs){
 const v=V.describe(data,{industry:i.id,need:n.id,date:'2026-11-07'});
 assert.equal(v.p.industry.id,i.id);assert.equal(v.p.need.id,n.id);assert.equal(v.known,0);
}
assert.equal(V.esc('<img src=x onerror="test">'),'&lt;img src=x onerror=&quot;test&quot;&gt;');
const snap={generated_at:'07/11/2026 20:00 (UTC+7)',skills:{total:266,domains:data.source_snapshot.skills.map(g=>[g.label,g.count+(g.id==='legal'?1:0)])}};
const next=V.bindSnapshot(data,snap);
assert.equal(next.source_snapshot.skills_total,266);assert.equal(next.source_snapshot.skills.find(x=>x.id==='legal').count,17);
assert.equal(next.source_snapshot.as_of,'2026-11-07T20:00:00+07:00');assert.equal(next.source_snapshot.independently_recounted,false);
assert.equal(data.source_snapshot.skills_total,265,'source object remains unchanged');
snap.skills.total=999;assert.equal(V.bindSnapshot(data,snap),data,'mismatched snapshot does not replace accepted counts');
snap.skills.total=266;snap.generated_at='05/11/2026 20:00 (UTC+7)';assert.equal(V.bindSnapshot(data,snap),data,'older page does not replace a newer aggregate');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.equal((index.match(/<!-- dx-cloud-status-hook -->/g)||[]).length,1,'existing retained hook exists once');
const hook=fs.readFileSync(path.join(root,'cloud-status.js'),'utf8');assert.ok(hook.includes('expertise-v1.js'),'expertise bootstraps through the retained status hook');
console.log('expertise view: 81 selections, escaping, nightly snapshot binding, stale/mismatch protection, retained hook PASS');
