export const MAX_ACTIVE_ROOM_LIGHTS = 8;
export const MAX_PRESENTATION_INTENSITY = 40;
export const MAX_FALLBACK_ROOMS = 8;

const EXTERIOR_ROOM = /exterior|outdoor|patio|sauna/i;

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bounded(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validPoint(point) {
  return Array.isArray(point) && point.length === 3 && point.every(value => typeof value === 'number' && Number.isFinite(value));
}

export function floorElevation(floor) {
  if (typeof floor?.elevation === 'number' && Number.isFinite(floor.elevation)) return floor.elevation;
  return finite(floor?.modelElevation, 0);
}

export function blenderPointToViewer(point, elevation = 0) {
  if (!validPoint(point)) return null;
  return [point[0], point[2] + finite(elevation, 0), -point[1]];
}

export function cameraVerticalFov(lensMillimeters, aspect) {
  const lens = bounded(finite(lensMillimeters, 23), 14, 100);
  const ratio = Math.max(.2, finite(aspect, 1));
  return bounded(2 * Math.atan(18 / lens / ratio) * 180 / Math.PI, 30, 85);
}

export function presentationIntensity({ energy, size, role } = {}) {
  const watts = Math.max(0, finite(energy, 0));
  const emitterSize = bounded(finite(size, 1), 0.08, 10);
  const emitterArea = Math.max(0.04, emitterSize * emitterSize);
  // Blender watts and browser luminance are not physically interchangeable.
  // This power-per-area mapping is an explicit presentation approximation.
  const scale = role === 'indirect-fill' ? 0.025 : 0.08;
  return bounded(watts * scale / emitterArea, 0, MAX_PRESENTATION_INTENSITY);
}

function linearColor(color, fallback = [1, 0.82, 0.64]) {
  if (!validPoint(color)) return fallback.slice();
  return color.map(value => bounded(value, 0, 1));
}

export function normalizeManifestLights(entries, floors) {
  if (!Array.isArray(entries)) return [];
  const floorMap = new Map((floors ?? []).map(floor => [floor.id, floor]));
  const normalized = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || entry.type !== 'AREA' || !entry.roomId || !entry.floorId) continue;
    const floor = floorMap.get(entry.floorId);
    if (!floor) continue;
    const elevation = floorElevation(floor);
    const position = blenderPointToViewer(entry.position, elevation);
    const target = blenderPointToViewer(entry.target, elevation);
    if (!position || !target) continue;
    const role = entry.role === 'indirect-fill' ? 'indirect-fill' : 'practical';
    const size = bounded(finite(entry.size, 1), 0.08, 10);
    normalized.push({
      name: String(entry.name || `Area light ${index + 1}`),
      roomId: entry.roomId,
      floorId: entry.floorId,
      role,
      position,
      target,
      color: linearColor(entry.color),
      size,
      sourceEnergy: Math.max(0, finite(entry.energy, 0)),
      intensity: presentationIntensity({ energy: entry.energy, size, role }),
      approximate: true,
    });
  }
  return normalized;
}

function priority(light) {
  return light.role === 'practical' ? 0 : 1;
}

export function selectRoomLights(lights, { roomId, floorId, maxLights = MAX_ACTIVE_ROOM_LIGHTS } = {}) {
  const limit = Math.max(0, Math.floor(finite(maxLights, MAX_ACTIVE_ROOM_LIGHTS)));
  const candidates = (lights ?? [])
    .filter(light => light.floorId === floorId && (!roomId || light.roomId === roomId))
    .slice()
    .sort((a, b) => priority(a) - priority(b) || b.intensity - a.intensity || a.name.localeCompare(b.name));
  const selected = candidates.slice(0, limit);
  const bestFill = candidates.find(light => light.role === 'indirect-fill');
  if (limit > 1 && bestFill && !selected.includes(bestFill)) selected[selected.length - 1] = bestFill;
  return selected;
}

export function fallbackLightForRoom(room, floor) {
  if (!room) return null;
  const elevation = floorElevation(floor);
  const label = Array.isArray(room.label) && room.label.length >= 2 ? room.label : [0, 0];
  const exterior = EXTERIOR_ROOM.test(`${room.id ?? ''} ${room.name ?? ''}`);
  const source = exterior
    ? { energy: 160, size: 5, role: 'indirect-fill', color: [0.78, 0.88, 1] }
    : { energy: 90, size: 0.8, role: 'practical', color: [1, 0.82, 0.64] };
  return {
    name: `Fallback ${exterior ? 'sky fill' : 'room practical'} ${room.id}`,
    roomId: room.id,
    floorId: room.floorId,
    role: source.role,
    position: [finite(label[0]), elevation + (exterior ? 4.8 : 2.35), finite(label[1])],
    target: [finite(label[0]), elevation + 0.8, finite(label[1])],
    color: source.color,
    size: source.size,
    sourceEnergy: source.energy,
    intensity: presentationIntensity(source),
    approximate: true,
    fallback: true,
  };
}

export function lightsForView(lights, rooms, floors, { roomId, floorId, maxLights = MAX_ACTIVE_ROOM_LIGHTS } = {}) {
  const selected = selectRoomLights(lights, { roomId, floorId, maxLights });
  if (selected.length) return selected;
  const floorMap = new Map((floors ?? []).map(floor => [floor.id, floor]));
  const candidates = (rooms ?? []).filter(room => room.floorId === floorId && (!roomId || room.id === roomId));
  return candidates
    .slice(0, Math.min(maxLights, MAX_FALLBACK_ROOMS))
    .map(room => fallbackLightForRoom(room, floorMap.get(room.floorId)))
    .filter(Boolean);
}
