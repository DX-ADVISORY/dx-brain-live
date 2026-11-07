/* Contract tests use synthetic records in memory. Not production evidence. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../expertise-model.js');
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../status/expertise_public_v1.json'),'utf8'));
let count=0;
function test(label,fn){fn();count++;process.stdout.write('PASS '+label+'\n');}
function copy(){return JSON.parse(JSON.stringify(base));}
function event(overrides={}){return {event_id:'fixture-only-001',resource_key:'fixture-content-a',resource_type:'knowledge_card',version:'1',stage:'approved',occurred_at:'2026-11-07T10:00:00+07:00',industry_id:'manufacturing',need_id:'cfo',public_approved:true,privacy_reviewed:true,receipt_id:'fixture-r-001',review_receipt_id:'fixture-review',source_url:'https://example.invalid/fixture-only',source_checked_at:'2026-11-07T09:00:00+07:00',...overrides};}
function cover(d,stages=M.STAGES){d.daily_coverage=[{date:'2026-11-07',industry_id:'manufacturing',need_id:'cfo',complete:true,public_approved:true,privacy_reviewed:true,receipt_id:'fixture-coverage',generated_at:'2026-11-07T23:55:00+07:00',stages}];return d;}
test('original snapshot sums to 265; 81 industry/need mappings resolve',()=>{assert.deepEqual(M.validate(base),[]);for(const i of base.industries)for(const n of base.needs)assert.equal(M.plan(base,i.id,n.id).outputs.length,3);assert.equal(base.industries.length*base.needs.length,81);});
test('unknown coverage remains null, never zero',()=>{assert.ok(Object.values(M.daily(base,'manufacturing','cfo','2026-11-07').counts).every(x=>x===null));});
test('confirmed empty day may show zero',()=>{const d=cover(copy());assert.equal(M.daily(d,'manufacturing','cfo','2026-11-07').counts.approved,0);});
test('duplicate resource/version/stage counts once across receipt IDs',()=>{const d=cover(copy());d.events=[event(),event({event_id:'fixture-only-002',receipt_id:'fixture-r-002'})];assert.equal(M.daily(d,'manufacturing','cfo','2026-11-07').counts.approved,1);});
test('new version counts separately, never as extra skill capacity',()=>{const d=cover(copy());d.events=[event(),event({event_id:'fixture-only-002',version:'2'})];assert.equal(M.daily(d,'manufacturing','cfo','2026-11-07').counts.approved,2);assert.equal(d.source_snapshot.skills_total,265);});
test('unreviewed or private items excluded',()=>{const d=cover(copy());d.events=[event({privacy_reviewed:false}),event({resource_key:'fixture-b',public_approved:false})];assert.equal(M.daily(d,'manufacturing','cfo','2026-11-07').counts.approved,0);});
test('source approval does not imply memory or retrieval pass',()=>{assert.equal(M.eligible(event({stage:'memory_written'}),base),false);assert.equal(M.eligible(event({stage:'retrieval_passed'}),base),false);assert.equal(M.eligible(event({stage:'retrieval_passed',test_receipt_id:'fixture-t',test_result:'PASS'}),base),true);});
test('legal applicability gate applies even inside an M&A label',()=>{const e=event({need_id:'ma',resource_type:'legal_document'});assert.equal(M.eligible(e,base),false);Object.assign(e,{legal_review_receipt_id:'fixture-legal',authoritative_source:true,legal_verified_at:'2026-11-07T09:30:00+07:00',legal_status:'effective',effective_from:'2026-11-01',transition_checked:true,applicability_scope:'synthetic fixture only'});assert.equal(M.eligible(e,base),true);e.effective_from='2026-12-01';assert.equal(M.eligible(e,base),false);e.effective_from='2026-11-01';e.effective_to='2026-11-07';assert.equal(M.eligible(e,base),false);});
test('day boundaries follow UTC+7',()=>{assert.equal(M.dayIct('2026-11-06T17:00:00Z'),'2026-11-07');assert.equal(M.dayIct('2026-11-06T16:59:59Z'),'2026-11-06');assert.equal(M.dayIct('2026-11-07T12:00:00'),null);});
test('one stage coverage does not certify all stages',()=>{const d=cover(copy(),['ingested']);d.events=[event()];const v=M.daily(d,'manufacturing','cfo','2026-11-07');assert.equal(v.counts.ingested,0);assert.equal(v.counts.approved,null);});
test('industry, need and date filters isolate records',()=>{const d=cover(copy());d.events=[event({industry_id:'property'}),event({need_id:'raising'}),event({occurred_at:'2026-11-06T10:00:00+07:00'})];assert.equal(M.daily(d,'manufacturing','cfo','2026-11-07').counts.approved,0);});
test('malformed snapshot total rejected',()=>{const d=copy();d.source_snapshot.skills_total=266;assert.ok(M.validate(d).length);});
process.stdout.write(JSON.stringify({passed:count,synthetic:true,runtime_scope:'local model only',browser_visual_qa:'NOT_RUN'})+'\n');
