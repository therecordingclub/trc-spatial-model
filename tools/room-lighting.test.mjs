import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RectAreaLight,SpotLight} from '../site/vendor/build/three.module.js';
import {
  MAX_ACTIVE_ROOM_LIGHTS,
  V13_LIGHTING_SELECTION_MODE,
  normalizeManifestLights,
  selectRoomLights,
} from '../site/room-lighting.js';

function light(name,{roomId='room-1',floorId='ground',role='practical',priority=0,index=0,intensity=40}={}){
  return {name,roomId,floorId,role,evidencePriority:priority,sourceIndex:index,intensity,renderLight:'area'};
}

{
  const candidates=[];
  for(let roomIndex=1;roomIndex<=10;roomIndex++){
    candidates.push(light(`Room ${roomIndex} primary`,{roomId:`room-${roomIndex}`,priority:100,index:roomIndex*2}));
    candidates.push(light(`Room ${roomIndex} secondary`,{roomId:`room-${roomIndex}`,priority:90,index:roomIndex*2+1}));
  }
  const selected=selectRoomLights(candidates,{roomId:'',floorId:'ground',maxLights:8,selectionMode:V13_LIGHTING_SELECTION_MODE});
  assert.equal(selected.length,8,'whole-floor selection fills the eight-light budget');
  assert.equal(new Set(selected.map(item=>item.roomId)).size,8,'the first round represents eight distinct rooms when eight are available');
}

{
  const candidates=Array.from({length:24},(_,index)=>light(`Practical ${index+1}`,{priority:100-index,index}));
  const selected=selectRoomLights(candidates,{roomId:'room-1',floorId:'ground',maxLights:999,selectionMode:V13_LIGHTING_SELECTION_MODE});
  assert.equal(selected.length,MAX_ACTIVE_ROOM_LIGHTS,'V13 cannot exceed the integrated eight-light cap even when the caller requests more');
}

{
  const candidates=[
    ...Array.from({length:8},(_,index)=>light(`Practical ${index+1}`,{priority:100-index,index})),
    light('Required room fill',{role:'indirect-fill',priority:1,index:20,intensity:2}),
  ];
  const selected=selectRoomLights(candidates,{roomId:'room-1',floorId:'ground',maxLights:8,selectionMode:V13_LIGHTING_SELECTION_MODE});
  assert.equal(selected.length,8);
  assert.equal(selected.filter(item=>item.role==='indirect-fill').length,1,'single-room selection retains one indirect fill');
}

{
  const manifest=JSON.parse(readFileSync(new URL('../site/reconstruction/web-manifest-v12-r2-lounge-cmu-grilles.json',import.meta.url)));
  const model=JSON.parse(readFileSync(new URL('../site/data/model.json',import.meta.url)));
  const selected=selectRoomLights(normalizeManifestLights(manifest.lights,model.floors),{roomId:'bar-lounge',floorId:'ground',maxLights:8});
  assert.deepEqual(selected.map(item=>item.name),[
    'Practical downlight.036',
    'Practical downlight.037',
    'Practical downlight.038',
    'Practical downlight.039',
    'Bulkhead wall wash',
    'Bulkhead wall wash.001',
    'Bulkhead wall wash.002',
    'Lounge window daylight',
  ],'the baseline V12 manifest retains its established legacy selection');
}

{
  const source=readFileSync(new URL('../site/detailed-scene.js',import.meta.url),'utf8');
  const formula=source.match(/Match area-light power[\s\S]{0,180}?light\.intensity=([^;]+);/);
  assert.ok(formula,'integrated detailed-scene.js must declare the area-power-matched spot intensity');
  const descriptor={intensity:40,size:.14,sizeY:.18};
  const spotIntensity=Function('descriptor',`return (${formula[1]})`)(descriptor);
  const area=new RectAreaLight(0xffffff,descriptor.intensity,descriptor.size,descriptor.sizeY);
  const spot=new SpotLight(0xffffff,spotIntensity);
  assert.ok(Math.abs(area.power-spot.power)<1e-10,`integrated formula must preserve Three.js light power: area=${area.power}, spot=${spot.power}`);
}

console.log('room-lighting integrated source: 5 focused checks passed');

