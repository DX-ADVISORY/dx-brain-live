/* Client-facing expertise explorer. Aggregate records only; animation is not ingestion. */
(function(root){
 'use strict';
 const script=typeof document!=='undefined'?document.currentScript:null;
 const base=script?new URL('.',script.src):null;
 const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const labels={ingested:['Dữ liệu nạp mới','Biên nhận thu thập'],approved:['Tri thức đã duyệt','Nguồn và biên nhận duyệt'],memory_written:['Đã nạp bộ nhớ','Biên nhận ghi bộ nhớ'],retrieval_passed:['Truy xuất đạt','Kết quả kiểm thử đạt'],applied:['Đã áp dụng','Đầu ra được duyệt']};
 function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
 function localTime(iso){const d=new Date(iso);return Number.isNaN(d.getTime())?'Chưa có mốc':new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(d)+' UTC+7';}
 function bindSnapshot(data,snapshot){
  // The nightly publisher already exports #snap. Reuse its aggregate only when
  // the timestamp and every known group can be reconciled, without claiming a recount.
  const m=/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) \(UTC\+7\)$/.exec(snapshot&&snapshot.generated_at||'');
  if(!m||!snapshot.skills||!Array.isArray(snapshot.skills.domains))return data;
  const asOf=m[3]+'-'+m[2]+'-'+m[1]+'T'+m[4]+':'+m[5]+':00+07:00';
  if(!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)<Date.parse(data.source_snapshot.as_of))return data;
  const domains=snapshot.skills.domains;
  if(domains.length!==data.source_snapshot.skills.length||new Set(domains.map(g=>g[0])).size!==domains.length)return data;
  const groups=data.source_snapshot.skills.map(g=>{const found=domains.find(x=>x[0]===g.label);return found&&Number.isSafeInteger(found[1])&&found[1]>=0?{...g,count:found[1]}:null;});
  if(groups.some(g=>!g)||groups.reduce((n,g)=>n+g.count,0)!==snapshot.skills.total)return data;
  return {...data,source_snapshot:{...data.source_snapshot,as_of:asOf,skills_total:snapshot.skills.total,skills:groups,independently_recounted:false,source_binding:'page_snapshot'}};
 }
 function describe(data,state){
  const M=root.DXExpertiseModel,p=M.plan(data,state.industry,state.need),d=M.daily(data,state.industry,state.need,state.date);
  return {p,d,known:Object.values(d.counts).filter(n=>n!==null).length};
 }
 function shell(){return '<div class="dx-heading"><div><div class="dx-kicker">CHUYÊN MÔN · NGÀNH NGHỀ · TRI THỨC CÓ KIỂM CHỨNG</div><h2 id="dx-expertise-title">Chuyên môn theo ngành</h2><p class="dx-intro">Chọn lĩnh vực và vấn đề cần xử lý. Xem phạm vi tư vấn đề xuất, đầu việc liên quan và tiến triển tri thức có bằng chứng theo từng ngày.</p></div><div class="dx-version">9 lĩnh vực · 9 nhu cầu</div></div>'+
 '<div class="dx-body"><aside class="dx-industries"><div class="dx-label">Lĩnh vực của doanh nghiệp</div><div class="dx-industry-list" data-dx="industries"></div><label class="dx-mobile-select">Chọn lĩnh vực<select data-dx="industry-select" aria-label="Lĩnh vực kinh doanh"></select></label></aside><div class="dx-content"><div class="dx-label">Nhu cầu cần xử lý</div><div class="dx-needs" data-dx="needs"></div><div class="dx-selected" data-dx="selected" aria-live="polite"></div><div class="dx-columns"><div><h4>VẤN ĐỀ CẦN RÀ SOÁT</h4><ul class="dx-points" data-dx="topics"></ul></div><div><h4>ĐẦU RA DỰ KIẾN</h4><ul class="dx-points" data-dx="outputs"></ul></div></div><p class="dx-note dx-evidence-note" data-dx="skills"></p><p class="dx-note">Phạm vi cuối cùng phụ thuộc hồ sơ và người phụ trách chuyên môn. Danh mục này chưa phải bằng chứng đã hoàn thành mọi loại dịch vụ được liệt kê.</p></div></div>'+
 '<div class="dx-daily"><div class="dx-daily-heading"><div><h3>Tri thức và bộ nhớ phát triển theo ngày</h3><p class="dx-daily-caption" data-dx="daily-caption"></p></div><label class="dx-date">Ngày theo dõi (UTC+7)<input type="date" data-dx="date"></label></div><div class="dx-stage-grid" data-dx="stages" aria-live="polite"></div><div class="dx-day-state" data-dx="day-state"></div><ul class="dx-records" data-dx="events"></ul><p class="dx-note">Chưa xác minh khác với 0. Chỉ hiện 0 khi đã xác nhận đủ nhật ký của khâu đó trong ngày. Các khâu có thể cùng ghi nhận một tài nguyên nên không cộng thành tổng năng lực.</p></div>'+
 '<div class="dx-provenance"><details><summary>Căn cứ số liệu và lịch sử tiến triển</summary><p data-dx="source-date"></p><p>Pháp luật: tài liệu thu thập cần nguồn có thẩm quyền, ngày kiểm, hiệu lực, chuyển tiếp và phạm vi áp dụng trước khi được tính vào tri thức sử dụng. M&A: nội dung pháp lý trong giao dịch chịu cùng điều kiện kiểm chứng.</p><p>Bộ nhớ: có biên nhận ghi mới tính đã nạp; có kết quả kiểm thử mới tính truy xuất đạt. Hoạt ảnh 3D và số hạt chuyển động là minh họa, không phải số tài liệu nạp.</p><div data-dx="history"></div><p data-dx="fetch-state"></p></details></div>';}
 function render(host,data,state){
  const {p,d,known}=describe(data,state),q=name=>host.querySelector('[data-dx="'+name+'"]');
  host.querySelectorAll('[data-industry]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.industry===state.industry)));
  host.querySelectorAll('[data-need]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.need===state.need)));
  q('industry-select').value=state.industry;q('date').value=state.date;
  q('selected').innerHTML='<h3>'+esc(p.industry.label)+'</h3><div class="dx-focus">'+esc(p.need.label)+'</div><p class="dx-brief">'+esc(p.industry.focus)+'</p>';
  q('topics').innerHTML=p.topics.map(x=>'<li>'+esc(x)+'</li>').join('');
  q('outputs').innerHTML=p.outputs.map(x=>'<li>'+esc(x)+'</li>').join('');
  q('skills').innerHTML='<b>Nhóm kỹ năng liên quan trong ảnh nguồn:</b> '+p.skills.map(x=>esc(x.label)+' ('+x.count+' mục)').join(' · ')+'. Đây là số mục toàn DX, chưa phải số kỹ năng đã kiểm thử riêng cho ngành đang chọn.';
  q('daily-caption').textContent=p.industry.label+' / '+p.need.label;
  q('stages').innerHTML=root.DXExpertiseModel.STAGES.map(k=>'<div class="dx-stage"><div class="dx-stage-name">'+labels[k][0]+'</div><div class="dx-stage-count">'+(d.counts[k]===null?'Chưa xác minh':d.counts[k]+' mục')+'</div><div class="dx-stage-help">'+labels[k][1]+'</div></div>').join('');
  q('day-state').innerHTML=known?'Có biên nhận cho '+known+'/5 khâu trong ngày đã chọn.<p>Chỉ những khâu có nhật ký được xác nhận đủ mới hiển thị số.</p>':'Chưa có nhật ký được duyệt cho lựa chọn này.<p>Chưa có căn cứ xác nhận mức tăng theo ngành và ngày. Mục này sẽ nhận số khi có biên nhận tương ứng.</p>';
  const seen=new Set();q('events').innerHTML=d.events.filter(e=>{const k=e.resource_key+'|'+e.version+'|'+e.stage;if(seen.has(k))return false;seen.add(k);return true;}).map(e=>'<li>'+esc(e.public_title||'Tài nguyên đã duyệt')+' · '+labels[e.stage][0]+' · '+esc(e.receipt_id)+'</li>').join('');
  q('source-date').textContent='Ảnh số kỹ năng: '+localTime(data.source_snapshot.as_of)+'. Tổng ghi nhận '+data.source_snapshot.skills_total+' mục trong 11 nhóm. Chưa đếm lại nguồn. Bộ lọc chỉ đổi phạm vi đề xuất và nhật ký liên quan, không thay số gốc.';
  const dates=[...new Set(data.daily_coverage.filter(c=>c.industry_id===state.industry&&c.need_id===state.need).map(c=>c.date))].sort().reverse().slice(0,7);
  q('history').innerHTML=dates.length?'<table class="dx-history"><thead><tr><th>Ngày</th><th>Tri thức duyệt</th><th>Ghi bộ nhớ</th><th>Truy xuất đạt</th></tr></thead><tbody>'+dates.map(date=>{const v=root.DXExpertiseModel.daily(data,state.industry,state.need,date).counts;return '<tr><td>'+esc(date)+'</td>'+['approved','memory_written','retrieval_passed'].map(k=>'<td>'+(v[k]===null?'Chưa xác minh':v[k])+'</td>').join('')+'</tr>';}).join('')+'</tbody></table>':'<p>Chưa có chuỗi nhật ký đã xác nhận để so sánh 7 ngày. Chưa thể kết luận năng lực tăng hoặc giảm.</p>';
  if(state.fetchError)q('fetch-state').textContent='Chưa đọc được bản dữ liệu mới. Các mục hiện tại vẫn theo ảnh đã ghi nhận trước đó.';
  else q('fetch-state').textContent='Tự kiểm tra bản tổng hợp khi trang đang mở mỗi 5 phút. Mốc kiểm tra giao diện không được dùng làm mốc học hoặc nạp bộ nhớ.';
  if(root.dispatchEvent&&root.CustomEvent)root.dispatchEvent(new root.CustomEvent('dx-expertise-change',{detail:{industry:state.industry,need:state.need,date:state.date,counts:d.counts}}));
 }
 function mount(doc,baseUrl){
  if(doc.getElementById('dx-expertise'))return;
  const css=doc.createElement('link');css.rel='stylesheet';css.href=new URL('expertise-v1.css',baseUrl).href;css.id='dx-expertise-style';doc.head.appendChild(css);
  const host=doc.createElement('section');host.id='dx-expertise';host.setAttribute('aria-labelledby','dx-expertise-title');
  const main=doc.querySelector('main');if(main)main.insertAdjacentElement('afterend',host);else doc.body.appendChild(host);
  host.innerHTML='<div class="dx-error">Đang đọc danh mục chuyên môn và nhật ký tổng hợp…</div>';
  let data=null,busy=false;const state={industry:'manufacturing',need:'legal',date:today(),fetchError:false};
  function openSelection(industry,need){if(!data)return;if(industry)state.industry=industry;if(need)state.need=need;render(host,data,state);const stage=doc.getElementById('stage');(stage||host).scrollIntoView({behavior:'auto',block:'start'});}
  root.DXExpertiseView.select=openSelection;
  root.DXExpertiseView.current=()=>({data,state:{...state}});
  function installLinks(){
   const bars=doc.getElementById('bars');if(bars&&!doc.getElementById('dx-expertise-open')){
    const link=doc.createElement('a');link.id='dx-expertise-open';link.href='#stage';link.textContent='Khám phá chuyên môn 3D';bars.insertAdjacentElement('afterend',link);
    Array.from(bars.querySelectorAll('.bar')).forEach((bar,i)=>{const label=bar.firstElementChild;if(!label)return;const button=doc.createElement('button');button.type='button';button.className='dx-skill-link';button.textContent=label.textContent;button.setAttribute('aria-controls','dx-expertise');button.addEventListener('click',()=>{const targets=[[null,'tax'],[null,'ma'],['technology','legal'],[null,'cfo'],[null,'credit'],[null,'raising'],[null,'legal'],['property','legal'],['infrastructure','legal'],['healthcare','legal'],[null,'market']];const [industry,need]=targets[i]||[null,'legal'];openSelection(industry,need);});label.textContent='';label.appendChild(button);});
   }
   const header=doc.querySelector('header');if(header&&!doc.getElementById('dx-expertise-nav')){const a=doc.createElement('a');a.id='dx-expertise-nav';a.href='#stage';a.textContent='Chuyên môn 3D';header.appendChild(a);}
   const stage=doc.getElementById('stage');if(stage&&!doc.getElementById('dx-motion-note')){const note=doc.createElement('div');note.id='dx-motion-note';note.textContent='Chuyển động minh họa · số liệu theo biên nhận';stage.appendChild(note);}
  }
  function initialize(){
   host.innerHTML=shell();const q=name=>host.querySelector('[data-dx="'+name+'"]');
   q('industries').innerHTML=data.industries.map(x=>'<button type="button" data-industry="'+esc(x.id)+'" aria-pressed="false">'+esc(x.label)+'</button>').join('');
   q('industry-select').innerHTML=data.industries.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join('');
   q('needs').innerHTML=data.needs.map(x=>'<button type="button" data-need="'+esc(x.id)+'" aria-pressed="false">'+esc(x.label)+'</button>').join('');
   q('industries').addEventListener('click',e=>{const b=e.target.closest('[data-industry]');if(b){state.industry=b.dataset.industry;render(host,data,state);}});
   q('industry-select').addEventListener('change',e=>{state.industry=e.target.value;render(host,data,state);});
   q('needs').addEventListener('click',e=>{const b=e.target.closest('[data-need]');if(b){state.need=b.dataset.need;render(host,data,state);}});
   q('date').addEventListener('change',e=>{if(e.target.value){state.date=e.target.value;render(host,data,state);}});
   const detail=doc.createElement('details');detail.className='dx-full-details';
   while(host.firstChild)detail.appendChild(host.firstChild);
   const summary=doc.createElement('summary');summary.textContent='Chi tiết chuyên môn & nguồn dữ liệu';detail.insertBefore(summary,detail.firstChild);host.appendChild(detail);
   installLinks();render(host,data,state);
   if(root.location.hash==='#dx-expertise')detail.open=true;
   if(!doc.getElementById('dx-expertise-3d-loader')){const sceneScript=doc.createElement('script');sceneScript.id='dx-expertise-3d-loader';sceneScript.src=new URL('brain-expertise-3d.js',baseUrl).href;doc.head.appendChild(sceneScript);}
  }
  async function refresh(){
   if(busy||doc.hidden)return;busy=true;
   try{const response=await root.fetch(new URL('status/expertise_public_v1.json',baseUrl).href,{cache:'no-store'});if(!response.ok)throw new Error('data_http');let next=await response.json();const errors=root.DXExpertiseModel.validate(next);if(errors.length)throw new Error('data_invalid');
    try{const snap=doc.getElementById('snap');if(snap)next=bindSnapshot(next,JSON.parse(snap.textContent));}catch(e){/* Keep the independently timestamped aggregate file. */}
    const first=!data;data=next;state.fetchError=false;if(!data.industries.some(x=>x.id===state.industry))state.industry=data.industries[0].id;if(!data.needs.some(x=>x.id===state.need))state.need=data.needs[0].id;
    if(first)initialize();else render(host,data,state);
   }catch(e){state.fetchError=true;if(data)render(host,data,state);else host.innerHTML='<div class="dx-error">Chưa đọc được dữ liệu chuyên môn. Giữ nguyên bản đồ và các số liệu nguồn hiện có; chưa xác nhận tiến triển mới.</div>';}
   finally{busy=false;}
  }
  refresh();root.setInterval(refresh,300000);doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)refresh();});
 }
 root.DXExpertiseView={describe,esc,mount,bindSnapshot};
 if(base&&typeof document!=='undefined'){
  if(root.DXExpertiseModel)mount(document,base);
  else{const s=document.createElement('script');s.src=new URL('expertise-model.js',base).href;s.onload=()=>mount(document,base);document.head.appendChild(s);}
 }
})(typeof globalThis!=='undefined'?globalThis:this);
