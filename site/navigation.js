import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Public contract: every accepted and returned position is an EYE position.
// Scene meshes are snapshotted into immutable world-space geometry once. The
// source meshes, their transforms, and their geometry are never modified.

const worldGeometryCache = new WeakMap();
const EPSILON = 1e-6;
const FLOOR_ROLE = /(^|\s|-)floor($|\s|-)|ground|walkable/i;
const NON_COLLIDING_ROLE = /ceiling|ceiling-fixture|cable|ornament|decoration|light-fixture/i;
const STAGE_PROVENANCE = /(?:raised[ _-]?stage|stage[ _-]?(?:carpet|platform|floor|deck)|live_stage_carpet)/i;
const FLOOR_COVERING_PROVENANCE = /(?:^|[\s_-])(?:carpet|rug|floor[ _-]?mat)(?:$|[\s_-])/i;

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function floorElevation(floor) {
  if (typeof floor?.elevation === 'number' && Number.isFinite(floor.elevation)) return floor.elevation;
  if (typeof floor?.modelElevation === 'number' && Number.isFinite(floor.modelElevation)) return floor.modelElevation;
  return /mezz/i.test(`${floor?.id ?? ''} ${floor?.name ?? ''}`) ? 0.15 : 0;
}

function inside([x, z], polygon) {
  if (!polygon?.length) return true;
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

function floorCandidates(floors, floorId, x, z) {
  return floors.filter(floor => {
    const id = floor.floorId ?? floor.id;
    return id === floorId && inside([x, z], floor.footprint);
  });
}

function inheritedData(object) {
  const chain = [];
  for (let node = object; node; node = node.parent) chain.push(node);
  const data = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(data, chain[i].userData);
  return data;
}

function matrixSnapshot(object) {
  const chain = [];
  for (let node = object; node; node = node.parent) chain.push(node);
  const world = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    if (node.matrixAutoUpdate === false) local.copy(node.matrix);
    else local.compose(node.position, node.quaternion, node.scale);
    world.multiply(local);
  }
  return world;
}

function matrixKey(matrix, geometry) {
  return `${geometry.uuid}:${matrix.elements.map(value => Math.round(value * 1e10) / 1e10).join(',')}`;
}

function worldGeometryFor(mesh, bvhOptions, needsBvh = true) {
  const matrix = matrixSnapshot(mesh);
  const key = matrixKey(matrix, mesh.geometry);
  const cached = worldGeometryCache.get(mesh);
  if (cached?.key === key) {
    if (needsBvh && !cached.bvh) cached.bvh = new MeshBVH(cached.geometry, { lazyGeneration: false, ...bvhOptions });
    return cached;
  }
  const geometry = mesh.geometry.clone().applyMatrix4(matrix);
  geometry.computeBoundingBox();
  const record = {
    key,
    geometry,
    bounds: geometry.boundingBox.clone(),
    bvh: needsBvh ? new MeshBVH(geometry, { lazyGeneration: false, ...bvhOptions }) : null,
  };
  worldGeometryCache.set(mesh, record);
  return record;
}

function triangleYAtXZ(triangle, x, z) {
  const ax = triangle.a.x;
  const az = triangle.a.z;
  const bx = triangle.b.x;
  const bz = triangle.b.z;
  const cx = triangle.c.x;
  const cz = triangle.c.z;
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(denominator) < EPSILON) return null;
  const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
  const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
  const c = 1 - a - b;
  if (a < -EPSILON || b < -EPSILON || c < -EPSILON) return null;
  return a * triangle.a.y + b * triangle.b.y + c * triangle.c.y;
}

function provenanceText(mesh, data) {
  return [
    mesh.name,
    data.name,
    data.kind,
    data.structuralRole,
    data.supportSurface,
    data['webExport.sourceObject'],
    data['webExport.sourceNamesJson'],
  ].filter(Boolean).join(' ');
}

function colliderFor(mesh, options) {
  const data = inheritedData(mesh);
  const role = `${data.kind ?? ''} ${data.structuralRole ?? ''}`;
  const provenance = provenanceText(mesh, data);
  const floorSurface = FLOOR_ROLE.test(role);
  const explicitSupport = data.walkable === true || data.walkableSurface === true || data.navigationSupport === true;
  const stageSurface = STAGE_PROVENANCE.test(provenance);
  const floorCovering = FLOOR_COVERING_PROVENANCE.test(provenance);
  const supports = floorSurface || explicitSupport || stageSurface || floorCovering;
  const collisionCandidate = data.solid !== false && data.collision !== false && !NON_COLLIDING_ROLE.test(role);
  const world = worldGeometryFor(mesh, options.bvhOptions, collisionCandidate || supports);
  const surfaceThickness = world.bounds.max.y - world.bounds.min.y;
  // The floor descriptor supplies the footprint boundary. Very thin finish
  // geometry should support the capsule without turning every floorboard or
  // rug edge into a wall. Substantial floor-tagged decks, steps, and slabs stay
  // solid so their sides and height remain part of navigation.
  const supportOnlyFinish = !stageSurface
    && (floorSurface || floorCovering)
    && surfaceThickness <= options.maximumFloorFinishThickness + EPSILON;
  const collides = collisionCandidate && !supportOnlyFinish;
  return {
    mesh,
    data,
    role,
    floorId: data.floorId,
    geometry: world.geometry,
    bvh: world.bvh,
    bounds: world.bounds,
    surfaceThickness,
    collides,
    supports,
    supportMinTriangleArea: stageSurface && !floorSurface && !explicitSupport && finite(data['webExport.mergedSourceCount'], 1) > 1
      ? options.inferredStageTriangleArea
      : 0,
  };
}

function supportFromGeometry(collider, x, z, minimumSlopeY) {
  if (!collider.supports || x < collider.bounds.min.x - EPSILON || x > collider.bounds.max.x + EPSILON || z < collider.bounds.min.z - EPSILON || z > collider.bounds.max.z + EPSILON) return null;
  let best = null;
  const normal = new THREE.Vector3();
  collider.bvh.shapecast({
    intersectsBounds: box => x >= box.min.x - EPSILON && x <= box.max.x + EPSILON && z >= box.min.z - EPSILON && z <= box.max.z + EPSILON,
    intersectsTriangle: triangle => {
      triangle.getNormal(normal);
      // Only upward-facing triangles can support feet. Using abs(normal.y)
      // makes the underside of a floor-tagged ceiling or shelf outrank the
      // actual floor and report a false giant step.
      if (normal.y < minimumSlopeY || triangle.getArea() + EPSILON < collider.supportMinTriangleArea) return false;
      const y = triangleYAtXZ(triangle, x, z);
      if (y !== null && (best === null || y > best)) best = y;
      return false;
    },
  });
  return best;
}

function collisionWithCapsule(colliders, x, footY, z, floorId, options = {}) {
  const { radius, height, collisionSkin } = options.defaults;
  const bottom = footY + radius;
  const top = Math.max(bottom, footY + height - radius);
  const segment = new THREE.Line3(new THREE.Vector3(x, bottom, z), new THREE.Vector3(x, top, z));
  const capsuleBounds = new THREE.Box3(
    new THREE.Vector3(x - radius, footY, z - radius),
    new THREE.Vector3(x + radius, footY + height, z + radius),
  );
  const trianglePoint = new THREE.Vector3();
  const segmentPoint = new THREE.Vector3();
  const threshold = Math.max(0, radius - collisionSkin);
  const midpoint=segment.getCenter(new THREE.Vector3());
  for (const collider of colliders) {
    if (!collider.collides || (collider.floorId && collider.floorId !== floorId) || !collider.bounds.intersectsBox(capsuleBounds)) continue;
    let hit = false;
    collider.bvh.shapecast({
      intersectsBounds: box => box.intersectsBox(capsuleBounds),
      intersectsTriangle: triangle => {
        if (collider.supports) {
          const ceiling = Math.max(options.referenceFootY, footY) + options.stepHeight + collisionSkin;
          if (Math.max(triangle.a.y, triangle.b.y, triangle.c.y) <= ceiling) return false;
        }
        hit = triangle.closestPointToSegment(segment, trianglePoint, segmentPoint) < threshold;
        return hit;
      },
    });
    if (hit) return collider;
    // A capsule wholly inside a closed solid touches none of its triangles.
    // Six outward-facing first exits distinguish containment from open planes
    // and empty gaps inside meshes merged for rendering.
    if(collider.bounds.containsPoint(midpoint)){
      const contained=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].every(axis=>{
        const direction=new THREE.Vector3(...axis);
        const first=collider.bvh.raycastFirst(new THREE.Ray(midpoint,direction),THREE.DoubleSide,EPSILON);
        return first?.face?.normal?.dot(direction)>EPSILON;
      });
      if(contained)return collider;
    }
  }
  return null;
}

export function createNavigation(meshes, floors, supplied = {}) {
  const defaults = {
    radius: finite(supplied.radius, 0.28),
    height: finite(supplied.height, 1.65),
    eyeHeight: finite(supplied.eyeHeight, 1.58),
    stepHeight: finite(supplied.stepHeight, 0.40),
    dropHeight: finite(supplied.dropHeight, 0.45),
    collisionSkin: finite(supplied.collisionSkin, 0.002),
    maximumSlopeDegrees: finite(supplied.maximumSlopeDegrees, 38),
    sweepStep: finite(supplied.sweepStep, finite(supplied.radius, 0.28) / 2),
  };
  if (!(defaults.radius > 0) || !(defaults.height >= defaults.radius * 2) || !(defaults.eyeHeight > 0)) throw new Error('Invalid navigation capsule dimensions.');
  defaults.sweepStep = Math.min(defaults.sweepStep, defaults.radius / 2);
  const buildStarted = performance.now();
  const buildOptions = {
    bvhOptions: supplied.bvhOptions,
    inferredStageTriangleArea: finite(supplied.inferredStageTriangleArea, 0.35),
    maximumFloorFinishThickness: finite(supplied.maximumFloorFinishThickness, 0.06),
  };
  const colliders = meshes.filter(mesh => mesh?.isMesh && mesh.geometry?.attributes?.position).map(mesh => colliderFor(mesh, buildOptions));
  const minimumSlopeY = Math.cos(THREE.MathUtils.degToRad(defaults.maximumSlopeDegrees));

  function allSupports(x, z, floorId) {
    const descriptors = floorCandidates(floors, floorId, x, z);
    if (!descriptors.length) return { descriptors, supports: [] };
    const supports = descriptors.map(floor => ({ y: floorElevation(floor), floor, mesh: null, source: 'floor' }));
    const baseFloor = descriptors.slice().sort((a, b) => floorElevation(b) - floorElevation(a))[0];
    for (const collider of colliders) {
      if (collider.floorId && collider.floorId !== floorId) continue;
      const y = supportFromGeometry(collider, x, z, minimumSlopeY);
      if (y !== null) supports.push({ y, floor: baseFloor, mesh: collider.mesh, source: 'geometry' });
    }
    supports.sort((a, b) => b.y - a.y);
    return { descriptors, supports };
  }

  function resolvePosition(eyePosition, options = {}, movement = null) {
    const floorId = options.floorId;
    const eyeHeight = finite(options.eyeHeight, defaults.eyeHeight);
    const x = eyePosition.x;
    const z = eyePosition.z;
    const available = allSupports(x, z, floorId);
    if (!available.descriptors.length) return { ok: false, reason: 'outside-floor', floorId };
    if (!available.supports.length) return { ok: false, reason: 'no-support', floor: available.descriptors[0], floorId };
    const referenceFootY = finite(movement?.referenceFootY, finite(options.referenceFootY, eyePosition.y - eyeHeight));
    const stepHeight = finite(options.stepHeight, defaults.stepHeight);
    const dropHeight = finite(options.dropHeight, defaults.dropHeight);
    const support = available.supports[0];
    if (support.y > referenceFootY + stepHeight + EPSILON) return { ok: false, reason: 'step-too-high', floor: support.floor, supportY: support.y, floorId };
    if (support.y < referenceFootY - dropHeight - EPSILON) return { ok: false, reason: 'drop-too-far', floor: support.floor, supportY: support.y, floorId };
    const obstacle = collisionWithCapsule(colliders, x, support.y, z, floorId, {
      defaults,
      referenceFootY,
      stepHeight,
    });
    if (obstacle) return { ok: false, reason: 'collision', collider: obstacle.mesh, floor: support.floor, supportY: support.y, floorId };
    const position = new THREE.Vector3(x, support.y + eyeHeight, z);
    return {
      ok: true,
      position,
      eyeY: position.y,
      footY: support.y,
      floor: support.floor,
      floorId,
      supportMesh: support.mesh,
      supportSource: support.source,
    };
  }

  function testPosition(eyePosition, options = {}) {
    return resolvePosition(eyePosition, options);
  }

  function tryMove(fromEye, delta, options = {}) {
    const start = resolvePosition(fromEye, options);
    if (!start.ok) return { ...start, reason: `invalid-start:${start.reason}` };
    const dx = finite(delta?.x, 0);
    const dz = finite(delta?.z, 0);
    const distance = Math.hypot(dx, dz);
    if (distance <= EPSILON) return start;
    const steps = Math.max(1, Math.ceil(distance / defaults.sweepStep));
    let current = start;
    for (let index = 1; index <= steps; index++) {
      const candidate = new THREE.Vector3(fromEye.x + dx * index / steps, current.eyeY, fromEye.z + dz * index / steps);
      const next = resolvePosition(candidate, options, { referenceFootY: current.footY });
      if (!next.ok) return { ...next, position: current.position.clone(), travelled: (index - 1) / steps, sweepSteps: steps };
      current = next;
    }
    return { ...current, travelled: 1, sweepSteps: steps };
  }

  function findClearPosition(eyePosition, options = {}) {
    const permitted=position=>inside([position.x,position.z],options.roomPolygon);
    const direct = permitted(eyePosition)?testPosition(eyePosition, options):{ok:false,reason:'outside-room'};
    if (direct.ok) return direct;
    const searchRadius = finite(options.searchRadius, 2);
    const ringStep = Math.max(.02,Math.min(finite(options.searchStep, defaults.radius), defaults.radius));
    const samples = Math.max(8, Math.floor(finite(options.samplesPerRing, 16)));
    for (let radius = ringStep; radius <= searchRadius + EPSILON; radius += ringStep) {
      const count = Math.max(samples, Math.ceil(2 * Math.PI * radius / ringStep));
      for (let index = 0; index < count; index++) {
        const angle = index / count * Math.PI * 2;
        const probe = new THREE.Vector3(eyePosition.x + Math.cos(angle) * radius, eyePosition.y, eyePosition.z + Math.sin(angle) * radius);
        if(!permitted(probe))continue;
        const result = testPosition(probe, options);
        if (result.ok) return { ...result, adjusted: true, originalReason: direct.reason, offset: probe.clone().sub(eyePosition) };
      }
    }
    return { ...direct, reason: 'no-clear-position' };
  }

  const stats = {
    meshes: colliders.length,
    colliders: colliders.filter(collider => collider.collides).length,
    supportMeshes: colliders.filter(collider => collider.supports).length,
    triangles: colliders.reduce((total, collider) => total + (collider.geometry.index?.count ?? collider.geometry.attributes.position.count) / 3, 0),
    bvhMeshes: colliders.filter(collider => collider.bvh).length,
    bvhTriangles: colliders.reduce((total, collider) => total + (collider.bvh ? (collider.geometry.index?.count ?? collider.geometry.attributes.position.count) / 3 : 0), 0),
    skippedBvhMeshes: colliders.filter(collider => !collider.bvh).length,
    buildMs: performance.now() - buildStarted,
  };
  return { testPosition, tryMove, findClearPosition, colliders, defaults, stats };
}
