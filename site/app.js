import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {loadDetailedScene} from '/detailed-scene.js';
import {createNavigation} from '/navigation.js';
import {createSmoothMotion,isMovementField} from '/keyboard-motion.mjs';
import {cameraVerticalFov} from '/room-lighting.js';
import {cloneLightMapTransport} from '/irradiance-lightmap.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {finite,polygonArea,insidePolygon,wallBlocks,formatLength,validateScenario,sourceToViewer} from '/geometry.mjs';

const $ = id => document.getElementById(id);
const photoMap = {
  'studio-a-live':['live.jpg','Live Room · curated TRC reference'],
  'studio-a-control':['mixing.jpg','Mixing Room · original photograph from the earlier capture project'],
  'recording-room':['recording.jpg','Recording Room · curated TRC reference'],
  'rehearsal-room':['rehearsal.jpg','Rehearsal Room · curated TRC reference'],
  'podcast-room':['podcast.jpg','Podcast Room · March 2026 facility photograph'],
  'bar-lounge':['lounge.jpg','Lounge · March 2026 facility photograph'],
  'mezzanine-review':['mezzanine.jpg','Mezzanine · March 2026 facility photograph'],
  'kitchen':['kitchen.jpg','Kitchen · actual TRC reference photograph'],
  'outdoor-gym-review':['gym.jpg','Outdoor gym · actual TRC reference photograph'],
  'patio-review':['patio.jpg','Patio · actual TRC reference photograph'],
  'sauna-review':['sauna.jpg','Sauna and cold plunge · March 2026 facility photograph']
};
const presets = {
  desk:['Desk',1.6,.8,.75],console:['Mixing console',2.2,1.1,.95],grand:['Grand piano',1.55,2.25,1.03],
  drums:['Drum kit',2.1,1.8,1.4],sofa:['Sofa',2.1,.9,.85],chair:['Chair',.55,.55,.88],
  table:['Table',1.2,1.2,.75],rack:['Equipment rack',.6,.7,1.25],custom:['Custom footprint',1,1,1]
};
const modelGroup=new THREE.Group(), dressingGroup=new THREE.Group(), layoutGroup=new THREE.Group(), measurementGroup=new THREE.Group();
modelGroup.name='TRC plan-derived architecture';dressingGroup.name='Illustrative equipment (not measured)';layoutGroup.name='Planning scenario';
let renderer,scene,camera,perspective,orthographic,controls,model,activeFloor,activeRoom='',mode='explore',units='imperial';
let walk=false,dirty=false,selectedItem='',scenario={version:1,items:[]},undo=[],startPointer=null,drag=null,measurePoints=[],sceneBounds,saveReady=false;
let yaw=0,pitch=0,animation=0,oldTime=0,messageTimer,walkingPointer=null,detailed,composer,renderPass,aoPass,navigation;
const keys=new Set(),wallMeshes=[],roomMeshes=[],labels=[],raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const walkMotion=createSmoothMotion(),panMotion=createSmoothMotion();
function resetMovement(){keys.clear();walkMotion.reset();panMotion.reset();}
const floorMaps=new Map(),historyLimit=30;
const palette={wall:'#454b51',floor:'#ad8669',highlight:'#315cba',metal:'#272e34',white:'#d8d8d1',wood:'#694535',red:'#682c32'};
const material=(color=palette.white,other={})=>new THREE.MeshStandardMaterial({color,roughness:.8,metalness:.05,...other});
function notify(text){$('message').textContent=text;$('message').classList.add('show');clearTimeout(messageTimer);messageTimer=setTimeout(()=>$('message').classList.remove('show'),5200);}
function currentFloor(){return floorMaps.get(activeFloor);}
function floorRooms(){return model.rooms.filter(room=>room.floorId===activeFloor);}
function currentRoom(){return model.rooms.find(room=>room.id===activeRoom);}
function elevation(floorId){const floor=floorMaps.get(floorId);return finite(floor?.elevation,finite(floor?.modelElevation));}
function makeBox(parent,name,width,height,depth,x,y,z,color){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material(color));
  mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function cylinder(parent,name,radius,height,x,y,z,color){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,24),material(color));mesh.name=name;
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function clearGroup(group){
  for(const object of [...group.children]){object.traverse(child=>{child.geometry?.dispose();if(child.material){for(const m of Array.isArray(child.material)?child.material:[child.material])m.dispose();}});group.remove(object);}
}
function makeRoom(room){
  if(!Array.isArray(room.polygon)||room.polygon.length<3)return;
  const shape=new THREE.Shape();room.polygon.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),material(floorMaps.get(room.floorId)?.elevation===null?'#c39b60':palette.floor,{side:THREE.DoubleSide}));
  mesh.rotation.x=-Math.PI/2;mesh.position.y=elevation(room.floorId)+.008;mesh.name=`Floor: ${room.name}`;
  mesh.userData={roomId:room.id,floorId:room.floorId,dimensionStatus:room.dimensionStatus||'plan-derived'};mesh.receiveShadow=true;
  modelGroup.add(mesh);roomMeshes.push(mesh);
  const element=document.createElement('div');element.className='room-label';element.textContent=room.name;$('scene-labels').append(element);
  const p=room.label||room.polygon[0];labels.push({room,element,point:new THREE.Vector3(p[0],elevation(room.floorId)+.1,p[1])});
}
function makeWall(wall){
  const dx=wall.end[0]-wall.start[0],dz=wall.end[1]-wall.start[1],length=Math.hypot(dx,dz);
  if(length<.005)return;
  const height=finite(wall.height,finite(floorMaps.get(wall.floorId)?.height,2.8)),thickness=finite(wall.thickness,.15),y0=elevation(wall.floorId);
  const group=new THREE.Group();group.name=wall.id;group.userData={floorId:wall.floorId,dimensionStatus:wall.dimensionStatus||'plan-derived',source:wall.source||model.metadata?.sources};
  group.position.set(wall.start[0],y0,wall.start[1]);group.rotation.y=-Math.atan2(dz,dx);
  const openings=(wall.openings||[]).filter(o=>o.width>0).map(o=>({...o,offset:Math.max(0,Math.min(length,o.offset)),width:Math.min(o.width,length-o.offset)})).sort((a,b)=>a.offset-b.offset);
  let cursor=0;
  function part(a,b,bottom,top,label){
    if(b-a<.005||top-bottom<.005)return;
    const mesh=makeBox(group,label,b-a,top-bottom,thickness,(a+b)/2,(bottom+top)/2,0,palette.wall);
    mesh.userData={floorId:wall.floorId,wallId:wall.id,base:bottom,fullHeight:top-bottom};wallMeshes.push(mesh);
  }
  for(const o of openings){
    part(cursor,o.offset,0,height,`${wall.id} wall`);
    const sill=finite(o.sill),head=Math.min(height,sill+finite(o.height,2.05));
    part(o.offset,o.offset+o.width,0,sill,`${wall.id} sill`);part(o.offset,o.offset+o.width,head,height,`${wall.id} lintel`);
    if(sill>.15){
      const glass=makeBox(group,`${wall.id} glass`,o.width,head-sill,.015,o.offset+o.width/2,(sill+head)/2,0,'#a3cedb');
      glass.material.transparent=true;glass.material.opacity=.19;glass.material.depthWrite=false;
      glass.userData={floorId:wall.floorId,base:sill,fullHeight:head-sill};wallMeshes.push(glass);
    }
    cursor=Math.max(cursor,o.offset+o.width);
  }
  part(cursor,length,0,height,`${wall.id} wall`);modelGroup.add(group);
}
function makeEquipment(item,illustrative=false){
  const group=new THREE.Group();group.name=item.name;group.position.set(item.x,elevation(item.floorId)+.025,item.z);group.rotation.y=item.rotation*Math.PI/180;
  group.userData={itemId:item.id,floorId:item.floorId,roomId:item.roomId,illustrative,dimensionStatus:item.dimensionStatus||'estimated',dimensions:{width:item.width,depth:item.depth,height:item.height}};
  const w=item.width,d=item.depth,h=item.height,type=item.type;
  const box=(name,W,H,D,x,y,z,color)=>makeBox(group,name,W,H,D,x,y,z,color);
  const leg=(x,z,height=h-.08)=>box('Leg',.045,height,.045,x,height/2,z,palette.metal);
  if(type==='desk'||type==='table'){
    if(type==='table'){cylinder(group,'Table top',Math.min(w,d)/2,.06,0,h-.03,0,palette.white);cylinder(group,'Pedestal',.055,h-.08,0,(h-.08)/2,0,palette.metal);cylinder(group,'Base',Math.min(w,d)*.25,.04,0,.02,0,palette.metal);}
    else{box('Desk top',w,.075,d,0,h-.0375,0,palette.wood);for(const x of [-w*.42,w*.42])for(const z of [-d*.4,d*.4])leg(x,z);}
  }else if(type==='chair'){
    box('Upholstered seat',w,.11,d*.85,0,h*.48,0,palette.white);box('Upholstered back',w,h*.52,.09,0,h*.74,-d*.4);group.children.at(-1).material.color.set(palette.white);
    for(const x of [-w*.35,w*.35])for(const z of [-d*.3,d*.3])leg(x,z,h*.43);
  }else if(type==='sofa'){
    box('Sofa base',w,h*.22,d,0,h*.24,0,palette.red);box('Sofa back',w,h*.62,.18,0,h*.65,-d*.42,palette.red);
    for(let i=0;i<3;i++)box('Seat cushion',w/3-.025,h*.16,d*.76,-w/3+i*w/3,h*.43,.07,palette.red);
    for(const x of [-w/2+.06,w/2-.06])box('Arm',.12,h*.45,d,x,h*.42,0,palette.red);
  }else if(type==='console'){
    box('Console frame',w,h*.2,d,0,h*.76,0,'#26353f');for(const x of [-w*.4,w*.4])box('Pedestal',.18,h*.68,d*.6,x,h*.34,0,palette.metal);
    box('Meter bridge',w,.15,.13,0,h-.075,-d*.4,'#172c36');
    for(let i=0;i<24;i++){const x=-w*.45+i*w*.9/23;box('Channel strip',w/30,.008,d*.64,x,h*.865,.025,'#839292');for(let k=0;k<3;k++)cylinder(group,'Control',.013,.012,x,h*.88,-d*.18+k*.09,k===0?'#ad343c':'#333a40');}
  }else if(type==='grand'){
    const shape=new THREE.Shape();shape.moveTo(-w*.5,d*.4);shape.lineTo(w*.5,d*.4);shape.lineTo(w*.5,-d*.07);shape.bezierCurveTo(w*.5,-d*.45,-w*.12,-d*.6,-w*.4,-d*.32);shape.lineTo(-w*.5,d*.4);
    const geo=new THREE.ExtrudeGeometry(shape,{depth:h*.2,bevelEnabled:true,bevelSize:.025,bevelThickness:.015,bevelSegments:2,steps:1});geo.rotateX(Math.PI/2);
    const body=new THREE.Mesh(geo,material('#17191a',{roughness:.33}));body.position.y=h*.88;body.castShadow=true;body.name='Grand piano body';group.add(body);
    box('Keyboard',w*.93,.055,.2,0,h*.65,d*.43,'#e6e0d4');
    for(let i=0;i<28;i++)box('Black key',w/75,.025,.11,-w*.43+i*w*.86/27,h*.69,d*.39,'#131a1f');
    for(const [x,z] of [[-w*.4,d*.26],[w*.4,d*.23],[-w*.13,-d*.36]])leg(x,z,h*.68);
  }else if(type==='drums'){
    const kick=cylinder(group,'Kick drum',h*.27,d*.3,0,h*.28,.12,'#aa6c2f');kick.rotation.x=Math.PI/2;
    for(const [x,z,r,y] of [[-w*.22,-d*.09,h*.14,h*.63],[w*.14,-d*.12,h*.15,h*.67],[w*.33,d*.14,h*.21,h*.38]]){cylinder(group,'Drum shell',r,.24,x,y,z,'#ac742f');cylinder(group,'Drum head',r,.015,x,y+.125,z,'#dddad0');}
    for(const [x,z] of [[-w*.36,-d*.32],[w*.37,-d*.28],[-w*.38,d*.2]]){cylinder(group,'Cymbal stand',.018,h*.92,x,h*.46,z,'#9caaae');cylinder(group,'Cymbal',w*.13,.012,x,h*.93,z,'#b3a15b');}
  }else if(type==='rack'){
    box('Rack case',w,h,d,0,h/2,0,'#1d272f');for(let y=.1;y<h;y+=.12)box('Rack unit',w*.85,.09,.02,0,y,d/2+.011,'#69737b');
  }else box('Planning envelope',w,h,d,0,h/2,0,'#7f9fae');
  if(!illustrative&&item.id===selectedItem){
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w+.045,h+.045,d+.045)),new THREE.LineBasicMaterial({color:'#315cba',depthTest:false}));outline.position.y=h/2;outline.renderOrder=3;group.add(outline);
  }
  return group;
}
function seedDressing(){
  let index=0;
  const add=(room,type,dx,dz,rotation=0)=>{
    const p=room.label||room.polygon[0],x=p[0]+dx,z=p[1]+dz,[name,width,depth,height]=presets[type];
    if(![[x-width/2,z-depth/2],[x+width/2,z-depth/2],[x+width/2,z+depth/2],[x-width/2,z+depth/2]].every(p=>insidePolygon(p,room.polygon)))return;
    dressingGroup.add(makeEquipment({id:`reference-${index++}`,name:`Illustrative ${name}`,type,x,z,width,depth,height,rotation,floorId:room.floorId,roomId:room.id},true));
  };
  for(const room of model.rooms){
    if(room.id==='studio-a-live'){add(room,'grand',-1.3,-1.7,0);add(room,'drums',1.5,-1.4);add(room,'sofa',-.8,2.3);}
    if(room.id==='studio-a-control'){add(room,'console',0,-.9);add(room,'chair',0,.25);add(room,'rack',1.5,-.5);add(room,'sofa',0,2);}
    if(room.id==='recording-room'){add(room,'desk',0,-.6);add(room,'chair',0,.35);add(room,'sofa',1.2,1.5);}
    if(room.id==='podcast-room'){add(room,'table',0,0);add(room,'chair',-.95,0,90);add(room,'chair',.95,0,-90);}
    if(room.id==='rehearsal-room'){add(room,'drums',0,-1.6);add(room,'desk',0,1.6);}
    if(room.id==='bar-lounge'){add(room,'sofa',1.2,1.6,90);add(room,'table',-1.1,1);add(room,'chair',-1.1,2);add(room,'desk',0,-1.8);}
    if(room.id==='mezzanine-review'){add(room,'sofa',0,-1.4);add(room,'table',0,.1);add(room,'chair',-1.15,.5);}
  }
}
function buildScene(){
  for(const floor of model.floors)floorMaps.set(floor.id,floor);
  for(const floor of model.floors){
    if(!floor.footprint?.length)continue;
    const shape=new THREE.Shape();floor.footprint.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const slab=new THREE.Mesh(new THREE.ShapeGeometry(shape),material(floor.elevation===null?'#d1a464':'#b4a28e',{side:THREE.DoubleSide}));
    slab.rotation.x=-Math.PI/2;slab.position.y=elevation(floor.id)-.025;slab.name=`${floor.name} floor substrate`;slab.receiveShadow=true;slab.userData={floorId:floor.id,dimensionStatus:floor.footprintStatus||'plan-derived'};modelGroup.add(slab);
  }
  for(const room of model.rooms)makeRoom(room);
  for(const wall of model.walls)makeWall(wall);
  seedDressing();scene.add(modelGroup,dressingGroup,layoutGroup,measurementGroup);
  sceneBounds=new THREE.Box3().setFromObject(modelGroup);
  const size=sceneBounds.getSize(new THREE.Vector3()),center=sceneBounds.getCenter(new THREE.Vector3());
  const platform=new THREE.Mesh(new THREE.PlaneGeometry(Math.max(size.x,size.z)*3,Math.max(size.x,size.z)*3),material('#dce3e7'));
  platform.rotation.x=-Math.PI/2;platform.position.set(center.x,-.09,center.z);platform.receiveShadow=true;scene.add(platform);
  const grid=new THREE.GridHelper(100,100,'#9fadb5','#c9d3d9');grid.position.set(0,-.07,0);scene.add(grid);
  modelGroup.userData={metadata:model.metadata,coordinateSystem:model.coordinateSystem,revision:model.revision};
}
function boundsForRoom(){
  const rooms=activeRoom?[currentRoom()]:floorRooms();const box=new THREE.Box3();
  for(const r of rooms.filter(Boolean))for(const [x,z] of r.polygon)box.expandByPoint(new THREE.Vector3(x,elevation(r.floorId),z));
  return box.isEmpty()?sceneBounds:box;
}
function frame(){
  if(!model)return;
  const box=boundsForRoom(),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),extent=Math.max(size.x,size.z,3);
  controls.target.copy(center);const ratio=$('viewport').clientWidth/Math.max(1,$('viewport').clientHeight);
  if(mode==='plan'||mode==='measure'){
    camera=orthographic;const vertical=Math.max(size.z+3,(size.x+3)/ratio);orthographic.top=vertical/2;orthographic.bottom=-vertical/2;orthographic.left=-vertical*ratio/2;orthographic.right=vertical*ratio/2;
    camera.position.set(center.x,center.y+70,center.z+.001);camera.up.set(0,0,-1);camera.lookAt(center);camera.updateProjectionMatrix();
  }else{
    camera=perspective;camera.up.set(0,1,0);
    const direction=new THREE.Vector3(.32,.8,1.05).normalize(),right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanH=tanV*ratio;
    center.y+=.5;controls.target.copy(center);let distance=5;
    for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z])for(const y of [center.y-.5,center.y+2.5]){
      const offset=new THREE.Vector3(x,y,z).sub(center);
      distance=Math.max(distance,offset.dot(direction)+Math.max(Math.abs(offset.dot(right))/tanH,Math.abs(offset.dot(up))/tanV));
    }
    camera.position.copy(center).addScaledVector(direction,distance*1.15);camera.lookAt(center);
  }
  controls.object=camera;controls.enableRotate=mode==='explore';controls.maxPolarAngle=Math.PI*.47;controls.minDistance=1;controls.maxDistance=120;controls.update();
}
function visibility(){
  const detailEnabled=!!detailed&&detailed.hasFloor(activeFloor)&&mode==='explore'&&$('details-enabled').checked;
  modelGroup.visible=!detailEnabled;
  for(const helper of scene.children)if(helper.type==='GridHelper')helper.visible=!detailEnabled;
  modelGroup.children.forEach(child=>child.visible=child.userData.floorId===activeFloor);
  const cap=$('cutaway').checked&&!walk ? .85 : Infinity;
  for(const mesh of wallMeshes){const {base,fullHeight}=mesh.userData;const visibleHeight=Math.max(0,Math.min(fullHeight,cap-base));mesh.visible=visibleHeight>.005;mesh.scale.y=visibleHeight/fullHeight;mesh.position.y=base+visibleHeight/2;}
  for(const group of [dressingGroup,layoutGroup])for(const child of group.children)child.visible=child.userData.floorId===activeFloor;
  dressingGroup.visible=$('furniture').checked&&!detailEnabled;
  detailed?.setView({floorId:activeFloor,roomId:activeRoom,walk,cutaway:$('cutaway').checked,furniture:$('furniture').checked,enabled:detailEnabled});
  for(const floor of roomMeshes){floor.material.color.set(floorMaps.get(floor.userData.floorId)?.elevation===null?'#c39b60':floor.userData.roomId===activeRoom?'#c6a587':palette.floor);}
  for(const label of labels)label.element.classList.toggle('selected',label.room.id===activeRoom);
  const exterior=activeFloor==='exterior-corridor-review';
  scene.background.set(exterior?'#bed1df':'#e1e6e9');
  scene.environmentIntensity=exterior?.65:.5;
  const sky=scene.children.find(obj=>obj.isHemisphereLight);if(sky)sky.intensity=detailEnabled?(exterior?1.5:.5):2.7;
  const sun=scene.children.find(obj=>obj.isDirectionalLight);
  if(sun){
    sun.intensity=detailEnabled?(exterior?2.2:1.2):3.1;
    const footprint=currentFloor()?.footprint||[],center=footprint.reduce((sum,p)=>sum.add(new THREE.Vector3(p[0],0,p[1])),new THREE.Vector3()).divideScalar(footprint.length||1);
    sun.position.copy(center).add(new THREE.Vector3(8,32,16));sun.target.position.copy(center);sun.target.updateMatrixWorld();
  }
  renderer.shadowMap.needsUpdate=true;
}
function fillRooms(){
  const select=$('room-select');select.replaceChildren(new Option('Whole floor',''));
  for(const room of floorRooms())select.add(new Option(room.name,room.id));select.value=activeRoom;
}
function updateFacts(){
  const room=currentRoom(),floor=currentFloor();$('scene-floor').textContent=room?room.name:floor.name;
  $('room-facts').replaceChildren();
  if(room){
    const area=polygonArea(room.polygon);const strong=document.createElement('strong');strong.textContent=units==='metric'?`${area.toFixed(1)} m²`:`${Math.round(area*10.76391)} sq ft`;
    const inferred=room.dimensionStatus?.includes('photo-estimated'),current=room.dimensionStatus?.includes('qualified current visual-layout');
    $('room-facts').append(strong,document.createTextNode(inferred?' · visual estimate':current?' · qualified current envelope':' · drawing-derived area'),document.createElement('br'),document.createTextNode(inferred?'Dimensions and placement inferred from photos':current?'2025 plan + current photographs · not site measured':'Dimensions: drawing-derived · heights: see source record'));
    if(room.appearanceStatus)$('room-facts').append(document.createElement('br'),document.createTextNode(room.appearanceStatus));
  }else $('room-facts').textContent=activeFloor==='mezzanine-review'?'Main room modeled · second upstairs area unlocated':`${floorRooms().length} mapped spaces · editable current-state model`;
  const separate=String(floor.alignmentStatus||floor.registrationStatus||floor.name).match(/unverified|review|separate/i)||activeFloor.includes('mezz');
  const exterior=activeFloor==='exterior-corridor-review';
  $('basis').textContent=exterior?'Photo-confirmed outdoor sequence · dimensions inferred':separate?'Upstairs alignment unverified':'Plan + photo-qualified layout · 1 grid square = 1 m';
  $('accuracy').textContent=exterior?'⚠ Indoor connection unverified':separate?'⚠ Upstairs shown separately · alignment unverified':'⚠ Current visual reconstruction · site checks pending';
  $('photo-toggle').disabled=!photoMap[activeRoom];
  $('photo-toggle').textContent=photoMap[activeRoom]?'Open room photo':activeRoom?'No reference photo for this room':'Choose a room to see its photo';
  $('add-item').disabled=!activeRoom;
  if(!$('photo-panel').hidden)showPhoto();
}
function updateURL(){const url=new URL(location.href);url.searchParams.set('mode',mode);url.searchParams.set('floor',activeFloor);if(activeRoom)url.searchParams.set('room',activeRoom);else url.searchParams.delete('room');history.replaceState({},'',url);}
function selectRoom(id,doFrame=true){if(walk&&doFrame)stopWalk();activeRoom=id;$('room-select').value=id;updateFacts();visibility();if(doFrame)frame();updateURL();}
function selectFloor(id){stopWalk();activeFloor=id;$('floor-select').value=id;activeRoom='';fillRooms();clearMeasurement();updateFacts();visibility();frame();updateURL();}
function setMode(next){
  stopWalk();mode=next;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
  $('layout-panel').hidden=mode!=='plan';$('measure-panel').hidden=mode!=='measure';
  $('hint').textContent=mode==='plan'?'Arrow keys to pan · drag your equipment':mode==='measure'?'Click two model points · arrow keys or drag to pan':'Arrow keys to pan · drag to orbit · scroll to zoom';
  if(mode!=='measure')clearMeasurement();visibility();frame();updateURL();
}
function setDirty(){dirty=true;$('save-state').textContent='Unsaved equipment changes';$('undo').disabled=!undo.length;}
function checkpoint(){undo.push(JSON.stringify(scenario.items));if(undo.length>historyLimit)undo.shift();$('undo').disabled=false;}
function redrawLayout(){clearGroup(layoutGroup);for(const item of scenario.items)layoutGroup.add(makeEquipment(item));visibility();refreshItemList();}
function refreshItemList(){
  const select=$('item-select');select.replaceChildren(new Option('Select equipment',''));
  for(const item of scenario.items)select.add(new Option(item.name,item.id));select.value=selectedItem;
  const item=scenario.items.find(x=>x.id===selectedItem);$('item-form').hidden=!item;
  if(item){for(const key of ['name','width','depth','height','x','z','rotation'])$('item-form').elements[key].value=typeof item[key]==='number'?Math.round(item[key]*1000)/1000:item[key];$('item-form').elements.measured.checked=item.dimensionStatus==='user-measured';}
}
function selectItem(id){selectedItem=id;redrawLayout();const item=scenario.items.find(x=>x.id===id);if(item){if(item.floorId!==activeFloor)selectFloor(item.floorId);$('layout-warning').hidden=true;}}
function placeAllowed(item){
  const c=Math.cos(item.rotation*Math.PI/180),s=Math.sin(item.rotation*Math.PI/180);
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[item.x+x*item.width/2*c+z*item.depth/2*s,item.z-x*item.width/2*s+z*item.depth/2*c]);
  return model.rooms.filter(r=>r.floorId===item.floorId).some(room=>corners.every(c=>insidePolygon(c,room.polygon)));
}
function warnFootprint(item){const outside=!placeAllowed(item);$('layout-warning').hidden=!outside;$('layout-warning').textContent=outside?'⚠ This footprint crosses a room boundary. Check walls and door clearance.':'';}
function addItem(){
  const room=currentRoom();if(!room)return notify('Choose a room first.');checkpoint();
  const type=$('preset').value,[name,width,depth,height]=presets[type],p=room.label||room.polygon[0];
  const item={id:crypto.randomUUID(),name,type,width,depth,height,x:p[0],z:p[1],rotation:0,roomId:room.id,floorId:activeFloor,dimensionStatus:'estimated'};
  scenario.items.push(item);selectedItem=item.id;setDirty();redrawLayout();warnFootprint(item);notify('Planning footprint added. Enter the equipment’s real dimensions.');
}
async function saveLayout(){
  return notify('This public copy is read-only. Use “Export equipment layout” to keep your changes.');
  if(!saveReady)return notify('The saved layout has not loaded safely. Export local changes and reload before saving.');
  $('save-layout').disabled=true;$('save-layout').textContent='Saving layout…';
  try{const response=await fetch('/api/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scenario,baseRevision:scenario.revision??null,modelRevision:model.revision})});const result=await response.json();if(!response.ok)throw new Error(result.error);scenario=result;dirty=false;$('save-state').textContent=`Saved ${new Date(result.savedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} on this Mac · version history kept`;notify('Layout saved. The architectural source was not changed.');}
  catch(error){notify(`Save failed: ${error.message}. Your changes are still in this page.`);}
  finally{$('save-layout').disabled=false;$('save-layout').textContent='Save layout';}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function exportGLB(){
  const button=$('export-glb');button.disabled=true;button.textContent='Exporting scene…';
  try{const group=new THREE.Group();
    const cloneForExport=source=>{const copy=source.clone(false);if(copy.material)copy.material=Array.isArray(copy.material)?copy.material.map(cloneLightMapTransport):cloneLightMapTransport(copy.material);delete copy.userData.trcLightMap;for(const child of source.children)if(!child.userData.runtimeOnly)copy.add(cloneForExport(child));return copy;};
    for(const source of [modelGroup,dressingGroup,detailed?.root,layoutGroup].filter(Boolean))group.add(cloneForExport(source));
    const result=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:true});download(new Blob([result],{type:'model/gltf-binary'}),'trc-planning-scene.glb');}
  catch(error){notify(`Export failed: ${error.message}`);}finally{button.disabled=false;button.textContent='Export visible 3D scene';}
}
function showPhoto(){
  const data=photoMap[activeRoom];if(!data){$('photo-panel').hidden=true;resize();return;}
  $('reference-photo').src=`/references/${data[0]}`;$('reference-photo').alt=`Actual ${currentRoom().name} at The Recording Club`;
  $('photo-title').textContent=currentRoom().name;$('photo-caption').textContent=`${data[1]}. Photo is a visual reference; model furniture and lighting are illustrative.`;
  $('photo-panel').hidden=false;resize();
}
function clearMeasurement(){measurePoints=[];clearGroup(measurementGroup);$('distance').textContent='First point…';}
function addMeasure(point){
  if(measurePoints.length===2)clearMeasurement();measurePoints.push(point.clone());
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.065,14,10),new THREE.MeshBasicMaterial({color:'#315cba',depthTest:false}));dot.position.copy(point);dot.renderOrder=5;measurementGroup.add(dot);
  if(measurePoints.length===1){$('distance').textContent='Second point…';return;}
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(measurePoints),new THREE.LineBasicMaterial({color:'#315cba',depthTest:false}));line.renderOrder=4;measurementGroup.add(line);$('distance').textContent=formatLength(measurePoints[0].distanceTo(measurePoints[1]),units);
}
function cursorRay(event){const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);}
function visibleIntersection(objects){return raycaster.intersectObjects(objects,true).find(hit=>{let object=hit.object;while(object){if(!object.visible)return false;object=object.parent;}return true;});}
function groundPoint(){const p=new THREE.Vector3();return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-elevation(activeFloor)-.02),p);}
function onPointerDown(event){
  if(walk){walkingPointer={x:event.clientX,y:event.clientY};return;}
  cursorRay(event);startPointer={x:event.clientX,y:event.clientY};
  if(mode==='plan'){
    const hit=visibleIntersection(layoutGroup.children);if(!hit)return;let object=hit.object;while(object&&!object.userData.itemId)object=object.parent;
    if(object){selectedItem=object.userData.itemId;checkpoint();const item=scenario.items.find(i=>i.id===selectedItem),point=groundPoint();if(!point)return;drag={id:item.id,dx:item.x-point.x,dz:item.z-point.z};controls.enabled=false;renderer.domElement.setPointerCapture(event.pointerId);redrawLayout();}
  }
}
function onPointerMove(event){
  if(walk){
    if(document.pointerLockElement===renderer.domElement){yaw-=event.movementX*.002;pitch=Math.max(-1.3,Math.min(1.3,pitch-event.movementY*.002));}
    else if(walkingPointer){yaw-=(event.clientX-walkingPointer.x)*.004;pitch=Math.max(-1.3,Math.min(1.3,pitch-(event.clientY-walkingPointer.y)*.004));walkingPointer={x:event.clientX,y:event.clientY};}
    return;
  }
  if(!drag)return;cursorRay(event);const point=groundPoint();if(!point)return;const item=scenario.items.find(i=>i.id===drag.id);
  item.x=Math.round((point.x+drag.dx)*20)/20;item.z=Math.round((point.z+drag.dz)*20)/20;setDirty();redrawLayout();warnFootprint(item);
}
function onPointerUp(event){
  walkingPointer=null;
  if(drag){drag=null;controls.enabled=true;if(renderer.domElement.hasPointerCapture(event.pointerId))renderer.domElement.releasePointerCapture(event.pointerId);return;}
  if(walk||!startPointer)return;const clicked=Math.hypot(event.clientX-startPointer.x,event.clientY-startPointer.y)<5;startPointer=null;if(!clicked)return;
  cursorRay(event);
  if(mode==='measure'){const hit=visibleIntersection(modelGroup.children);if(hit)addMeasure(hit.point);}
  else{const hit=visibleIntersection(roomMeshes);if(hit)selectRoom(hit.object.userData.roomId,false);}
}
function startWalk(){
  if(!model)return;
  resetMovement();
  if(!activeRoom){const room=floorRooms().find(r=>/live|lounge|mezzanine/.test(r.id))||floorRooms()[0];selectRoom(room.id,false);}
  mode='explore';document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));$('layout-panel').hidden=true;$('measure-panel').hidden=true;clearMeasurement();
  camera=perspective;controls.object=camera;controls.enabled=false;camera.up.set(0,1,0);const room=currentRoom(),p=room.label||room.polygon[0];
  const pose=detailed?.cameraFor(room.id);
  perspective.userData.walkLens=pose?.lens||23;perspective.fov=cameraVerticalFov(perspective.userData.walkLens,perspective.aspect);perspective.updateProjectionMatrix();
  camera.position.copy(pose?.position||new THREE.Vector3(p[0],elevation(activeFloor)+1.65,p[1]));
  if(navigation&&detailed.hasFloor(activeFloor)&&$('details-enabled').checked){
    const spawn=navigation.findClearPosition(camera.position,{floorId:activeFloor,searchRadius:1.4,roomPolygon:room.polygon});
    if(!spawn.ok){controls.enabled=true;frame();notify('This room does not yet have a clear walking start. Use the orbit view while its furnishings are checked.');return;}
    camera.position.copy(spawn.position);
  }
  if(pose){const direction=pose.target.clone().sub(camera.position).normalize();yaw=Math.atan2(-direction.x,-direction.z);pitch=Math.asin(direction.y);}else{yaw=0;pitch=0;}
  walk=true;visibility();$('exit-walk').hidden=false;
  $('touch-controls').hidden=!matchMedia('(pointer:coarse)').matches;$('hint').textContent='Hold arrows or WASD to walk · Shift faster · drag to look';
  renderer.domElement.focus();updateURL();
  if(matchMedia('(pointer:fine)').matches&&renderer.domElement.requestPointerLock){try{const request=renderer.domElement.requestPointerLock();request?.catch(()=>notify('Drag inside the model to look around.'));}catch{notify('Drag inside the model to look around.');}}
}
function stopWalk(){resetMovement();if(!walk)return;walk=false;document.exitPointerLock?.();controls.enabled=true;$('exit-walk').hidden=true;$('touch-controls').hidden=true;visibility();frame();$('hint').textContent='Hold arrow keys to pan · drag to orbit · scroll to zoom';}
function panView(dt){
  if(drag||!controls.enabled){panMotion.reset();return;}
  let x=Number(keys.has('arrowright'))-Number(keys.has('arrowleft'));
  let y=Number(keys.has('arrowup'))-Number(keys.has('arrowdown'));
  const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
  const movement=panMotion.step(x*.48,y*.48,dt);
  if(!movement.dx&&!movement.dy)return;
  const viewHeight=camera.isPerspectiveCamera?2*camera.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)):(camera.top-camera.bottom)/camera.zoom;
  camera.updateMatrixWorld();
  const offset=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(movement.dx*viewHeight)
    .addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),movement.dy*viewHeight);
  camera.position.add(offset);controls.target.add(offset);
}
function canWalk(x,z){
  if(!insidePolygon([x,z],currentFloor().footprint||[]))return false;
  if(navigation&&detailed?.root.visible)return navigation.testPosition(new THREE.Vector3(x,camera.position.y,z),{floorId:activeFloor}).ok;
  return !model.walls.filter(w=>w.floorId===activeFloor).some(w=>wallBlocks([x,z],w));
}
function moveWalk(dt){
  let forward=Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown'));
  let right=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
  const norm=Math.hypot(forward,right);if(norm>1){forward/=norm;right/=norm;}
  const speed=keys.has('shift')?3.1:1.75;
  const movement=walkMotion.step((-Math.sin(yaw)*forward+Math.cos(yaw)*right)*speed,(-Math.cos(yaw)*forward-Math.sin(yaw)*right)*speed,dt);
  const dx=movement.dx,dz=movement.dy;
  if(dx||dz){
    if(navigation&&detailed?.root.visible){
      for(const delta of [new THREE.Vector3(dx,0,0),new THREE.Vector3(0,0,dz)]){
        const result=navigation.tryMove(camera.position,delta,{floorId:activeFloor});
        if(result.position)camera.position.copy(result.position);
      }
    }else{
      if(canWalk(camera.position.x+dx,camera.position.z))camera.position.x+=dx;
      if(canWalk(camera.position.x,camera.position.z+dz))camera.position.z+=dz;
    }
    const entered=floorRooms().find(room=>insidePolygon([camera.position.x,camera.position.z],room.polygon));
    if(entered&&entered.id!==activeRoom)selectRoom(entered.id,false);
  }
  camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);
}
function resize(){
  if(!renderer)return;const w=Math.max(1,$('viewport').clientWidth),h=Math.max(1,$('viewport').clientHeight);renderer.setSize(w,h);composer?.setSize(w,h);aoPass?.setSize(Math.ceil(w*.7),Math.ceil(h*.7));perspective.aspect=w/h;perspective.fov=walk?cameraVerticalFov(perspective.userData.walkLens,perspective.aspect):48;perspective.updateProjectionMatrix();if(model&&!walk)frame();
}
function renderCurrentView(){
  detailed?.updateReflections(camera);
  renderer.info.reset();
  if(composer&&detailed?.root.visible){renderPass.camera=camera;aoPass.camera=camera;aoPass.enabled=mode==='explore'&&walk;composer.render();}else renderer.render(scene,camera);
}
function animate(time){
  const frameMs=oldTime?time-oldTime:0,started=performance.now();
  const dt=Math.min(.05,frameMs/1000||0);oldTime=time;if(walk)moveWalk(dt);else{controls.update(dt);panView(dt);}
  const movementMs=performance.now()-started;
  const occupied=[];
  for(const label of [...labels].sort((a,b)=>Number(b.room.id===activeRoom)-Number(a.room.id===activeRoom)||polygonArea(b.room.polygon)-polygonArea(a.room.polygon))){
    const show=$('labels').checked&&!walk&&label.room.floorId===activeFloor;label.element.hidden=!show;if(!show)continue;
    const v=label.point.clone().project(camera),x=(v.x*.5+.5)*$('viewport').clientWidth,y=(-v.y*.5+.5)*$('viewport').clientHeight,w=label.room.name.length*6.5+20;
    const box={left:x-w/2,right:x+w/2,top:y-16,bottom:y+16};
    label.element.hidden=v.z>1||v.z< -1||occupied.some(r=>box.left<r.right&&box.right>r.left&&box.top<r.bottom&&box.bottom>r.top);
    if(!label.element.hidden)occupied.push(box);label.element.style.left=`${x}px`;label.element.style.top=`${y}px`;
  }
  renderCurrentView();
  $('viewport').dataset.modelState=JSON.stringify({mode,activeFloor,activeRoom,walk,dirty,selectedItem,items:scenario.items.length,camera:camera.position.toArray().map(v=>Math.round(v*1000)/1000),rooms:roomMeshes.length,walls:wallMeshes.length,detailed:!!detailed,detailSummary:detailed?.summary,navigationReady:!!navigation,drawCalls:renderer.info.render.calls,frameMs:Math.round(frameMs),movementMs:Math.round(movementMs),cpuFrameMs:Math.round(performance.now()-started)});
  animation=requestAnimationFrame(animate);
}
function installEvents(){
  document.addEventListener('trc-benchmark-frame',()=>{
    if(walk){camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);}
    const context=renderer.getContext(),samples=[];
    renderCurrentView();context.finish();
    for(let index=0;index<5;index++){
      const started=performance.now();renderCurrentView();context.finish();
      samples.push({milliseconds:performance.now()-started,drawCalls:renderer.info.render.calls});
    }
    $('viewport').dataset.frameBenchmark=JSON.stringify({scope:'Five stationary renders in the existing Chrome tab with GPU completion; not sustained movement FPS',activeRoom,walk,asset:detailed?.manifest.asset,reflectionTextureSize:detailed?.reflectionAudit.textureSize,samples,webglError:context.getError(),documentVisibility:document.visibilityState});
  });
  // Read-only capture of this existing browser's WebGL output. This does not
  // focus the window, advance movement, or stand in for full-window UI QA.
  document.addEventListener('trc-capture-frame',()=>{
    if(walk){camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);}
    const started=performance.now();
    renderCurrentView();
    $('viewport').dataset.captureFrame=renderer.domElement.toDataURL('image/png');
    $('viewport').dataset.captureState=JSON.stringify({mode,activeFloor,activeRoom,walk,dirty,items:scenario.items.length,camera:camera.position.toArray(),verticalFov:camera.fov,aspect:camera.aspect,lens:camera.userData.walkLens,detailed:!!detailed,modelRevision:model.revision,asset:detailed?.manifest.asset,presentation:JSON.parse($('viewport').dataset.renderPresentation),reflections:detailed?.reflectionAudit,gridVisible:scene.children.some(child=>child.type==='GridHelper'&&child.visible),drawCalls:renderer.info.render.calls,captureCpuMs:Math.round(performance.now()-started),webglError:renderer.getContext().getError(),documentVisibility:document.visibilityState});
  });
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  $('floor-select').addEventListener('change',e=>selectFloor(e.target.value));$('room-select').addEventListener('change',e=>selectRoom(e.target.value));
  for(const id of ['cutaway','furniture','labels','details-enabled'])$(id).addEventListener('change',visibility);
  $('units').addEventListener('change',e=>{units=e.target.value;updateFacts();if(measurePoints.length===2)$('distance').textContent=formatLength(measurePoints[0].distanceTo(measurePoints[1]),units);});
  $('walk').addEventListener('click',startWalk);$('exit-walk').addEventListener('click',stopWalk);$('frame-room').addEventListener('click',()=>{stopWalk();frame();});$('reset-view').addEventListener('click',()=>{stopWalk();selectRoom('');});
  $('photo-toggle').addEventListener('click',showPhoto);$('photo-close').addEventListener('click',()=>{$('photo-panel').hidden=true;resize();});
  $('panel-toggle').addEventListener('click',()=>{const hidden=document.body.classList.toggle('controls-hidden');$('panel-toggle').setAttribute('aria-expanded',String(!hidden));resize();});
  $('clear-measure').addEventListener('click',clearMeasurement);$('add-item').addEventListener('click',addItem);$('item-select').addEventListener('change',e=>selectItem(e.target.value));
  $('item-form').addEventListener('submit',event=>{event.preventDefault();const item=scenario.items.find(i=>i.id===selectedItem);if(!item)return;
    const next={...item};for(const key of ['width','depth','height','x','z','rotation'])next[key]=Number(event.target.elements[key].value);
    next.name=event.target.elements.name.value.trim();next.dimensionStatus=event.target.elements.measured.checked?'user-measured':'estimated';
    try{validateScenario({items:[next]});}catch(error){notify(error.message);return;}checkpoint();Object.assign(item,next);setDirty();redrawLayout();warnFootprint(item);
  });
  $('delete-item').addEventListener('click',()=>{checkpoint();scenario.items=scenario.items.filter(i=>i.id!==selectedItem);selectedItem='';setDirty();redrawLayout();notify('Equipment removed. Undo restores it.');});
  $('undo').addEventListener('click',()=>{if(!undo.length)return;scenario.items=JSON.parse(undo.pop());selectedItem='';setDirty();redrawLayout();});
  $('save-layout').addEventListener('click',saveLayout);$('export-glb').addEventListener('click',exportGLB);
  $('export-layout').addEventListener('click',()=>download(new Blob([JSON.stringify({...scenario,modelRevision:model.revision},null,2)],{type:'application/json'}),'trc-equipment-layout.json'));
  renderer.domElement.addEventListener('pointerdown',onPointerDown);renderer.domElement.addEventListener('pointermove',onPointerMove);renderer.domElement.addEventListener('pointerup',onPointerUp);renderer.domElement.addEventListener('pointercancel',()=>{drag=null;controls.enabled=!walk;walkingPointer=null;});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(walk)stopWalk();return;}
    if(event.defaultPrevented||event.isComposing||event.altKey||event.metaKey||event.ctrlKey||isMovementField(event.target))return;
    const key=event.key.toLowerCase();
    if(!walk){if(['arrowup','arrowdown','arrowleft','arrowright'].includes(key)){event.preventDefault();keys.add(key);}return;}
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(key)){event.preventDefault();keys.add(key);}
  });
  document.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));window.addEventListener('blur',resetMovement);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){resetMovement();oldTime=0;}});
  document.addEventListener('focusin',event=>{if(isMovementField(event.target))resetMovement();});
  document.addEventListener('pointerlockchange',()=>{if(walk&&!document.pointerLockElement)$('hint').textContent='WASD to move · drag to look · Exit walk to return';});
  for(const button of document.querySelectorAll('[data-step]')){const key={forward:'w',back:'s',left:'a',right:'d'}[button.dataset.step];button.addEventListener('pointerdown',event=>{event.preventDefault();keys.add(key);button.setPointerCapture(event.pointerId);});for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>keys.delete(key));}
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  new ResizeObserver(resize).observe($('viewport'));
}
async function initialize(){
  try{
    window.__trcBoot='Loading source geometry';
    const response=await fetch('/api/model');model=await response.json();if(!response.ok)throw new Error(model.error);
    if(!Array.isArray(model.rooms)||!model.rooms.length||!Array.isArray(model.walls)||!model.floors?.length)throw new Error('The architectural geometry is not ready yet.');
    model=sourceToViewer(model);
    scene=new THREE.Scene();scene.background=new THREE.Color('#e1e6e9');scene.add(new THREE.HemisphereLight('#f6f8fa','#a99a87',2.7));
    const sun=new THREE.DirectionalLight('#ffefdb',3.1);sun.position.set(10,32,16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-50,right:50,top:50,bottom:-50,far:100});sun.shadow.bias=-.0003;scene.add(sun,sun.target);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.info.autoReset=false;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.localClippingEnabled=true;
    renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D club model. Arrow keys pan the view; in walk mode use WASD or arrow keys to move.');$('viewport').prepend(renderer.domElement);
    perspective=new THREE.PerspectiveCamera(48,1,.05,600);orthographic=new THREE.OrthographicCamera(-20,20,20,-20,.05,600);camera=perspective;controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;
    buildScene();const query=new URL(location.href).searchParams;activeFloor=model.floors.some(f=>f.id===query.get('floor'))?query.get('floor'):model.floors[0].id;
    if(/^v\d+(?:-[a-z0-9]+)*$/.test(query.get('preview')||'')&&query.get('color')==='agx'){
      renderer.toneMapping=THREE.AgXToneMapping;
      const exposure=Number(query.get('exposure')||2);
      renderer.toneMappingExposure=Number.isFinite(exposure)&&exposure>=.125&&exposure<=4?exposure:2;
    }
    $('viewport').dataset.renderPresentation=JSON.stringify({toneMapping:renderer.toneMapping===THREE.AgXToneMapping?'AgX':'ACES Filmic',exposure:renderer.toneMappingExposure,scope:'Display transform only; source irradiance and geometry unchanged'});
    try{
      detailed=await loadDetailedScene(scene,renderer,model,percent=>{$('loading').querySelector('span').textContent=percent===null?'Loading detailed interiors…':`Loading detailed interiors · ${percent}%`;});
      $('viewport').dataset.albedoAudit=JSON.stringify(detailed.albedoAudit);
      $('viewport').dataset.lightingAudit=JSON.stringify(detailed.lightingAudit);
      if(detailed.manifest.authoringAsset){
        $('blend-link').href=detailed.manifest.authoringAsset;
        const size=detailed.manifest.authoringBytes?` · ${Math.ceil(detailed.manifest.authoringBytes/1e6)} MB`:'';
        $('blend-link').textContent=`Editable reconstruction (.blend)${size} ↓`;
      }
      $('glb-link').href=detailed.manifest.downloadAsset||detailed.manifest.asset.replace(/\.gltf(?=[?#]|$)/,'.glb');
      const downloadFormat=/\.glb(?:[?#]|$)/.test($('glb-link').href)?'glb':'gltf';
      const downloadSize=downloadFormat==='glb'&&detailed.manifest.bytes?` · ${Math.ceil(detailed.manifest.bytes/1e6)} MB`:'';
      $('glb-link').textContent=`Detailed walkthrough model (.${downloadFormat})${downloadSize} ↓`;
      navigation=createNavigation(detailed.meshes,model.floors);
      $('viewport').dataset.navigationStats=JSON.stringify(navigation.stats);
      $('detail-status').textContent=detailed.manifest.preview?'Model preview · visual checks pending':'Photo-referenced interiors · dimensions inferred';
      scene.children.find(obj=>obj.isHemisphereLight).intensity=.5;sun.intensity=1.2;
      const viewTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:Math.min(4,renderer.capabilities.maxSamples)});
      composer=new EffectComposer(renderer,viewTarget);renderPass=new RenderPass(scene,camera);composer.addPass(renderPass);
      aoPass=new GTAOPass(scene,camera,800,600);aoPass.updateGtaoMaterial({radius:.45,thickness:.8,samples:8});aoPass.blendIntensity=.7;composer.addPass(aoPass);composer.addPass(new OutputPass());
    }catch(error){$('details-enabled').checked=false;$('details-enabled').disabled=true;$('detail-status').textContent=error.message+' Planning geometry remains available.';}
    for(const floor of model.floors)$('floor-select').add(new Option(floor.name,floor.id));$('floor-select').value=activeFloor;fillRooms();
    activeRoom=floorRooms().some(r=>r.id===query.get('room'))?query.get('room'):'';$('room-select').value=activeRoom;
    try{const savedResponse=await fetch('/api/scenario');const saved=await savedResponse.json();if(!savedResponse.ok)throw new Error(saved.error||'Saved layout request failed');scenario=saved.savedAt?{...saved,...validateScenario(saved)}:{version:1,items:[],modelRevision:model.revision};saveReady=true;
      if(saved.savedAt){$('save-state').textContent=`Saved layout loaded · ${new Date(saved.savedAt).toLocaleDateString()}`;if(saved.modelRevision!==model.revision)notify('The architecture changed since this layout was saved. Recheck equipment placement.');}}
    catch(error){scenario={version:1,items:[],modelRevision:model.revision};saveReady=false;$('save-layout').disabled=true;$('save-state').textContent='Saved layout could not load. Saving is locked to protect existing data; export local edits before reloading.';notify(`Saved layout could not load: ${error.message}. Existing saved data was not changed.`);}
    for(const limitation of [...(model.metadata?.limitations||[]),...(model.metadata?.appliedOverlay?.limitations||[])]){const li=document.createElement('li');li.textContent=typeof limitation==='string'?limitation:JSON.stringify(limitation);$('limits').append(li);}
    if(!$('limits').children.length){const li=document.createElement('li');li.textContent='Source plans establish this baseline. Site dimensions, ceiling heights and upstairs registration need checks.';$('limits').append(li);}
    window.__trcBoot='Installing controls';installEvents();
    window.__trcBoot='Drawing saved layout';redrawLayout();
    window.__trcBoot='Updating room facts';updateFacts();
    window.__trcBoot='Setting camera mode';setMode(['explore','plan','measure'].includes(query.get('mode'))?query.get('mode'):'explore');
    if(matchMedia('(max-width:650px)').matches){document.body.classList.add('controls-hidden');$('panel-toggle').setAttribute('aria-expanded','false');}
    window.__trcBoot='Sizing viewport';resize();$('loading').hidden=true;animation=requestAnimationFrame(animate);
    window.trcModel={get model(){return model;},get scenario(){return scenario;},get state(){return {mode,activeFloor,activeRoom,walk,dirty,selectedItem,roomCount:roomMeshes.length,wallCount:wallMeshes.length};},get camera(){return camera;},get renderer(){return renderer;},selectRoom,setMode,selectFloor,frame,canWalk};
    window.__trcBoot='Ready';
  }catch(error){window.__trcBootError=error.stack;$('loading').querySelector('strong').textContent='Model not ready to view.';$('loading').querySelector('span').textContent=error.message;$('retry').hidden=false;console.error(error);}
}
$('retry').addEventListener('click',()=>location.reload());initialize();
