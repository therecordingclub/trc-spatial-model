export function finite(value, fallback = 0) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function sourceToViewer(input) {
  const model=structuredClone(input);
  const flip=p=>[p[0],-p[1]];
  for(const room of model.rooms){
    room.polygon=room.polygon.map(flip);if(room.label)room.label=flip(room.label);
    if(room.physicalSurfacePolygons)room.physicalSurfacePolygons=room.physicalSurfacePolygons.map(surface=>({
      ...surface,exterior:surface.exterior.map(flip),holes:(surface.holes||[]).map(hole=>hole.map(flip)),
    }));
  }
  for(const wall of model.walls){wall.start=flip(wall.start);wall.end=flip(wall.end);}
  for(const floor of model.floors){if(floor.footprint)floor.footprint=floor.footprint.map(flip);}
  model.coordinateSystem={...model.coordinateSystem,zDirection:'south',sourceToViewer:'x=x, y=elevation, z=-source_z; matches Blender glTF Y-up export'};
  return model;
}

export function polygonArea(points) {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

export function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function roomSurfaces(room) {
  return room.physicalSurfacePolygons?.length ? room.physicalSurfacePolygons : [{exterior:room.polygon,holes:[]}];
}

export function roomArea(room) {
  return roomSurfaces(room).reduce((sum,surface)=>sum+polygonArea(surface.exterior)-(surface.holes||[]).reduce((total,hole)=>total+polygonArea(hole),0),0);
}

export function insideRoom(point,room) {
  return roomSurfaces(room).some(surface=>insidePolygon(point,surface.exterior)&&!(surface.holes||[]).some(hole=>insidePolygon(point,hole)));
}

export function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dz = end[1] - start[1];
  const square = dx * dx + dz * dz;
  const t = square ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / square)) : 0;
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz);
}

export function wallBlocks(point, wall, radius = .22) {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  if (length < .001) return false;
  const dx = (wall.end[0] - wall.start[0]) / length, dz = (wall.end[1] - wall.start[1]) / length;
  const along = (point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz;
  for (const opening of wall.openings || []) {
    if (finite(opening.sill) < .12 && finite(opening.height, 2.05) >= 1.75 &&
      along >= opening.offset + radius && along <= opening.offset + opening.width - radius) return false;
  }
  return distanceToSegment(point, wall.start, wall.end) < radius + finite(wall.thickness, .15) / 2;
}

export function formatLength(meters, units = 'imperial') {
  if (units === 'metric') return `${meters.toFixed(2)} m`;
  const total = Math.round(meters / .0254);
  return `${Math.floor(total / 12)}′ ${total % 12}″`;
}

export function validateScenario(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items) || input.items.length > 250) throw new Error('A layout must contain no more than 250 items.');
  const ids = new Set();
  const items = input.items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid equipment item.');
    const text = key => String(item[key] ?? '').slice(0, 120);
    const out = {id:text('id'), name:text('name'), type:text('type'), floorId:text('floorId'), roomId:text('roomId')};
    if (!out.id || ids.has(out.id) || !out.floorId || !out.name) throw new Error('Each item needs a unique ID, floor and name.');
    ids.add(out.id);
    for (const key of ['x','z','rotation','width','depth','height']) {
      if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) throw new Error(`Invalid ${key}.`);
      if (['width','depth','height'].includes(key) && (item[key] < .03 || item[key] > 50)) throw new Error('Equipment dimensions must be between 0.03 and 50 meters.');
      if (Math.abs(item[key]) > 10000) throw new Error('Equipment position is outside the supported range.');
      out[key] = item[key];
    }
    out.dimensionStatus = item.dimensionStatus === 'user-measured' ? 'user-measured' : 'estimated';
    return out;
  });
  return {version:1, modelRevision:String(input.modelRevision || '').slice(0, 100), items};
}
