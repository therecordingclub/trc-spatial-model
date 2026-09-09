import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.argv[2]||path.join(project,'site'));
const preview=process.argv[3]||'';
const assetRoot=path.resolve(process.argv[4]||path.join(project,'docs/model'));
if(preview)assert.match(preview,/^v\d+(?:-[a-z0-9]+)*$/,'Invalid preview version');
const readJSON=async name=>JSON.parse(await readFile(path.join(root,name),'utf8'));
let model=await readJSON('data/model.json');
const manifestFile=`reconstruction/web-manifest${preview?'-'+preview:''}.json`;
const manifest=await readJSON(manifestFile);
if(preview)model=await readJSON(manifest.modelAsset);
const downloads=await readJSON('downloads.json');
const sources=await readJSON('sources/source-index.json');
for(const source of sources.records){
  const bytes=await readFile(path.join(root,source.file));
  assert.equal(bytes.length,source.bytes,`Source document size mismatch: ${source.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256,`Source document hash mismatch: ${source.file}`);
}
assert.equal(manifest.modelRevision,model.revision,'Published model and rendered geometry must share a revision');
assert.match(manifest.asset,/^\/reconstruction\/[a-z0-9.-]+\.gltf$/);
const gltfBytes=await readFile(path.join(root,manifest.asset));
const gltf=JSON.parse(gltfBytes);
const rooms=new Set(gltf.nodes.map(node=>node.extras?.roomId).filter(Boolean));
for(const room of model.rooms)assert(rooms.has(room.id),`Rendered room is missing: ${room.id}`);
const sourceModel=await readJSON(manifest.modelAsset);
assert.equal(sourceModel.revision,model.revision,'Downloadable source snapshot must match the displayed model');

for(const [source,destination] of Object.entries(downloads)){
  assert.match(source,/^\/reconstruction\/[a-z0-9.-]+\.(?:glb|blend)$/);
  const url=new URL(destination);
  assert.equal(url.origin,'https://github.com');
  assert(url.pathname.startsWith('/therecordingclub/trc-spatial-model/releases/download/'));
  assert.equal(url.search,'');assert.equal(url.hash,'');
}
for(const key of ['downloadAsset','authoringAsset']){
  if(manifest[key])assert(downloads[manifest[key]]||(await stat(path.join(root,manifest[key]))).isFile(),`Missing ${key}`);
}

let checkedAssetBytes=0;
const embeddedImages=gltf.images.filter(image=>!image.uri);
for(const image of embeddedImages){
  assert(Number.isInteger(image.bufferView)&&gltf.bufferViews[image.bufferView],'Embedded image needs a valid buffer view');
  assert(['image/png','image/jpeg','image/webp'].includes(image.mimeType),'Unsupported embedded image type');
}
const uris=[...gltf.buffers,...gltf.images.filter(image=>image.uri)].map(asset=>asset.uri);
for(const uri of uris){
  const url=new URL(uri,'https://model.therecording.club');
  assert.equal(url.origin,'https://therecordingclub.github.io');
  const prefix='/trc-spatial-model/model/';
  assert(url.pathname.startsWith(prefix),`Unexpected model asset store: ${uri}`);
  const relative=decodeURIComponent(url.pathname.slice(prefix.length));
  assert(!relative.split('/').includes('..'));
  let assetFile=path.join(assetRoot,relative);
  if(assetRoot!==path.join(project,'docs/model')){
    try{await stat(assetFile);}catch(error){if(error.code!=='ENOENT')throw error;assetFile=path.join(project,'docs/model',relative);}
  }
  const info=await stat(assetFile);
  assert(info.isFile()&&info.size>0,`Empty model asset: ${relative}`);
  const buffer=gltf.buffers.find(item=>item.uri===uri);
  if(buffer)assert.equal(info.size,buffer.byteLength,`Model buffer size mismatch: ${relative}`);
  checkedAssetBytes+=info.size;
}

let linkedFiles=0;
for(const page of ['index.html','photo/index.html']){
  const html=await readFile(path.join(root,page),'utf8');
  for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
    const value=match[1];
    if(!value||value.startsWith('#')||/^(https?:|data:)/.test(value))continue;
    const url=new URL(value,'https://model.therecording.club/'+page);
    if(downloads[url.pathname]||['/api/model','/api/scenario'].includes(url.pathname))continue;
    let file=path.join(root,decodeURIComponent(url.pathname));
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    assert((await stat(file)).isFile(),`Missing linked file: ${page} -> ${value}`);
    linkedFiles++;
  }
}
console.log(JSON.stringify({status:'pass',root,manifestFile,version:manifest.version,modelRevision:model.revision,rooms:rooms.size,
  modelDependencies:uris.length,embeddedImages:embeddedImages.length,checkedAssetBytes,linkedFiles,sourceDocuments:sources.records.length,downloadRedirects:Object.keys(downloads).length,
  gltfSha256:createHash('sha256').update(gltfBytes).digest('hex')},null,2));
