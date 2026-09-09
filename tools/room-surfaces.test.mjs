import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {sourceToViewer,roomSurfaces,roomArea,insideRoom,insidePolygon,footprintInsideRoom} from '../site/geometry.mjs';

const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];

test('a room excludes its interior courtyard from membership and area',()=>{
  const room={polygon:ring(0,0,5,4),physicalSurfacePolygons:[{exterior:ring(0,0,5,4),holes:[ring(1,1,2,2)]}]};
  assert.equal(roomArea(room),16);
  assert(insideRoom([.5,2],room));
  assert(!insideRoom([2,2],room));
  assert(!insideRoom([6,2],room));
});

test('disconnected floor pieces are kept without filling the space between',()=>{
  const room={polygon:ring(0,0,5,2),physicalSurfacePolygons:[{exterior:ring(0,0,1,2),holes:[]},{exterior:ring(4,0,1,2),holes:[]}]};
  assert.equal(roomArea(room),4);
  assert(insideRoom([.5,1],room));assert(insideRoom([4.5,1],room));
  assert(!insideRoom([2.5,1],room));assert.equal(roomSurfaces(room).length,2);
});

test('source conversion flips every physical ring once and preserves source data',()=>{
  const source={rooms:[{polygon:ring(10,20,5,4),label:[10.5,21],physicalSurfacePolygons:[{exterior:ring(10,20,5,4),holes:[ring(11,21,2,2)]}]}],walls:[],floors:[]};
  const before=structuredClone(source),viewer=sourceToViewer(source);
  assert.deepEqual(source,before);assert.deepEqual(viewer.rooms[0].label,[10.5,-21]);
  assert.deepEqual(viewer.rooms[0].physicalSurfacePolygons[0].holes[0][0],[11,-21]);
  assert.equal(roomArea(viewer.rooms[0]),16);
  assert(insideRoom([10.5,-22],viewer.rooms[0]));assert(!insideRoom([12,-22],viewer.rooms[0]));
});

test('historical rooms retain their original polygon behavior',()=>{
  const room={polygon:[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]]};
  assert.equal(roomArea(room),7);
  for(let x=-.25;x<4.5;x+=.5)for(let y=-.25;y<4.5;y+=.5)assert.equal(insideRoom([x,y],room),insidePolygon([x,y],room.polygon));
});

test('a furniture footprint cannot enclose a hole despite four valid corners',()=>{
  const room={polygon:ring(0,0,6,6),physicalSurfacePolygons:[{exterior:ring(0,0,6,6),holes:[ring(2,2,2,2)]}]};
  const enclosing=ring(1,1,4,4);
  assert(enclosing.every(point=>insideRoom(point,room)));
  assert(!footprintInsideRoom(enclosing,room));
  assert(footprintInsideRoom(ring(.25,.25,1,1),room));
});

test('a footprint cannot bridge a concave notch or disconnected floor pieces',()=>{
  const room={polygon:[[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]]};
  const bridge=ring(1,1,4,4);assert(bridge.every(point=>insideRoom(point,room)));
  assert(!footprintInsideRoom(bridge,room));
  assert(footprintInsideRoom([[.2,.5],[.5,.2],[1.7,1.4],[1.4,1.7]],room));
  assert(!footprintInsideRoom(ring(.25,.25,4.5,1),{polygon:ring(0,0,5,2),physicalSurfacePolygons:[{exterior:ring(0,0,1,2)},{exterior:ring(4,0,1,2)}]}));
});

test('published physical room areas agree with the reviewed floor records',async()=>{
  const source=JSON.parse(await readFile(process.env.TRC_ROOM_MODEL||new URL('../site/data/model.json',import.meta.url),'utf8'));
  const model=sourceToViewer(source),qualified=model.rooms.filter(room=>room.physicalSurfacePolygons?.length);
  if(source.metadata?.buildingCorrection?.version==='v15-building')assert.equal(qualified.length,4);
  for(const room of qualified)assert(Math.abs(roomArea(room)-room.physicalSurfaceAreaMeters2)<.000001,room.id);
  const find=id=>model.rooms.find(room=>room.id===id);
  if(qualified.length){
    for(const id of ['electrical-room','studio-a-iso']){
      const room=find(id);if(room?.label&&insideRoom(room.label,room))assert(!insideRoom(room.label,find('studio-a-live')),id);
    }
    const bathroom=find('bathrooms');assert(!insideRoom(bathroom.label,find('main-circulation')));
    assert(!insideRoom(find('kitchen').label,find('main-circulation')));
    const spanningBathroom=[[21.1,-.205],[26.95,-.205],[26.95,-2.42],[21.1,-2.42]];
    assert(spanningBathroom.every(point=>insideRoom(point,find('main-circulation'))));
    assert(!footprintInsideRoom(spanningBathroom,find('main-circulation')));
  }
});
