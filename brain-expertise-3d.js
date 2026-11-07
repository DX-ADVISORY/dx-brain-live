/* Symbolic expertise constellations, rendered in the existing Three.js scene.
   Motion is illustrative. Receipts, not animation, determine learning metrics. */
(function(root){
 'use strict';
 if(typeof document==='undefined')return;
 const doc=document,stage=doc.getElementById('stage'),view=root.DXExpertiseView;
 if(!stage||!view||doc.getElementById('dx-3d-controls'))return;
 let E,sceneWorld,camera,glow,oldOrbit,oldParticles,oldGate,oldGateGlow,oldReview,oldRings;
 try{
  E=typeof THREE!=='undefined'?THREE:null;
  sceneWorld=typeof world!=='undefined'?world:null;
  camera=typeof cam!=='undefined'?cam:null;
  glow=typeof GT!=='undefined'?GT:null;
  oldOrbit=typeof orbit!=='undefined'?orbit:null;
  oldParticles=typeof PS!=='undefined'?PS:null;
  oldGate=typeof gate!=='undefined'?gate:null;
  oldGateGlow=typeof gGlow!=='undefined'?gGlow:null;
  oldReview=typeof RVW!=='undefined'?RVW:[];
  oldRings=[typeof ring!=='undefined'?ring:null,typeof ring2!=='undefined'?ring2:null];
 }catch(e){return;}
 if(!E||!sceneWorld||!camera||!glow)return;
 const current=view.current();if(!current.data)return;
 const data=current.data;
 const industryNames={'manufacturing':'Sản xuất','industrial-parks':'KCN','property':'BĐS · NOXH','hospitality':'Lưu trú','healthcare':'Y tế · Nha khoa','infrastructure':'Hạ tầng','mining':'Khoáng sản','retail':'Bán lẻ','technology':'CNTT · AI'};
 const needNames={legal:'Pháp lý',ma:'M&A',cfo:'CFO',tax:'Thuế · Kế toán',credit:'Tín dụng',valuation:'Định giá',raising:'Gọi vốn',restructure:'Tái cấu trúc',market:'Thị trường'};
 const palette={industry:'#54cdd7',need:'#c7a86d',legal:'#f5d68b',ma:'#b7a6ff'};
 let selected={industry:current.state.industry,need:current.state.need},expertMode=true;
 const controls=doc.createElement('div');controls.id='dx-3d-controls';
 controls.innerHTML='<div class="dx-3d-modes"><button type="button" data-mode="expert" aria-pressed="true">Chuyên môn 3D</button><button type="button" data-mode="system" aria-pressed="false">Hệ thống</button></div><div class="dx-3d-selects"><label>Ngành<select data-filter="industry" aria-label="Ngành trên bản đồ 3D"></select></label><label>Chuyên môn<select data-filter="need" aria-label="Chuyên môn trên bản đồ 3D"></select></label></div><div class="dx-3d-selection" aria-live="polite"></div><div class="dx-3d-proof">Chờ biên nhận tiến triển</div>';
 stage.appendChild(controls);
 const industrySelect=controls.querySelector('[data-filter="industry"]'),needSelect=controls.querySelector('[data-filter="need"]');
 for(const i of data.industries){const option=doc.createElement('option');option.value=i.id;option.textContent=i.label;industrySelect.appendChild(option);}
 for(const n of data.needs){const option=doc.createElement('option');option.value=n.id;option.textContent=n.label;needSelect.appendChild(option);}
 const labels=doc.createElement('div');labels.id='dx-3d-labels';stage.appendChild(labels);
 const group=new E.Group();group.name='DX expertise illustration';sceneWorld.add(group);
 const industryRing=new E.Group(),needRing=new E.Group();group.add(industryRing,needRing);
 const nodes=[];
 const nodeGeo=new E.SphereGeometry(.055,12,8);
 const particleCount=108,positions=new Float32Array(particleCount*3),colors=new Float32Array(particleCount*3);
 const particleGeometry=new E.BufferGeometry();particleGeometry.setAttribute('position',new E.BufferAttribute(positions,3));particleGeometry.setAttribute('color',new E.BufferAttribute(colors,3));
 const particleMaterial=new E.PointsMaterial({size:.075,map:glow,vertexColors:true,transparent:true,opacity:.95,depthWrite:false,blending:E.AdditiveBlending});
 const particles=new E.Points(particleGeometry,particleMaterial);group.add(particles);
 function ringLine(parent,radius,y,color){
  const points=[];for(let i=0;i<=120;i++){const a=i/120*Math.PI*2;points.push(new E.Vector3(Math.cos(a)*radius,y+Math.sin(a)*.27,Math.sin(a)*radius));}
  const line=new E.Line(new E.BufferGeometry().setFromPoints(points),new E.LineBasicMaterial({color,transparent:true,opacity:.19,depthWrite:false,blending:E.AdditiveBlending}));parent.add(line);
 }
 ringLine(industryRing,2.45,-.48,palette.industry);ringLine(needRing,2.02,.55,palette.need);
 function addNode(item,index,total,kind,parent,radius,y){
  const angle=index/total*Math.PI*2+(kind==='need'?.22:0);
  const color=kind==='industry'?palette.industry:(item.id==='legal'?palette.legal:item.id==='ma'?palette.ma:palette.need);
  const anchor=new E.Object3D();anchor.position.set(Math.cos(angle)*radius,y+Math.sin(angle)*.27,Math.sin(angle)*radius);parent.add(anchor);
  const core=new E.Mesh(nodeGeo,new E.MeshBasicMaterial({color}));anchor.add(core);
  const sprite=new E.Sprite(new E.SpriteMaterial({map:glow,color,transparent:true,opacity:.8,blending:E.AdditiveBlending,depthWrite:false}));sprite.scale.set(.4,.4,.4);anchor.add(sprite);
  const button=doc.createElement('button');button.type='button';button.className='dx-3d-node';button.dataset.kind=kind;button.dataset.node=item.id;button.style.setProperty('--node-color',color);button.textContent=(kind==='industry'?industryNames:needNames)[item.id]||item.label;button.setAttribute('aria-label',(kind==='industry'?'Ngành: ':'Chuyên môn: ')+item.label);button.setAttribute('aria-pressed','false');labels.appendChild(button);
  const curvePositions=new Float32Array(25*3),geo=new E.BufferGeometry();geo.setAttribute('position',new E.BufferAttribute(curvePositions,3));
  const line=new E.Line(geo,new E.LineBasicMaterial({color,transparent:true,opacity:.08,depthWrite:false,blending:E.AdditiveBlending}));group.add(line);
  const record={id:item.id,kind,index,anchor,core,sprite,button,line,curvePositions,color:new E.Color(color),baseY:anchor.position.y,a:new E.Vector3(),screen:new E.Vector3()};
  core.userData.dxExpertise=record;
  button.addEventListener('click',()=>choose(record));nodes.push(record);
 }
 data.industries.forEach((item,i)=>addNode(item,i,data.industries.length,'industry',industryRing,2.45,-.48));
 data.needs.forEach((item,i)=>addNode(item,i,data.needs.length,'need',needRing,2.02,.55));
 function choose(node){if(!expertMode)return;view.select(node.kind==='industry'?node.id:null,node.kind==='need'?node.id:null);}
 function sync(detail){
  if(detail){selected={industry:detail.industry,need:detail.need};}
  industrySelect.value=selected.industry;needSelect.value=selected.need;
  controls.querySelector('.dx-3d-selection').textContent=(industryNames[selected.industry]||'')+' · '+(needNames[selected.need]||'');
  nodes.forEach(n=>n.button.setAttribute('aria-pressed',String(selected[n.kind]===n.id)));
  const daily=detail&&detail.counts;
  const known=daily?Object.values(daily).some(x=>x!==null):false;
  controls.querySelector('.dx-3d-proof').textContent=known?'Có biên nhận · xem chi tiết':'Chờ biên nhận tiến triển';
  stage.dataset.expertiseIndustry=selected.industry;stage.dataset.expertiseNeed=selected.need;
 }
 function setMode(expert){
  expertMode=expert;doc.body.classList.toggle('dx-visual-brain',expert);stage.classList.toggle('dx-expertise-mode',expert);
  stage.dataset.expertiseMode=expert?'expert':'system';group.visible=expert;labels.hidden=!expert;
  controls.querySelector('.dx-3d-selects').hidden=!expert;controls.querySelector('.dx-3d-selection').hidden=!expert;controls.querySelector('.dx-3d-proof').hidden=!expert;
  controls.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.mode==='expert')===expert)));
  if(oldOrbit)oldOrbit.visible=!expert;if(oldGate)oldGate.visible=!expert;if(oldGateGlow)oldGateGlow.visible=!expert;
  oldReview.forEach(m=>m.visible=!expert);oldRings.forEach(m=>{if(m)m.visible=!expert;});
  if(oldParticles)oldParticles.material.opacity=expert?0:1;
  try{if(expert&&typeof dist!=='undefined')dist=Math.max(dist,7.3);}catch(e){}
  root.dispatchEvent(new Event('resize'));
 }
 controls.querySelector('[data-mode="expert"]').addEventListener('click',()=>setMode(true));
 controls.querySelector('[data-mode="system"]').addEventListener('click',()=>setMode(false));
 industrySelect.addEventListener('change',()=>view.select(industrySelect.value,null));needSelect.addEventListener('change',()=>view.select(null,needSelect.value));
 root.addEventListener('dx-expertise-change',e=>sync(e.detail));
 const canvas=doc.getElementById('c'),raycast=new E.Raycaster(),pointer=new E.Vector2();let down=null;
 canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
 canvas.addEventListener('click',e=>{if(!expertMode||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>8)return;const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycast.setFromCamera(pointer,camera);const hits=raycast.intersectObjects(nodes.map(n=>n.core));if(hits.length)choose(hits[0].object.userData.dxExpertise);});
 const temp=new E.Vector3();let elapsed=0,last=0;
 function curve(a,t,target){const u=1-t;target.set(u*u*a.x+2*u*t*a.x*.38,u*u*a.y+2*u*t*(a.y*.4+.65)+t*t*.08,u*u*a.z+2*u*t*a.z*.38);return target;}
 function animate(stamp){
  root.requestAnimationFrame(animate);const delta=Math.min(.05,last?(stamp-last)/1000:0);last=stamp;
  if(!expertMode||doc.hidden)return;
  const reducedMotion=doc.body.classList.contains('reduced');if(!reducedMotion)elapsed+=delta;
  industryRing.rotation.y=elapsed*.085;needRing.rotation.y=-elapsed*.12;industryRing.rotation.z=.12*Math.sin(elapsed*.25);needRing.rotation.z=-.12;
  particles.visible=!reducedMotion;
  group.updateMatrixWorld(true);
  const rect=stage.getBoundingClientRect();
  nodes.forEach(n=>{
   n.anchor.getWorldPosition(n.a);group.worldToLocal(n.a);
   const active=selected[n.kind]===n.id;
   const pulse=reducedMotion?1:1+.14*Math.sin(elapsed*2.4+n.index*.6);
   const size=(active?.66:.30)*pulse;n.sprite.scale.set(size,size,size);n.core.scale.setScalar(active?1.55:1);
   n.line.material.opacity=active?.62:.055;
   for(let j=0;j<25;j++){curve(n.a,j/24,temp);n.curvePositions.set([temp.x,temp.y,temp.z],j*3);}n.line.geometry.attributes.position.needsUpdate=true;
   n.anchor.getWorldPosition(n.screen);n.screen.project(camera);n.sx=(n.screen.x+1)*rect.width/2;n.sy=(1-n.screen.y)*rect.height/2;
   n.front=n.screen.z>-1&&n.screen.z<1&&n.sx>60&&n.sx<rect.width-60&&n.sy>165&&n.sy<rect.height-65;
   for(let j=0;j<6;j++){const t=(elapsed*(active?.32:.17)+n.index*.113+j/6)%1;curve(n.a,t,temp);const p=(nodes.indexOf(n)*6+j)*3;positions.set([temp.x,temp.y,temp.z],p);const intensity=active?1:.32;colors.set([n.color.r*intensity,n.color.g*intensity,n.color.b*intensity],p);}
  });
  const candidates=nodes.filter(n=>n.front).sort((a,b)=>(selected[b.kind]===b.id?1:0)-(selected[a.kind]===a.id?1:0)||a.screen.z-b.screen.z);
  const occupied=[];const shown=new Set();
  for(const n of candidates){if(shown.size>=8)break;const conflict=occupied.some(p=>Math.abs(p[0]-n.sx)<110&&Math.abs(p[1]-n.sy)<37);if(!conflict){shown.add(n);occupied.push([n.sx,n.sy]);}}
  nodes.forEach(n=>{n.button.hidden=!shown.has(n);if(shown.has(n)){n.button.style.left=n.sx+'px';n.button.style.top=n.sy+'px';}});
  particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;
 }
 if(root.ResizeObserver)new root.ResizeObserver(()=>root.dispatchEvent(new Event('resize'))).observe(stage);
 const initialCounts=root.DXExpertiseModel.daily(data,selected.industry,selected.need,current.state.date).counts;
 sync({...selected,counts:initialCounts});setMode(true);root.requestAnimationFrame(animate);
})(typeof globalThis!=='undefined'?globalThis:this);
