export function isMovementField(target) {
  return Boolean(target?.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"]'));
}

export function createSmoothMotion({acceleration=18,braking=26,maxDelta=.05}={}) {
  let vx=0,vy=0;
  return {
    get velocity(){return {x:vx,y:vy};},
    reset(){vx=0;vy=0;},
    step(targetX,targetY,seconds){
      if(![targetX,targetY,seconds].every(Number.isFinite)){
        vx=0;vy=0;return {dx:0,dy:0,vx,vy};
      }
      const dt=Math.min(maxDelta,Math.max(0,seconds));
      const rate=Math.hypot(targetX,targetY)<Math.hypot(vx,vy)?braking:acceleration;
      const decay=Math.exp(-rate*dt),integral=(1-decay)/rate;
      const dx=targetX*dt+(vx-targetX)*integral;
      const dy=targetY*dt+(vy-targetY)*integral;
      vx=targetX+(vx-targetX)*decay;vy=targetY+(vy-targetY)*decay;
      if(targetX===0&&targetY===0&&Math.hypot(vx,vy)<.0001){vx=0;vy=0;}
      return {dx,dy,vx,vy};
    },
  };
}
