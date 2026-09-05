import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export const MAX_ACTIVE_REFLECTIONS = 2;
export const REFLECTION_TEXTURE_SIZE = 1024;
export const MAX_ACTIVE_REFLECTION_PIXELS =
  MAX_ACTIVE_REFLECTIONS * REFLECTION_TEXTURE_SIZE * REFLECTION_TEXTURE_SIZE;

const FORWARD_OFFSET_METERS = 0.0005;
const PLANE_DISTANCE_TOLERANCE_METERS = 0.0001;
const NORMAL_ALIGNMENT_TOLERANCE = 1e-8;
const DEFAULT_NORMAL = new THREE.Vector3(0, 0, 1);
const VALID_SHAPES = new Set(['rectangle', 'arch', 'ellipse']);

function cleanZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid mirror ${label}.`);
  return number;
}

function floorElevation(model, floorId) {
  const floor = model?.floors?.find(candidate => candidate.id === floorId);
  return finiteNumber(floor?.elevation ?? floor?.modelElevation ?? 0, 'floor elevation');
}

function validateVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Mirror ${label} must contain three coordinates.`);
  }
  return value.map((component, index) => finiteNumber(component, `${label}[${index}]`));
}

/** Convert a Blender descriptor once: [x, planY, localZ] -> [x, vertical, -planY]. */
export function convertReflectionPlane(descriptor, elevation = 0) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('Mirror reflectionPlane metadata is required.');
  }
  const [x, planY, localZ] = validateVector(descriptor.position, 'position');
  const [normalX, normalPlanY, normalVertical] = validateVector(
    descriptor.normal,
    'normal',
  );
  const normal = new THREE.Vector3(
    cleanZero(normalX),
    cleanZero(normalVertical),
    cleanZero(-normalPlanY),
  );
  if (normal.lengthSq() < 1e-12) throw new Error('Mirror normal must not be zero.');
  normal.normalize();
  return {
    position: new THREE.Vector3(
      cleanZero(x),
      cleanZero(finiteNumber(elevation, 'floor elevation') + localZ),
      cleanZero(-planY),
    ),
    normal,
  };
}

/** Build a plane in local XY with its reflective front normal on local +Z. */
export function createMirrorGeometry(shape, width, height) {
  const mirrorWidth = finiteNumber(width, 'width');
  const mirrorHeight = finiteNumber(height, 'height');
  if (mirrorWidth <= 0 || mirrorHeight <= 0) {
    throw new Error('Mirror width and height must be positive.');
  }
  if (!VALID_SHAPES.has(shape)) throw new Error(`Unsupported mirror shape: ${shape}.`);
  if (shape === 'rectangle') return new THREE.PlaneGeometry(mirrorWidth, mirrorHeight);
  if (shape === 'ellipse') {
    const outline = new THREE.Shape();
    outline.absellipse(0, 0, mirrorWidth / 2, mirrorHeight / 2, 0, Math.PI * 2, false, 0);
    return new THREE.ShapeGeometry(outline, 32);
  }

  const radius = Math.min(mirrorWidth / 2, mirrorHeight);
  const bottom = -mirrorHeight / 2;
  const top = mirrorHeight / 2;
  const spring = top - radius;
  const outline = new THREE.Shape();
  outline.moveTo(-mirrorWidth / 2, bottom);
  outline.lineTo(mirrorWidth / 2, bottom);
  outline.lineTo(mirrorWidth / 2, spring);
  outline.absarc(0, spring, radius, 0, Math.PI, false);
  outline.lineTo(-mirrorWidth / 2, bottom);
  outline.closePath();
  return new THREE.ShapeGeometry(outline, 24);
}

function sameReflectionPlane(group, candidate) {
  return group.floorId === candidate.floorId
    && group.normal.dot(candidate.normal) >= 1 - NORMAL_ALIGNMENT_TOLERANCE
    && Math.abs(group.planeDistance - candidate.planeDistance)
      <= PLANE_DISTANCE_TOLERANCE_METERS;
}

function groupReflectionDescriptors(entries) {
  const groups = [];
  for (const entry of entries) {
    const planeDistance = entry.normal.dot(entry.position);
    const group = groups.find(candidate => sameReflectionPlane(candidate, {
      ...entry,
      planeDistance,
    }));
    if (group) {
      group.entries.push(entry);
      continue;
    }
    groups.push({
      floorId: entry.floorId,
      normal: entry.normal.clone(),
      planeDistance,
      entries: [entry],
    });
  }
  return groups;
}

function combinedMirrorGeometry(group, anchor, quaternion) {
  const inverse = quaternion.clone().invert();
  const pieces = group.entries.map(entry => {
    const localOffset = entry.position.clone().sub(anchor).applyQuaternion(inverse);
    if (Math.abs(localOffset.z) > PLANE_DISTANCE_TOLERANCE_METERS * 2) {
      throw new Error('Grouped mirror escaped its shared reflection plane.');
    }
    const geometry = createMirrorGeometry(
      entry.descriptor.shape,
      entry.descriptor.width,
      entry.descriptor.height,
    );
    geometry.translate(localOffset.x, localOffset.y, 0);
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    if (nonIndexed !== geometry) geometry.dispose();
    return nonIndexed;
  });
  const merged = mergeGeometries(pieces, false);
  pieces.forEach(piece => piece.dispose());
  if (!merged) throw new Error('Could not merge coplanar mirror geometry.');
  return merged;
}

/**
 * Three's Reflector restores common renderer state only on a successful nested
 * render and hides only itself. This guard also hides peer reflectors and
 * restores the bound renderer when the nested render throws.
 */
export function withReflectionRenderState(renderer, reflectors, active, render) {
  const visibility = reflectors.map(reflector => reflector.visible);
  const renderTarget = renderer.getRenderTarget?.() ?? null;
  const activeCubeFace = renderer.getActiveCubeFace?.() ?? 0;
  const activeMipmapLevel = renderer.getActiveMipmapLevel?.() ?? 0;
  const viewport = renderer.getViewport
    ? renderer.getViewport(new THREE.Vector4()).clone()
    : null;
  const xrEnabled = renderer.xr?.enabled;
  const shadowAutoUpdate = renderer.shadowMap?.autoUpdate;

  for (const reflector of reflectors) {
    if (reflector !== active) reflector.visible = false;
  }
  try {
    return render();
  } finally {
    reflectors.forEach((reflector, index) => {
      reflector.visible = visibility[index];
    });
    if (renderer.xr && xrEnabled !== undefined) renderer.xr.enabled = xrEnabled;
    if (renderer.shadowMap && shadowAutoUpdate !== undefined) {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
    }
    renderer.setRenderTarget?.(renderTarget, activeCubeFace, activeMipmapLevel);
    if (viewport && renderer.setViewport) renderer.setViewport(viewport);
  }
}

function cameraCandidates(reflectors, camera) {
  camera.updateMatrixWorld?.(true);
  camera.updateProjectionMatrix?.();
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const projection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
  return reflectors
    .filter(reflector => {
      const position = reflector.getWorldPosition(new THREE.Vector3());
      const normal = reflector.userData.reflectionNormal;
      return cameraPosition.clone().sub(position).dot(normal) > 0
        && frustum.intersectsObject(reflector);
    })
    .map(reflector => ({
      reflector,
      distanceSquared: cameraPosition.distanceToSquared(
        reflector.getWorldPosition(new THREE.Vector3()),
      ),
    }))
    .sort((a, b) => a.distanceSquared - b.distanceSquared
      || a.reflector.name.localeCompare(b.reflector.name));
}

export function createMirrorReflections({root, meshes, renderer, model}) {
  if (!root?.add || !Array.isArray(meshes) || !renderer?.render) {
    throw new Error('Mirror reflections require a Three root, meshes, and the existing renderer.');
  }

  const group = new THREE.Group();
  group.name = 'Runtime planar mirror reflections';
  group.userData = {runtimeOnly: true, collision: false};
  root.add(group);

  const reflectors = [];
  const sourceByReflector = new Map();
  const maskedFallbacks = new Map();
  const shapeCounts = {rectangle: 0, arch: 0, ellipse: 0};
  const entries = [];
  for (const source of meshes) {
    const descriptor = source?.userData?.reflectionPlane;
    if (!descriptor) continue;
    const floorId = source.userData.floorId;
    if (!floorId) throw new Error(`Mirror ${source.name || '(unnamed)'} is missing floorId.`);
    const shape = descriptor.shape;
    const converted = convertReflectionPlane(descriptor, floorElevation(model, floorId));
    // Validate dimensions and shape before grouping without retaining a throwaway mesh.
    const validationGeometry = createMirrorGeometry(shape, descriptor.width, descriptor.height);
    validationGeometry.dispose();
    entries.push({
      source,
      descriptor,
      floorId,
      position: converted.position,
      normal: converted.normal,
    });
    shapeCounts[shape] += 1;
  }

  const planeGroups = groupReflectionDescriptors(entries);
  for (const planeGroup of planeGroups) {
    const anchor = planeGroup.entries
      .reduce((sum, entry) => sum.add(entry.position), new THREE.Vector3())
      .multiplyScalar(1 / planeGroup.entries.length);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      DEFAULT_NORMAL,
      planeGroup.normal,
    );
    const geometry = combinedMirrorGeometry(planeGroup, anchor, quaternion);
    const reflector = new Reflector(geometry, {
      clipBias: 0.001,
      color: 0xbfc5c8,
      multisample: 0,
      textureWidth: REFLECTION_TEXTURE_SIZE,
      textureHeight: REFLECTION_TEXTURE_SIZE,
    });
    const sourceNames = planeGroup.entries.map(entry => entry.source.name || '');
    reflector.name = `Runtime reflection plane: ${sourceNames.filter(Boolean).join(', ') || reflectors.length + 1}`;
    reflector.position.copy(anchor).addScaledVector(
      planeGroup.normal,
      FORWARD_OFFSET_METERS,
    );
    reflector.quaternion.copy(quaternion);
    reflector.visible = false;
    reflector.renderOrder = 20;
    reflector.userData = {
      runtimeOnly: true,
      collision: false,
      kind: 'mirror-reflection',
      floorId: planeGroup.floorId,
      sourceMirror: sourceNames.filter(Boolean).join(', '),
      sourceMirrors: sourceNames,
      reflectionShape: planeGroup.entries.length === 1
        ? planeGroup.entries[0].descriptor.shape
        : 'compound',
      reflectionGroupSize: planeGroup.entries.length,
      reflectionPlaneDistance: planeGroup.planeDistance,
      reflectionNormal: planeGroup.normal.clone(),
    };
    const originalBeforeRender = reflector.onBeforeRender;
    reflector.onBeforeRender = function guardedMirrorRender(
      activeRenderer,
      scene,
      camera,
      geometryArg,
      material,
      renderGroup,
    ) {
      summary.onBeforeRenderCalls += 1;
      if (activeRenderer !== renderer) {
        summary.skippedRendererMismatch += 1;
        return;
      }
      if (scene.overrideMaterial) {
        summary.skippedOverrideMaterial += 1;
        return;
      }
      const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
      const reflectorPosition = reflector.getWorldPosition(new THREE.Vector3());
      const worldNormal = DEFAULT_NORMAL.clone().transformDirection(reflector.matrixWorld);
      const facingDot = cameraPosition.sub(reflectorPosition).dot(worldNormal);
      summary.lastFacingDot = Number(facingDot.toFixed(6));
      if (facingDot <= 0) summary.facingAwayCallbacks += 1;
      const callsBefore = renderer.info?.render?.calls ?? 0;
      const result = withReflectionRenderState(renderer, reflectors, reflector, () => (
        originalBeforeRender.call(
          reflector,
          renderer,
          scene,
          camera,
          geometryArg,
          material,
          renderGroup,
        )
      ));
      const nestedCalls = Math.max(0, (renderer.info?.render?.calls ?? callsBefore) - callsBefore);
      if (nestedCalls > 0) {
        summary.reflectionRenderPasses += 1;
        summary.nestedDrawCalls += nestedCalls;
        summary.lastRenderSource = reflector.userData.sourceMirror;
      }
      return result;
    };
    group.add(reflector);
    reflectors.push(reflector);
    sourceByReflector.set(reflector, planeGroup.entries.map(entry => entry.source));
  }

  const summary = {
    taggedMirrors: entries.length,
    reflectionPlanes: reflectors.length,
    groupedMirrorSources: entries.length - reflectors.length,
    shapes: shapeCounts,
    textureSize: REFLECTION_TEXTURE_SIZE,
    pixelsPerMirror: REFLECTION_TEXTURE_SIZE ** 2,
    maxActive: MAX_ACTIVE_REFLECTIONS,
    maxActivePixels: MAX_ACTIVE_REFLECTION_PIXELS,
    active: 0,
    activeSources: [],
    floorId: null,
    enabled: false,
    fallbackMirrorsMasked: 0,
    onBeforeRenderCalls: 0,
    reflectionRenderPasses: 0,
    nestedDrawCalls: 0,
    skippedOverrideMaterial: 0,
    skippedRendererMismatch: 0,
    facingAwayCallbacks: 0,
    lastRenderSource: null,
    lastFacingDot: null,
    coordinateTransform: 'Blender [x, planY, localZ] to Three [x, elevation + localZ, -planY], once',
  };
  let view = {enabled: false, floorId: null, walk: false};
  let lastCamera = null;

  function restoreFallbacks() {
    for (const [source, visible] of maskedFallbacks) source.visible = visible;
    maskedFallbacks.clear();
  }

  function update(camera) {
    if (camera) lastCamera = camera;
    restoreFallbacks();
    for (const reflector of reflectors) reflector.visible = false;
    if (!view.enabled || !view.walk || !lastCamera) {
      summary.active = 0;
      summary.activeSources = [];
      summary.fallbackMirrorsMasked = 0;
      return 0;
    }
    root.updateMatrixWorld?.(true);
    const floorReflectors = reflectors.filter(
      reflector => reflector.userData.floorId === view.floorId,
    );
    const active = cameraCandidates(floorReflectors, lastCamera)
      .slice(0, MAX_ACTIVE_REFLECTIONS);
    for (const {reflector} of active) {
      reflector.visible = true;
      reflector.forceUpdate = true;
      const sources = sourceByReflector.get(reflector) || [];
      for (const source of sources) {
        maskedFallbacks.set(source, source.visible);
        source.visible = false;
      }
    }
    summary.active = active.length;
    summary.activeSources = active.flatMap(
      ({reflector}) => reflector.userData.sourceMirrors,
    );
    summary.fallbackMirrorsMasked = maskedFallbacks.size;
    return active.length;
  }

  function setView({enabled = false, floorId = null, walk = false} = {}) {
    view = {enabled: enabled === true, floorId, walk: walk === true};
    summary.enabled = view.enabled && view.walk;
    summary.floorId = floorId;
    return update();
  }

  return {setView, update, summary};
}
