import * as THREE from 'three';
import * as GS from 'gaussian-splats-3d';

const $ = id => document.getElementById(id);
const stage = $('splat-stage');
const preferred = ['DSC00133.JPG', 'DSC00138.JPG', 'DSC00150.JPG'];
const LIMITS = { yaw: THREE.MathUtils.degToRad(35), pitch: THREE.MathUtils.degToRad(25) };
let viewer, poses = new Map(), current, yaw = 0, pitch = 0, dragging = false, start = null;

function setStatus(text) { $('state').textContent = text; }
function setLoading(title, detail, progress) { $('load-title').textContent = title; $('load-detail').textContent = detail; $('meter-fill').style.width = `${progress}%`; }
function camera() { return viewer?.camera || viewer?.renderer?.camera; }
function applyPose() {
  const cam = camera(); if (!cam || !current) return;
  const baseForward = new THREE.Vector3(...current.forward).normalize();
  const up = new THREE.Vector3(...current.up).normalize();
  const right = new THREE.Vector3().crossVectors(baseForward, up).normalize();
  const qYaw = new THREE.Quaternion().setFromAxisAngle(up, yaw);
  const pitchedForward = baseForward.clone().applyQuaternion(qYaw);
  const pitchAxis = right.applyQuaternion(qYaw).normalize();
  const forward = pitchedForward.applyAxisAngle(pitchAxis, pitch).normalize();
  cam.position.set(...current.position); cam.up.copy(up); cam.lookAt(cam.position.clone().add(forward)); cam.updateProjectionMatrix();
  stage.dataset.viewState=JSON.stringify({source:current.image,yaw,pitch,position:cam.position.toArray(),forward:forward.toArray()});
}
function selectPose(image) {
  current = poses.get(image); if (!current) return;
  yaw = 0; pitch = 0; applyPose();
  $('pose-name').textContent = image.replace('.JPG', '');
  document.querySelectorAll('[data-pose]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pose === image)));
  setStatus(`${image.replace('.JPG', '')} · calibrated source pose`);
}
function makePoseButtons() {
  for (const image of preferred) {
    if (!poses.has(image)) continue;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pose = image;
    button.textContent = image.replace('.JPG', ''); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => selectPose(image)); $('pose-buttons').append(button);
  }
}
async function load() {
  $('retry').hidden = true; $('veil').hidden = false; setLoading('Loading photographic lobby', 'Reading calibrated camera positions…', 12); setStatus('Loading reconstruction…');
  try {
    if(viewer){await viewer.dispose();viewer=null;}
    poses.clear();$('pose-buttons').replaceChildren();current=null;
    const poseData = await fetch('/photo-assets/camera-poses.json', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(`camera data ${response.status}`); return response.json(); });
    poseData.poses.forEach(pose => poses.set(pose.image, pose));
    const initial = poses.get('DSC00133.JPG'); if (!initial) throw new Error('DSC00133 pose is missing');
    setLoading('Loading photographic lobby', 'Streaming the finite lobby splat…', 34);
    viewer = new GS.Viewer({
      rootElement: stage,
      cameraUp: poseData.mean_camera_up,
      initialCameraPosition: initial.position,
      initialCameraLookAt: initial.look_at_one_unit,
      sphericalHarmonicsDegree: 2,
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
      enableSIMDInSort: false,
      dynamicScene: false,
      useBuiltInControls: false
    });
    await viewer.addSplatScene('/photo-assets/lobby.ply', { showLoadingUI: false, progressiveLoad: false, splatAlphaRemovalThreshold: 25, format: GS.SceneFormat.Ply, onProgress:percent=>{if(Number.isFinite(percent))setLoading('Loading photographic lobby',`Reading local reconstruction: ${Math.round(percent)}%`,percent);} });
    viewer.camera.fov=poseData.camera.fov_y_degrees;viewer.camera.updateProjectionMatrix();viewer.start();
    setLoading('Lobby ready', 'Limited to calibrated source-camera viewpoints.', 100);
    makePoseButtons(); selectPose('DSC00133.JPG'); $('reset').disabled = false; setStatus('DSC00133 · calibrated source pose');
    stage.dataset.ready='true';
    setTimeout(() => { $('veil').hidden = true; }, 450);
  } catch (error) {
    stage.dataset.error=String(error);console.error(error); setLoading('Lobby could not load', String(error.message||error), 0); $('retry').hidden = false; setStatus('Load failed · retry available');
  }
}
stage.addEventListener('pointerdown', event => { if (!current) return; dragging = true; start = { x: event.clientX, y: event.clientY, yaw, pitch }; stage.setPointerCapture(event.pointerId); event.preventDefault(); });
stage.addEventListener('pointermove', event => { if (!dragging || !start) return; yaw = THREE.MathUtils.clamp(start.yaw - (event.clientX - start.x) * 0.004, -LIMITS.yaw, LIMITS.yaw); pitch = THREE.MathUtils.clamp(start.pitch - (event.clientY - start.y) * 0.004, -LIMITS.pitch, LIMITS.pitch); applyPose(); });
stage.addEventListener('pointerup', event => { dragging = false; start = null; try { stage.releasePointerCapture(event.pointerId); } catch {} });
stage.addEventListener('pointercancel', () => { dragging = false; start = null; });
document.addEventListener('keydown', event => {
  if (!current || event.defaultPrevented || event.isComposing || event.altKey || event.metaKey || event.ctrlKey || event.target?.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"]')) return;
  const key = event.key.toLowerCase();
  if (!['arrowup','arrowdown','arrowleft','arrowright'].includes(key)) return;
  event.preventDefault();
  const step = THREE.MathUtils.degToRad(event.shiftKey ? 4 : 2);
  yaw = THREE.MathUtils.clamp(yaw + (key === 'arrowleft' ? step : key === 'arrowright' ? -step : 0), -LIMITS.yaw, LIMITS.yaw);
  pitch = THREE.MathUtils.clamp(pitch + (key === 'arrowup' ? step : key === 'arrowdown' ? -step : 0), -LIMITS.pitch, LIMITS.pitch);
  applyPose();
});
$('reset').addEventListener('click', () => selectPose(current?.image || 'DSC00133.JPG'));
$('retry').addEventListener('click', load);
load();
