import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {WALK_THROUGH_WALLS, wallBlocks, insidePolygon} from '../site/geometry.mjs';

const footprint=[[0,0],[8,0],[8,6],[0,6]];
const wall={floorId:'ground',start:[4,0],end:[4,6],thickness:.2,openings:[]};

// Mirrors the plan-based branch of app.js canWalk(x,z).
const canWalk=(x,z)=>insidePolygon([x,z],footprint)&&(WALK_THROUGH_WALLS||![wall].some(w=>wallBlocks([x,z],w)));

test('a step into a wall run succeeds while the wall data still reports a solid',()=>{
  assert.equal(WALK_THROUGH_WALLS,true,'walking is not blocked horizontally');
  assert.equal(wallBlocks([4,3],wall),true,'the wall collider itself is unchanged');
  assert.equal(canWalk(4,3),true,'a step into the wall run is permitted');
  assert.equal(canWalk(5,3),true,'the far side of the wall is reachable');
  assert.equal(canWalk(9,3),false,'the floor footprint still bounds movement');
});

test('the detailed walking path gates only the obstacle rejection',()=>{
  const source=readFileSync(new URL('../site/navigation.js',import.meta.url),'utf8');
  assert.match(source,/const obstacle = WALK_THROUGH_WALLS \? null : collisionWithCapsule\(/,'the obstacle check is gated on the switch');
  assert.match(source,/reason: 'no-support'/,'support is still required to stand');
  assert.match(source,/reason: 'step-too-high'/,'step limits are still enforced');
  assert.match(source,/reason: 'drop-too-far'/,'drop limits are still enforced');
  assert.match(source,/function supportFromGeometry\(/,'support-from-geometry is untouched');
});
