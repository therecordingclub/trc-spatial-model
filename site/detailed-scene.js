import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {createMirrorReflections} from '/mirror-reflections.js';
import {applyIrradianceLightMap} from './irradiance-lightmap.js';
import {MAX_ACTIVE_ROOM_LIGHTS,MAX_SHADOW_ROOM_LIGHTS,V13_LIGHTING_SELECTION_MODE,blenderPointToViewer,floorElevation,lightsForView,normalizeManifestLights} from './room-lighting.js';

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
  const lightingSelectionMode=manifest.lightingSelectionMode===V13_LIGHTING_SELECTION_MODE?V13_LIGHTING_SELECTION_MODE:null;
  const sourceLights=normalizeManifestLights(manifest.lights,model.floors);
  const lightPool=[];
  for(let index=0;index<MAX_ACTIVE_ROOM_LIGHTS;index++){
    const light=new THREE.RectAreaLight(0xffffff,0,.1,.1);
    light.name=`Inactive room light ${index+1}`;light.visible=lightingSelectionMode?false:true;light.userData={poolIndex:index};practicals.add(light);lightPool.push(light);
  }
  const shadowLightPool=[];
  if(lightingSelectionMode){
    for(let index=0;index<MAX_SHADOW_ROOM_LIGHTS;index++){
      const light=new THREE.SpotLight(0xffffff,0,6,.72,.65,2);
      light.name=`Inactive shadow room light ${index+1}`;light.visible=false;light.castShadow=true;
      light.shadow.mapSize.set(512,512);light.shadow.bias=-.0005;light.shadow.normalBias=.03;
      light.userData={poolIndex:index};light.target.name=`Inactive shadow room target ${index+1}`;
      practicals.add(light,light.target);shadowLightPool.push(light);
    }
  }
  function syncLegacyLights(descriptors){
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
  function syncV13Lights(descriptors){
    for(const [index,light] of lightPool.entries()){
      light.visible=false;light.intensity=0;light.name=`Inactive room light ${index+1}`;light.userData={poolIndex:index};
    }
    for(const [index,light] of shadowLightPool.entries()){
      light.visible=false;light.intensity=0;light.name=`Inactive shadow room light ${index+1}`;light.userData={poolIndex:index};
    }
    let areaIndex=0,shadowIndex=0;
    for(const descriptor of descriptors.slice(0,MAX_ACTIVE_ROOM_LIGHTS)){
      if(descriptor.renderLight==='shadow-spot'&&shadowIndex<shadowLightPool.length){
        const light=shadowLightPool[shadowIndex++];
        light.visible=true;light.name=descriptor.name;light.color.setRGB(...descriptor.color,THREE.LinearSRGBColorSpace);
        // Match area-light power when changing emitter type: both use pi in their power conversion.
        light.intensity=descriptor.intensity*descriptor.size*(descriptor.sizeY??descriptor.size);
        light.position.fromArray(descriptor.position);light.distance=descriptor.range;light.angle=descriptor.spotAngle;light.penumbra=descriptor.spotPenumbra;
        light.target.position.fromArray(descriptor.target);light.target.updateMatrixWorld();
        light.userData={poolIndex:shadowIndex-1,roomId:descriptor.roomId,floorId:descriptor.floorId,role:descriptor.role,fixtureFamily:descriptor.fixtureFamily,sourceEnergy:descriptor.sourceEnergy,approximate:true,shadowProfile:'spot'};
      }else if(areaIndex<lightPool.length){
        const light=lightPool[areaIndex++];
        light.visible=true;light.name=descriptor.name;light.color.setRGB(...descriptor.color,THREE.LinearSRGBColorSpace);light.intensity=descriptor.intensity;
        light.width=descriptor.size;light.height=descriptor.sizeY??descriptor.size;light.position.fromArray(descriptor.position);
        if(/^Paper lantern glow(?:\.001)?$|^V15 Kitchen lantern practical$/.test(descriptor.name)){
          // Keep the square proxy for each source disk inside its curved shade.
          const power=light.power;
          light.width=light.height=.4;light.power=power;
        }
        const target=new THREE.Vector3().fromArray(descriptor.target);
        if(target.distanceToSquared(light.position)<1e-8)target.y-=1;
        light.lookAt(target);light.userData={poolIndex:areaIndex-1,roomId:descriptor.roomId,floorId:descriptor.floorId,role:descriptor.role,fixtureFamily:descriptor.fixtureFamily,sourceEnergy:descriptor.sourceEnergy,approximate:true,sourceEmitterSize:[descriptor.size,descriptor.sizeY??descriptor.size],renderEmitterSize:[light.width,light.height]};
      }
    }
    renderer.shadowMap.needsUpdate=true;
  }
  const summary={meshes:meshes.length,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0),rooms:[...new Set(meshes.map(m=>m.userData.roomId))].length,sourceLights:sourceLights.length,activeLightLimit:MAX_ACTIVE_ROOM_LIGHTS};
  const albedoAudit=[...materials.values()].filter(mat=>/oak|laminate/i.test(mat.name)&&mat.userData.role==='floor').map(mat=>{
    let texel=null;
    if(mat.map?.image){const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.drawImage(mat.map.image,0,0,1,1);texel=[...context.getImageData(0,0,1,1).data];}
    return {name:mat.name,color:mat.color.toArray(),hasMap:!!mat.map,mapColorSpace:mat.map?.colorSpace,texel};
  });
  return {
    root,meshes,summary,manifest,albedoAudit,reflectionAudit:reflections.summary,updateReflections:reflections.update,
    lightingAudit:{sourceLights:sourceLights.length,poolSize:lightPool.length,shadowPoolSize:shadowLightPool.length,activeLightLimit:MAX_ACTIVE_ROOM_LIGHTS,lightingSelectionMode:lightingSelectionMode||'legacy',hdrLightMaps:hdrMaps.size,bakedMaterials:[...materials.values()].filter(mat=>mat.userData.lightMapApplied).length,intensityModel:'approximate source watts per emitter area; practical 0.08, indirect fill 0.025; capped at 40; calibrated HDR replaces baked structural diffuse'},
    hasFloor:floorId=>meshes.some(mesh=>mesh.userData.floorId===floorId),
    setView({floorId,walk,cutaway,ceilingsOverview,furniture,enabled,roomId}){
      root.visible=enabled;
      reflections.setView({enabled,floorId,walk});
      clip.constant=Number(model.floors.find(f=>f.id===floorId)?.elevation??model.floors.find(f=>f.id===floorId)?.modelElevation??0)+.85;
      for(const mesh of meshes){
        const role=mesh.userData.kind;
        const ceilingSurface=role==='ceiling';
        const structural=/floor|wall|ceiling/.test(role)||role==='step'||role==='light-fixture'||mesh.userData.fixedFeature===true||mesh.userData.permanentArchitecture===true;
        mesh.visible=mesh.userData.floorId===floorId&&(!ceilingSurface||walk||ceilingsOverview)&&(structural||furniture);
      }
      for(const mat of materials.values()){
        const next=cutaway&&!walk&&/wall/.test(mat.userData.role)?[clip]:[];
        if((mat.clippingPlanes?.length??0)!==next.length){mat.clippingPlanes=next;mat.needsUpdate=true;}
      }
      const activeLights=enabled?lightsForView(sourceLights,model.rooms,model.floors,{floorId,roomId,maxLights:MAX_ACTIVE_ROOM_LIGHTS,selectionMode:lightingSelectionMode}):[];
      if(lightingSelectionMode)syncV13Lights(activeLights);else syncLegacyLights(activeLights);
    },
    cameraFor(roomId){
      const pose=manifest.views?.find(view=>view.roomId===roomId)?.cameraBlender;
      const room=model.rooms.find(room=>room.id===roomId),floor=model.floors.find(floor=>floor.id===room?.floorId);
      const offset=manifest.cameraCoordinates==='blender-floor-local'?floorElevation(floor):0;
      return pose?{position:new THREE.Vector3().fromArray(blenderPointToViewer(pose.position,offset)),target:new THREE.Vector3().fromArray(blenderPointToViewer(pose.target,offset)),lens:pose.lens||23}:null;
    }
  };
}
