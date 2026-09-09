import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSmoothMotion} from '../site/keyboard-motion.mjs';

function travel(fps,x=1.75,y=0){
  const motion=createSmoothMotion();let dx=0,dy=0;
  for(let i=0;i<fps*2;i++){const step=motion.step(x,y,1/fps);dx+=step.dx;dy+=step.dy;}
  return {distance:Math.hypot(dx,dy),motion};
}

test('distance is independent of 30, 60, and 120 Hz rendering',()=>{
  const distances=[30,60,120].map(fps=>travel(fps).distance);
  for(const d of distances)assert(Math.abs(d-distances[0])<1e-10);
});

test('normalized diagonal movement has the same speed',()=>{
  assert(Math.abs(travel(60).distance-travel(60,1.75/Math.SQRT2,1.75/Math.SQRT2).distance)<1e-10);
});

test('starting ramps up and releasing stops within a short bounded distance',()=>{
  const motion=createSmoothMotion();
  const first=motion.step(1.75,0,1/60);
  assert(first.vx>0&&first.vx<1.75*.3);
  for(let i=0;i<60;i++)motion.step(1.75,0,1/60);
  let distance=0,prior=motion.velocity.x;
  for(let i=0;i<30;i++){
    const step=motion.step(0,0,1/60);distance+=step.dx;
    assert(step.vx>=0&&step.vx<=prior);prior=step.vx;
  }
  assert(distance<.075);
  assert.equal(motion.velocity.x,0);
});

test('direction reversals are continuous and never exceed requested speed',()=>{
  const {motion}=travel(60);
  const first=motion.step(-1.75,0,1/60);
  assert(first.vx>0);
  for(let i=0;i<30;i++)assert(Math.abs(motion.step(-1.75,0,1/60).vx)<=1.75);
  assert(motion.velocity.x< -1.7);
});

test('reset and invalid or delayed frames cannot retain motion or teleport',()=>{
  const {motion}=travel(60);
  assert(motion.step(1.75,0,10).dx<=1.75*.05+1e-12);
  motion.reset();assert.deepEqual(motion.step(0,0,1/60),{dx:0,dy:0,vx:0,vy:0});
  motion.step(1.75,0,1/60);
  assert.deepEqual(motion.step(NaN,0,1/60),{dx:0,dy:0,vx:0,vy:0});
});
