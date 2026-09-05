import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {createMirrorReflections} from '/mirror-reflections.js';
import {applyIrradianceLightMap} from './irradiance-lightmap.js';
import {MAX_ACTIVE_ROOM_LIGHTS,blenderPointToViewer,floorElevation,lightsForView,normalizeManifestLights} from './room-lighting.js';

export async function loadDetailedScene(scene,renderer,model,onProgress){
  const preview=new URLSearchParams(location.search).get('preview');
  if(preview&&!/^v\d+(?:-[a-z0-9]+)*$/.test(preview))throw new Error('Invalid private preview version.');
  const response=await fetch(`/reconstruction/web-manifest${preview?'-'+preview:''}.json`);
  if(!response.ok)throw new Error('Detailed interior export is still being prepared.');
  const manifest=await response.json();
  if(manifest.modelRevision&&manifest.modelRevision!==model.revision)throw new Error('The rendered interiors and current geometry are different revisions. Re-export the interiors before viewing them together.');
  if(!String(manifest.asset).startsWith('/reconstruction/'))throw new Error('Invalid local model asset.');
  const manager=new THREE.LoadingManager();const assetErrors=[];manager.onError=url=>assetErrors.push(url);
  const gltf=await new GLTFLoader(manager).loadAsync(manifest.asset,event=>onProgress(event.total?Math.round(event.loaded/event.total*100):null));
  const hdrMaps=new Map(),hdrNames=new Set();
  gltf.scene.traverse(node=>{for(const mat of (Array.isArray(node.material)?node.material:[node.material]).filter(Boolean)){const name=mat.userData?.trcLightMap?.externalAtlas;if(name)hdrNames.add(name);}});
  await Promise.all([...hdrNames].map(async name=>{
    const asset=manifest.lightMaps?.[name];
    if(!asset||!/^\/reconstruction\/lightmaps\/v\d+(?:-[a-z0-9]+)*\/[a-z0-9-]+\.hdr$/.test(asset))throw new Error('Missing local HDR lighting asset: '+name);
    const texture=await new HDRLoader(manager).setDataType(THREE.HalfFloatType).loadAsync(asset);
    texture.flipY=false;texture.channel=1;texture.colorSpace=THREE.LinearSRGBColorSpace;
    hdrMaps.set(name,texture);
  }));
  if(assetErrors.length)throw new Error(`${assetErrors.length} model textures could not load. The detailed view is paused to prevent a misleading untextured render.`);
  const root=new THREE.Group();root.name='Photo-referenced detailed reconstruction';
  const materials=new Map(),meshes=[],sourceGeometries=new Set();
  const clip=new THREE.Plane(new THREE.Vector3(0,-1,0),.85);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(source=>{
    if(!source.isMesh)return;
    let tag={};let node=source;
    while(node){tag={...node.userData,...tag};node=node.parent;}
    if(!tag.floorId)throw new Error(`Missing floor metadata on ${source.name}`);
    const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);
    sourceGeometries.add(source.geometry);
    const role=tag.kind||tag.structuralRole||'furniture';
    const originals=Array.isArray(source.material)?source.material:[source.material];
    const materialList=originals.map(original=>{
      const key=original.uuid+'-'+role;
      if(!materials.has(key)){
        const mat=original.clone();mat.userData={...mat.userData,role};
        applyIrradianceLightMap(mat,geometry,hdrMaps.get(mat.userData?.trcLightMap?.externalAtlas));
        for(const name of ['map','normalMap','roughnessMap','metalnessMap','aoMap'])if(mat[name])mat[name].anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        if(/wall|ceiling/.test(role))mat.clippingPlanes=[];
        materials.set(key,mat);
      }
      return materials.get(key);
    });
    const mesh=new THREE.Mesh(geometry,Array.isArray(source.material)?materialList:materialList[0]);
    mesh.name=source.name;mesh.userData={...tag,kind:role};
    const floor=model.floors.find(f=>f.id===tag.floorId);
    mesh.position.y=Number(floor?.elevation??floor?.modelElevation??0);
    mesh.castShadow=!/glass|glazing/i.test(source.name);mesh.receiveShadow=true;
    meshes.push(mesh);root.add(mesh);
  });
  for(const geometry of sourceGeometries)geometry.dispose();
  if(!meshes.length)throw new Error('Detailed export contains no visible geometry.');
  scene.add(root);
  const reflections=createMirrorReflections({root,meshes,renderer,model});
  const environment=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(renderer);
  const environmentTarget=pmrem.fromScene(environment,.04);environment.dispose();pmrem.dispose();
  scene.environment=environmentTarget.texture;scene.environmentIntensity=.5;
  RectAreaLightUniformsLib.init();
  const practicals=new THREE.Group();practicals.name='Local room illumination';scene.add(practicals);
  const sourceLights=normalizeManifestLights(manifest.lights,model.floors);
  const lightPool=[];
  for(let index=0;index<MAX_ACTIVE_ROOM_LIGHTS;index++){
    const light=new THREE.RectAreaLight(0xffffff,0,.1,.1);
    light.name=`Inactive room light ${index+1}`;light.visible=true;light.userData={poolIndex:index};practicals.add(light);lightPool.push(light);
  }
  function syncLights(descriptors){
    for(let index=0;index<lightPool.length;index++){
      const light=lightPool[index],descriptor=descriptors[index];
      if(!descriptor){light.intensity=0;light.name=`Inactive room light ${index+1}`;light.userData={poolIndex:index};continue;}
      light.name=descriptor.name;light.color.setRGB(...descriptor.color,THREE.LinearSRGBColorSpace);light.intensity=descriptor.intensity;
      light.width=descriptor.size;light.height=descriptor.size;light.position.fromArray(descriptor.position);
      const target=new THREE.Vector3().fromArray(descriptor.target);
      if(target.distanceToSquared(light.position)<1e-8)target.y-=1;
      light.lookAt(target);light.userData={poolIndex:index,roomId:descriptor.roomId,floorId:descriptor.floorId,role:descriptor.role,sourceEnergy:descriptor.sourceEnergy,approximate:true,fallback:descriptor.fallback===true};
    }
  }
  const summary={meshes:meshes.length,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0),rooms:[...new Set(meshes.map(m=>m.userData.roomId))].length,sourceLights:sourceLights.length,activeLightLimit:MAX_ACTIVE_ROOM_LIGHTS};
  const albedoAudit=[...materials.values()].filter(mat=>/oak|laminate/i.test(mat.name)&&mat.userData.role==='floor').map(mat=>{
    let texel=null;
    if(mat.map?.image){const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.drawImage(mat.map.image,0,0,1,1);texel=[...context.getImageData(0,0,1,1).data];}
    return {name:mat.name,color:mat.color.toArray(),hasMap:!!mat.map,mapColorSpace:mat.map?.colorSpace,texel};
  });
  return {
    root,meshes,summary,manifest,albedoAudit,reflectionAudit:reflections.summary,updateReflections:reflections.update,
    lightingAudit:{sourceLights:sourceLights.length,poolSize:lightPool.length,hdrLightMaps:hdrMaps.size,bakedMaterials:[...materials.values()].filter(mat=>mat.userData.lightMapApplied).length,intensityModel:'approximate source watts per emitter area; practical 0.08, indirect fill 0.025; capped at 40; calibrated HDR replaces baked structural diffuse'},
    hasFloor:floorId=>meshes.some(mesh=>mesh.userData.floorId===floorId),
    setView({floorId,walk,cutaway,furniture,enabled,roomId}){
      root.visible=enabled;
      reflections.setView({enabled,floorId,walk});
      clip.constant=Number(model.floors.find(f=>f.id===floorId)?.elevation??model.floors.find(f=>f.id===floorId)?.modelElevation??0)+.85;
      for(const mesh of meshes){
        const role=mesh.userData.kind;
        const ceiling=/ceiling/.test(role);
        const structural=/floor|wall|ceiling/.test(role);
        mesh.visible=mesh.userData.floorId===floorId&&(!ceiling||walk)&& (structural||furniture);
      }
      for(const mat of materials.values()){
        const next=cutaway&&!walk&&/wall/.test(mat.userData.role)?[clip]:[];
        if((mat.clippingPlanes?.length??0)!==next.length){mat.clippingPlanes=next;mat.needsUpdate=true;}
      }
      const activeLights=enabled?lightsForView(sourceLights,model.rooms,model.floors,{floorId,roomId,maxLights:lightPool.length}):[];
      syncLights(activeLights);
    },
    cameraFor(roomId){
      const pose=manifest.views?.find(view=>view.roomId===roomId)?.cameraBlender;
      const room=model.rooms.find(room=>room.id===roomId),floor=model.floors.find(floor=>floor.id===room?.floorId);
      const offset=manifest.cameraCoordinates==='blender-floor-local'?floorElevation(floor):0;
      return pose?{position:new THREE.Vector3().fromArray(blenderPointToViewer(pose.position,offset)),target:new THREE.Vector3().fromArray(blenderPointToViewer(pose.target,offset)),lens:pose.lens||23}:null;
    }
  };
}
