import * as THREE from 'three';

const DIFFUSE_LIGHTING_END = '#include <lights_fragment_end>';
const BAKED_DIFFUSE = `
${DIFFUSE_LIGHTING_END}
#ifdef USE_LIGHTMAP
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.indirectDiffuse = texture2D(lightMap, vLightMapUv).rgb
    * lightMapIntensity * BRDF_Lambert(material.diffuseColor);
#endif
`;

export function applyIrradianceLightMap(material, geometry, hdrTexture = null) {
  const descriptor = material.userData?.trcLightMap;
  if (!descriptor) return false;
  if (!material.isMeshStandardMaterial || descriptor.mode !== 'irradiance'
      || descriptor.includesDirect !== true
      || descriptor.colorSpace !== 'srgb-encoded-linear-irradiance') {
    throw new Error('Unsupported baked-lighting material: ' + material.name);
  }
  const intensity = hdrTexture ? Math.PI : descriptor.threeLightMapIntensity;
  if (!Number.isFinite(intensity) || intensity <= 0 || intensity > 1e5
      || !Number.isInteger(descriptor.uv) || descriptor.uv < 1 || descriptor.uv > 3) {
    throw new Error('Invalid baked-lighting calibration: ' + material.name);
  }
  if (!geometry.getAttribute('uv' + descriptor.uv)) {
    throw new Error('Missing separate lighting UVs: ' + material.name);
  }
  if (descriptor.externalAtlas && !hdrTexture) {
    throw new Error('High-dynamic-range lightmap did not load: ' + material.name);
  }
  const transport = hdrTexture || material.emissiveMap;
  if (!transport || transport.channel !== descriptor.uv) {
    throw new Error('Missing calibrated lightmap transport: ' + material.name);
  }
  material.lightMap = transport;
  material.lightMap.colorSpace = hdrTexture ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  material.lightMapIntensity = intensity;
  material.emissiveMap = null;
  material.emissive.set(0);
  material.emissiveIntensity = 0;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    if (!shader.fragmentShader.includes(DIFFUSE_LIGHTING_END)) {
      throw new Error('Renderer changed its physical-lighting contract.');
    }
    shader.fragmentShader = shader.fragmentShader.replace(DIFFUSE_LIGHTING_END, BAKED_DIFFUSE);
  };
  material.customProgramCacheKey = () => 'trc-calibrated-diffuse-lightmap-v1';
  material.userData.lightMapApplied = true;
  material.needsUpdate = true;
  return true;
}

export function cloneLightMapTransport(material) {
  if (!material.userData?.lightMapApplied) return material;
  const clone = material.clone();
  if (material.userData.trcLightMap.externalAtlas) {
    clone.lightMap = null;
    delete clone.userData.trcLightMap;
    delete clone.userData.lightMapApplied;
    return clone;
  }
  clone.emissiveMap = material.lightMap;
  clone.emissive.set(0xffffff);
  clone.emissiveIntensity = material.userData.trcLightMap.strength;
  clone.lightMap = null;
  delete clone.userData.lightMapApplied;
  return clone;
}
