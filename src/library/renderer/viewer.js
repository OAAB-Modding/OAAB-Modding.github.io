import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';

import { normalizeAssetPath } from '../resolver/path-utils.js';
import { Tes3WorkerClient } from '../workers/tes3-worker-client.js';
import { fingerprintBytes } from '../storage/thumbnail-cache.js';
import { captureTransparentPng } from './capture.js';
import {
  animationGroupTime,
  controllerAnimationTime,
  externalKfPath,
  mergeExternalAnimationPacket,
  sampleQuaternionCurve,
  sampleScalarCurve,
  sampleStep,
  sampleVectorCurve,
  selectIdleAnimationGroup,
} from './nif-animation.js';
import {
  cameraDistanceScaleForView,
  cameraFrameMarginForView,
  cameraDirectionForView,
  isEditorMarkerName,
  isViewerObjectVisible,
  THUMBNAIL_ORIENTATION_RENDER_SIZE,
  thumbnailOrientationFromCoverage,
} from './viewer-modes.js';

const FALLBACK_COLOR = 0xd45a8b;
const THUMBNAIL_VERTICAL_AXIS = new THREE.Vector3(0, 1, 0);
const THUMBNAIL_MASK_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  side: THREE.FrontSide,
  depthTest: true,
  depthWrite: true,
  transparent: false,
  blending: THREE.NoBlending,
  toneMapped: false,
});
const THUMBNAIL_MASK_PIXELS = new Uint8Array(
  THUMBNAIL_ORIENTATION_RENDER_SIZE * THUMBNAIL_ORIENTATION_RENDER_SIZE * 4,
);
let thumbnailMaskRenderTarget = null;

export class NifViewer {
  constructor({ canvas, resolver, onStatus = () => {} }) {
    if (!canvas) throw new TypeError('NifViewer requires a canvas');
    if (!resolver) throw new TypeError('NifViewer requires an AssetResolver');

    this.canvas = canvas;
    this.resolver = resolver;
    this.onStatus = onStatus;
    this.worker = new Tes3WorkerClient();
    this.loadGeneration = 0;
    this.wireframe = false;
    this.markersVisible = true;
    this.collisionVisible = false;
    this.normalInspector = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x17130f);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    this.camera.position.set(2, 1.4, 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Keep an alpha channel available for transparent PNG exports. The
      // interactive viewer remains opaque because scene.background is a Color.
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Morrowind NIF';
    this.modelRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.modelRoot);

    this.grid = new THREE.GridHelper(10, 20, 0x815844, 0x3f362e);
    this.grid.material.opacity = 0.45;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(1.5);
    this.axes.visible = false;
    this.scene.add(this.axes);

    // Keep preview lighting diffuse and restrained. Directional key/fill lights
    // created localized hot spots that made some bright models look self-lit.
    this.scene.add(new THREE.HemisphereLight(0xfff0d5, 0x392d28, 0.75));

    this.ddsLoader = new DDSLoader();
    this.tgaLoader = new TGALoader();
    this.imageLoader = new THREE.TextureLoader();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    canvas.addEventListener('dblclick', () => this.resetCamera());

    this.animate = this.animate.bind(this);
    this.animationFrame = requestAnimationFrame(this.animate);
    this.resize();
  }

  async parserVersion() {
    return this.worker.version();
  }

  async load(path, {
    display = true,
    resolveTextures = true,
    resolveAnimation = false,
  } = {}) {
    const generation = ++this.loadGeneration;
    const normalized = normalizeAssetPath(path, { root: 'meshes' });
    this.#status('resolving', `Resolving ${normalized}`);

    const startedAt = performance.now();
    const asset = await this.resolver.resolve(normalized);
    let assetFingerprint = await fingerprintBytes(asset.bytes);
    this.#status('parsing', `Parsing ${normalized} in WebAssembly`);
    const packet = await this.worker.parseNif(asset.bytes);

    let animationAsset = null;
    const animationPath = resolveAnimation ? externalKfPath(normalized) : null;
    if (animationPath) {
      try {
        animationAsset = await this.resolver.resolve(animationPath);
      } catch {
        // External x*.kf files are optional; many static and inline-animated
        // NIFs do not have one.
      }
    }
    if (animationAsset) {
      this.#status('parsing', `Parsing ${animationPath} in WebAssembly`);
      try {
        const animationPacket = await this.worker.parseNif(animationAsset.bytes);
        mergeExternalAnimationPacket(packet, animationPacket);
        assetFingerprint = `${assetFingerprint}:${await fingerprintBytes(animationAsset.bytes)}`;
      } catch (error) {
        packet.warnings = packet.warnings || [];
        packet.warnings.push(`External animation ${animationPath} could not be parsed: ${error.message}`);
      }
    }

    if (generation !== this.loadGeneration) throw new Error('Load superseded by a newer request');

    const textureDiagnostics = resolveTextures
      ? await this.#resolveTextures(packet.textures || [], generation)
      : [];
    if (generation !== this.loadGeneration) throw new Error('Load superseded by a newer request');

    const result = {
      path: normalized,
      asset,
      animationAsset,
      animationPath: animationAsset ? animationPath : null,
      packet,
      textureDiagnostics,
      assetFingerprint,
      elapsedMs: performance.now() - startedAt,
    };

    if (display) {
      this.#displayPacket(packet, textureDiagnostics);
      const framed = this.frameModel();
      this.#status('ready', framed
        ? `Loaded ${normalized}`
        : `Loaded ${normalized} · no visible geometry`);
    } else {
      for (const diagnostic of textureDiagnostics) diagnostic.texture?.dispose();
      this.#status('ready', `Loaded ${normalized}`);
    }

    return result;
  }

  cancelLoad(generation = this.loadGeneration) {
    if (generation !== this.loadGeneration) return false;
    this.loadGeneration += 1;
    return true;
  }

  setWireframe(visible) {
    this.wireframe = !!visible;
    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      const materials = new Set([
        object.material,
        object.userData.renderMaterial,
        object.userData.normalMaterial,
      ]);
      for (const material of materials) {
        if (material) material.wireframe = this.wireframe;
      }
    });
  }

  setMarkersVisible(visible) {
    this.markersVisible = !!visible;
    this.modelRoot.traverse((object) => {
      if (object.isMesh && object.userData.marker) this.#syncObjectVisibility(object);
    });
  }

  setGridVisible(visible) {
    this.grid.visible = !!visible;
  }

  setAxesVisible(visible) {
    this.axes.visible = !!visible;
  }

  setCollisionVisible(visible) {
    this.collisionVisible = !!visible;
    this.modelRoot.traverse((object) => {
      if (object.isMesh && object.userData.collision) this.#syncObjectVisibility(object);
    });
  }

  setNormalInspector(visible) {
    this.normalInspector = !!visible;
    this.modelRoot.traverse((object) => {
      if (!object.isMesh || !object.userData.renderMaterial) return;
      object.material = this.normalInspector
        ? object.userData.normalMaterial
        : object.userData.renderMaterial;
    });
  }

  setBackground(value) {
    this.scene.background.set(value);
  }

  resetCamera() {
    if (!this.cameraHome) return;
    this.camera.position.copy(this.cameraHome.position);
    this.camera.near = this.cameraHome.near;
    this.camera.far = this.cameraHome.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.cameraHome.target);
    this.controls.update();
  }

  attachTo(host) {
    if (!host) throw new TypeError('Viewer host is required');
    if (this.canvas.parentElement !== host) host.prepend(this.canvas);
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(host);
    this.resize();
    return this;
  }

  async captureThumbnail({
    width = 160,
    height = 160,
    type = 'image/webp',
    quality = 0.86,
    includeGrid = false,
    view = '',
    thumbnailRotationY = 0,
  } = {}) {
    const oldSize = this.renderer.getSize(new THREE.Vector2());
    const oldPixelRatio = this.renderer.getPixelRatio();
    const oldAspect = this.camera.aspect;
    const oldGridVisible = this.grid.visible;
    const oldCameraPosition = this.camera.position.clone();
    const oldTarget = this.controls.target.clone();
    const oldModelQuaternion = this.modelRoot.quaternion.clone();
    try {
      if (!includeGrid) this.grid.visible = false;
      // Capture the requested logical size exactly. The interactive viewer
      // can use a high device-pixel ratio, but grid thumbnails should stay
      // cheap and predictable on both desktop and mobile screens.
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      if (view) this.#applyCameraView(view);
      applyThumbnailRotation(this.modelRoot, oldModelQuaternion, thumbnailRotationY);
      this.renderer.render(this.scene, this.camera);
      return await new Promise((resolve, reject) => {
        this.canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to encode thumbnail')), type, quality);
      });
    } finally {
      this.modelRoot.quaternion.copy(oldModelQuaternion);
      this.modelRoot.updateWorldMatrix(true, true);
      this.grid.visible = oldGridVisible;
      this.renderer.setPixelRatio(oldPixelRatio);
      this.renderer.setSize(oldSize.x, oldSize.y, false);
      this.camera.aspect = oldAspect;
      this.camera.updateProjectionMatrix();
      if (view) {
        this.camera.position.copy(oldCameraPosition);
        this.controls.target.copy(oldTarget);
        this.controls.update();
      }
      this.resize();
    }
  }

  detectThumbnailOrientation({ view = '', debug = false, label = '' } = {}) {
    const oldAspect = this.camera.aspect;
    const oldCameraPosition = this.camera.position.clone();
    const oldTarget = this.controls.target.clone();
    try {
      // The final thumbnails are square, so establish that projection once and
      // leave the camera untouched between the current and 180-degree passes.
      this.camera.aspect = 1;
      this.camera.updateProjectionMatrix();
      if (view) this.#applyCameraView(view);
      const result = detectBacksideWithVisibilityMask({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        modelRoot: this.modelRoot,
        grid: this.grid,
        axes: this.axes,
      });
      if (debug) {
        console.debug('[OAAB thumbnail orientation]', label || this.modelRoot.name, {
          currentCoverage: result.currentCoverage,
          flippedCoverage: result.flippedCoverage,
          ratio: result.coverageRatio,
          thumbnailFlip180: result.thumbnailFlip180,
        });
      }
      return result;
    } finally {
      this.camera.aspect = oldAspect;
      this.camera.updateProjectionMatrix();
      if (view) {
        this.camera.position.copy(oldCameraPosition);
        this.controls.target.copy(oldTarget);
        this.controls.update();
      }
    }
  }

  async capturePng() {
    return captureTransparentPng(this);
  }

  #applyCameraView(view) {
    const target = this.cameraHome?.target?.clone() || this.controls.target.clone();
    const referencePosition = this.cameraHome?.position || this.camera.position;
    const homeDistance = referencePosition.distanceTo(target);
    const verticalHalfExtent = view === 'front' && this.cameraFrameBounds
      ? Math.max((this.cameraFrameBounds.maxY - this.cameraFrameBounds.minY) / 2, 0.01)
      : 0;
    const distance = verticalHalfExtent
      ? verticalHalfExtent
        / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
        * cameraFrameMarginForView(view)
        * cameraDistanceScaleForView(view)
      : homeDistance * cameraDistanceScaleForView(view);
    const framedDistance = Math.max(distance, 0.01);
    const direction = new THREE.Vector3(...cameraDirectionForView(view)).normalize();
    this.camera.position.copy(target).add(direction.multiplyScalar(framedDistance));
    this.controls.target.copy(target);
    this.controls.update();
  }

  frameModel() {
    this.cameraFrameBounds = null;
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.updateWorldMatrix(true, true);

    const box = new THREE.Box3();
    this.modelRoot.traverse(object => {
      if (!object.visible || !object.geometry) return;
      const objectBox = new THREE.Box3().setFromObject(object);
      if (objectBox.isEmpty()) return;
      const values = [
        objectBox.min.x, objectBox.min.y, objectBox.min.z,
        objectBox.max.x, objectBox.max.y, objectBox.max.z,
      ];
      if (values.every(Number.isFinite)) box.union(objectBox);
    });
    if (box.isEmpty()) return false;

    const center = box.getCenter(new THREE.Vector3());
    // Box3 reports the center in the modelRoot parent's coordinate space, which
    // is also the space used by modelRoot.position. Offset by that world-space
    // center directly so the root's Morrowind orientation cannot skew framing.
    this.modelRoot.position.copy(center).multiplyScalar(-1);
    this.modelRoot.updateWorldMatrix(true, true);

    const centeredBox = new THREE.Box3().setFromObject(this.modelRoot);
    this.cameraFrameBounds = {
      minY: centeredBox.min.y,
      maxY: centeredBox.max.y,
    };
    const sphere = centeredBox.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = new THREE.Vector3(...cameraDirectionForView()).normalize();

    this.camera.near = Math.max(radius / 1000, 0.001);
    this.camera.far = Math.max(radius * 100, 100);
    this.camera.position.copy(direction.multiplyScalar(distance * 1.15));
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = radius * 0.03;
    this.controls.maxDistance = radius * 30;
    this.controls.update();

    this.grid.scale.setScalar(Math.max(radius / 5, 0.1));
    this.axes.scale.setScalar(Math.max(radius / 2, 0.1));
    this.cameraHome = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      near: this.camera.near,
      far: this.camera.far,
    };
    return true;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth || this.canvas.clientWidth || 1);
    const height = Math.max(1, parent?.clientHeight || this.canvas.clientHeight || 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.#applyAnimations((performance.now() - (this.animationEpoch || performance.now())) / 1000);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.worker.terminate();
    this.#disposeModel();
    this.renderer.dispose();
  }

  async #resolveTextures(paths, generation) {
    const unique = [];
    const seen = new Set();
    for (const rawPath of paths) {
      try {
        const path = normalizeAssetPath(rawPath, { root: 'textures' });
        if (!seen.has(path)) {
          seen.add(path);
          unique.push({ rawPath, path });
        }
      } catch (error) {
        unique.push({ rawPath, path: null, normalizationError: error });
      }
    }

    let completed = 0;
    return mapLimit(unique, 6, async (entry) => {
      if (generation !== this.loadGeneration) throw new Error('Texture load superseded');
      if (!entry.path) {
        return { ...entry, status: 'missing', error: entry.normalizationError?.message };
      }
      try {
        const asset = await this.resolver.resolve(entry.path);
        const texture = await this.#textureFromAsset(asset);
        completed += 1;
        this.#status('textures', `Resolved textures ${completed}/${unique.length}`);
        return { ...entry, status: 'resolved', asset, texture };
      } catch (error) {
        completed += 1;
        this.#status('textures', `Resolved textures ${completed}/${unique.length}`);
        return { ...entry, status: 'missing', error: error.message };
      }
    });
  }

  async #textureFromAsset(asset) {
    const extension = asset.path.split('.').pop();
    const blob = new Blob([asset.bytes], {
      // Some CDNs serve legacy BMP files as application/octet-stream. Keep
      // the native image decoder on the BMP path by supplying its MIME type.
      type: extension === 'bmp' ? 'image/bmp' : asset.mimeType,
    });
    const url = URL.createObjectURL(blob);
    try {
      let texture;
      if (extension === 'dds') texture = await this.ddsLoader.loadAsync(url);
      else if (extension === 'tga') texture = await this.tgaLoader.loadAsync(url);
      // Browsers decode BMP through the same native image path used for PNG
      // and JPEG, so no additional Three.js loader is required.
      else if (extension === 'bmp') texture = await this.imageLoader.loadAsync(url);
      else texture = await this.imageLoader.loadAsync(url);
      texture.name = asset.path;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      return texture;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  #displayPacket(packet, textureDiagnostics) {
    this.#disposeModel();
    const textures = new Map(
      textureDiagnostics
        .filter((entry) => entry.status === 'resolved')
        .map((entry) => [entry.path, entry.texture]),
    );
    this.loadedTextures = new Set(textures.values());
    this.resolvedTextureMap = textures;
    this.animationObjects = new Map();
    this.animationTargets = new Map();
    this.animations = packet.animations || [];
    this.idleAnimationGroup = selectIdleAnimationGroup(packet.animationGroups || []);
    this.skinBindings = [];

    for (const nodePacket of packet.nodes || []) {
      const node = new THREE.Group();
      node.name = nodePacket.name || nodePacket.blockType;
      applyPacketTransform(node, nodePacket.localTransform || nodePacket.transform);
      this.#registerAnimationObject(nodePacket.id, node, [node.name]);
      const parent = this.animationObjects.get(nodePacket.parentId) || this.modelRoot;
      parent.add(node);
    }

    for (const meshPacket of packet.meshes || []) {
      if (!meshPacket.vertices.length || !meshPacket.indices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(meshPacket.vertices, 3));
      geometry.setIndex(new THREE.BufferAttribute(meshPacket.indices, 1));

      if (meshPacket.normals.length === meshPacket.vertices.length) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(meshPacket.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      if (meshPacket.uvs.length / 2 === meshPacket.vertices.length / 3) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(meshPacket.uvs, 2));
      }
      if (meshPacket.colors.length / 4 === meshPacket.vertices.length / 3) {
        geometry.setAttribute('color', new THREE.BufferAttribute(meshPacket.colors, 4));
      }
      const hasVertexColors = geometry.hasAttribute('color');

      const rawTexture = meshPacket.material.texture;
      let texturePath = null;
      try {
        if (rawTexture) texturePath = normalizeAssetPath(rawTexture, { root: 'textures' });
      } catch {}
      const texture = texturePath ? textures.get(texturePath) : null;
      const material = this.#createMaterial(
        meshPacket.material,
        texture,
        !!rawTexture,
        hasVertexColors,
      );
      const skinBinding = createSkinBinding(geometry, material, meshPacket.skin);
      const mesh = skinBinding?.mesh || new THREE.Mesh(geometry, material);
      mesh.name = meshPacket.name || meshPacket.blockType;
      applyPacketTransform(mesh, meshPacket.localTransform || meshPacket.transform);
      mesh.userData.renderMaterial = material;
      mesh.userData.normalMaterial = createNormalInspectorMaterial(material, this.wireframe);
      mesh.userData.collision = !!meshPacket.collision;
      mesh.userData.marker = isEditorMarkerName(mesh.name);
      mesh.userData.hidden = !!meshPacket.hidden;
      mesh.userData.thumbnailGeometry = true;
      mesh.userData.animationVisible = true;
      mesh.material = this.normalInspector
        ? mesh.userData.normalMaterial
        : mesh.userData.renderMaterial;
      this.#syncObjectVisibility(mesh);
      const parent = this.animationObjects.get(meshPacket.parentId) || this.modelRoot;
      parent.add(mesh);
      this.#registerAnimationObject(
        meshPacket.id,
        mesh,
        [...(meshPacket.animationTargets || []), mesh.name],
      );
      if (skinBinding) this.skinBindings.push(skinBinding);
    }

    for (const particlePacket of packet.particles || []) {
      if (!particlePacket.positions.length) continue;
      const rawTexture = particlePacket.material.texture;
      let texturePath = null;
      try { if (rawTexture) texturePath = normalizeAssetPath(rawTexture, { root: 'textures' }); } catch {}
      const texture = texturePath ? textures.get(texturePath) : null;
      const geometry = createParticleGeometry(particlePacket);
      const material = createParticleMaterial(
        particlePacket,
        texture,
        !!rawTexture,
        this.wireframe,
      );
      const particleMesh = new THREE.Mesh(geometry, material);
      particleMesh.name = particlePacket.name || particlePacket.blockType;
      applyPacketTransform(
        particleMesh,
        particlePacket.localTransform || particlePacket.transform,
      );
      particleMesh.frustumCulled = false;
      particleMesh.userData.hidden = !!particlePacket.hidden;
      particleMesh.userData.thumbnailGeometry = false;
      particleMesh.userData.animationVisible = true;
      this.#syncObjectVisibility(particleMesh);
      const parent = this.animationObjects.get(particlePacket.parentId) || this.modelRoot;
      parent.add(particleMesh);
      this.#registerAnimationObject(
        particlePacket.id,
        particleMesh,
        [...(particlePacket.animationTargets || []), particleMesh.name],
      );
    }

    this.animationEpoch = performance.now();
    this.#applyAnimations(0);
    for (const binding of this.skinBindings) {
      binding.mesh.computeBoundingBox();
      binding.mesh.computeBoundingSphere();
    }
  }

  #registerAnimationObject(id, object, names = []) {
    if (id != null) this.animationObjects.set(id, object);
    for (const name of names.filter(Boolean)) {
      const key = String(name).toLowerCase();
      if (!this.animationTargets.has(key)) this.animationTargets.set(key, []);
      const objects = this.animationTargets.get(key);
      if (!objects.includes(object)) objects.push(object);
    }
  }

  #syncObjectVisibility(object) {
    object.visible = object.userData.animationVisible !== false && isViewerObjectVisible(object.userData, {
      markersVisible: this.markersVisible,
      collisionVisible: this.collisionVisible,
    });
  }

  #applyAnimations(elapsed) {
    if (!this.animationObjects) return;
    const idleTime = this.idleAnimationGroup
      ? animationGroupTime(this.idleAnimationGroup, elapsed)
      : null;

    for (const animation of this.animations || []) {
      if (!animation.active) continue;
      const targets = animation.targetId != null
        ? [this.animationObjects.get(animation.targetId)].filter(Boolean)
        : this.animationTargets.get(String(animation.target || '').toLowerCase()) || [];
      if (!targets.length) continue;
      const data = animation.data || {};
      const controllerTime = controllerAnimationTime(animation, elapsed);
      const timelineTime = idleTime ?? finiteAnimationStart(animation);

      if (data.kind === 'keyframe') {
        for (const target of targets) applyKeyframeTransform(target, data, timelineTime);
      } else if (data.kind === 'visibility') {
        const visible = sampleStep(data.keys, idleTime ?? controllerTime, true);
        for (const target of targets) {
          if (target.isMesh) {
            target.userData.animationVisible = visible;
            this.#syncObjectVisibility(target);
          } else {
            target.visible = visible;
          }
        }
      } else if (data.kind === 'uv') {
        const uOffset = sampleScalarCurve(data.uOffset, controllerTime, 0);
        const vOffset = sampleScalarCurve(data.vOffset, controllerTime, 0);
        const uTiling = sampleScalarCurve(data.uTiling, controllerTime, 1);
        const vTiling = sampleScalarCurve(data.vTiling, controllerTime, 1);
        for (const target of renderObjectsBelow(targets)) {
          if (target.material?.userData?.nifParticle) continue;
          const map = target.material?.map;
          if (!map) continue;
          map.offset.set(uOffset, vOffset);
          map.repeat.set(uTiling, vTiling);
        }
      } else if (data.kind === 'flip' && data.textures?.length && data.secsPerFrame > 0) {
        const index = Math.floor(
          Math.max(0, controllerTime - (data.flipStartTime || 0)) / data.secsPerFrame,
        ) % data.textures.length;
        let path = null;
        try { path = normalizeAssetPath(data.textures[index], { root: 'textures' }); } catch {}
        const texture = path ? this.resolvedTextureMap?.get(path) : null;
        if (!texture) continue;
        for (const target of renderObjectsBelow(targets)) {
          if (target.material) setMaterialMap(target.material, texture);
        }
      }
    }

    this.modelRoot.updateWorldMatrix(true, true);
    for (const binding of this.skinBindings || []) {
      updateSkinBinding(binding, this.animationObjects);
    }
  }

  #createMaterial(packet, texture, expectedTexture, hasVertexColors) {
    const diffuse = packet.diffuse || [1, 1, 1];
    const vertexColorMode = hasVertexColors ? packet.vertexColorMode : 'Ignore';
    const vertexColorLightingMode = packet.vertexColorLightingMode || 'EmissiveAmbientDiffuse';
    const diffuseVertexColors = vertexColorMode === 'AmbientDiffuse'
      && vertexColorLightingMode !== 'Emissive';
    const emissiveVertexColors = vertexColorMode === 'Emissive';
    const emissiveOnlyLighting = vertexColorMode === 'AmbientDiffuse'
      && vertexColorLightingMode === 'Emissive';
    const replaceTexture = expectedTexture && packet.applyMode === 'Replace';
    const common = {
      color: expectedTexture && !texture
        ? FALLBACK_COLOR
        : replaceTexture
          ? 0xffffff
          : emissiveOnlyLighting
            ? 0x000000
            : new THREE.Color().setRGB(diffuse[0], diffuse[1], diffuse[2], THREE.LinearSRGBColorSpace),
      map: texture || null,
      opacity: THREE.MathUtils.clamp(packet.opacity ?? 1, 0, 1),
      transparent: !!packet.alphaBlend || (packet.opacity ?? 1) < 1,
      alphaTest: packet.alphaTest ? Math.max(packet.alphaThreshold || 0, 1 / 255) : 0,
      depthTest: packet.depthTest !== false,
      depthWrite: packet.depthWrite !== false,
      vertexColors: !replaceTexture && (diffuseVertexColors || emissiveVertexColors),
      wireframe: this.wireframe,
      side: sideForDrawMode(packet.drawMode),
    };
    const material = replaceTexture
      ? new THREE.MeshBasicMaterial(common)
      : new THREE.MeshPhongMaterial({
          ...common,
          emissive: new THREE.Color().setRGB(...(packet.emissive || [0, 0, 0]), THREE.LinearSRGBColorSpace),
          specular: new THREE.Color().setRGB(...(packet.specular || [0, 0, 0]), THREE.LinearSRGBColorSpace),
          shininess: THREE.MathUtils.clamp(packet.shininess || 0, 0, 100),
        });

    if (texture) applyTextureMapSettings(texture, packet.clampMode, packet.filterMode);
    if (!replaceTexture && emissiveVertexColors) applyEmissiveVertexColors(material);
    if (packet.alphaBlend) applyBlendMode(material, packet.sourceBlend, packet.destinationBlend);
    material.userData.clampMode = packet.clampMode;
    material.userData.filterMode = packet.filterMode;
    return material;
  }

  #disposeModel() {
    this.modelRoot.traverse((object) => {
      if (!object.isMesh && !object.isPoints) return;
      object.geometry?.dispose();
      object.skeleton?.dispose();
      const materials = new Set([
        ...(Array.isArray(object.material) ? object.material : [object.material]),
        object.userData.renderMaterial,
        object.userData.normalMaterial,
      ]);
      for (const material of materials) {
        if (!material) continue;
        material.dispose();
      }
    });
    for (const texture of this.loadedTextures || []) texture.dispose();
    this.loadedTextures = null;
    this.resolvedTextureMap = null;
    this.animationObjects = null;
    this.animationTargets = null;
    this.animations = null;
    this.idleAnimationGroup = null;
    this.skinBindings = null;
    this.modelRoot.clear();
  }

  #status(stage, message) {
    this.onStatus({ stage, message });
  }
}

function applyPacketTransform(object, values) {
  object.matrix.fromArray(values || new THREE.Matrix4().elements);
  object.matrixAutoUpdate = false;
  object.userData.animationBase = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
  object.matrix.decompose(
    object.userData.animationBase.position,
    object.userData.animationBase.quaternion,
    object.userData.animationBase.scale,
  );
}

function applyKeyframeTransform(target, data, time) {
  const base = target.userData.animationBase;
  if (!base) return;
  const translations = normalizeCurve(data.translations);
  const rotations = normalizeCurve(data.rotations);
  const scales = normalizeCurve(data.scales);
  const position = translations.keys.length
    ? sampleVectorCurve(translations, time, base.position.toArray())
    : base.position.toArray();
  const quaternion = rotations.keys.length
    ? sampleQuaternionCurve(rotations, time, base.quaternion.toArray())
    : base.quaternion.toArray();
  const scaleValue = scales.keys.length
    ? Math.abs(sampleScalarCurve(scales, time, base.scale.x))
    : null;
  const scale = scaleValue == null
    ? base.scale
    : new THREE.Vector3(scaleValue, scaleValue, scaleValue);
  target.matrix.compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion(...quaternion),
    scale,
  );
  target.matrixWorldNeedsUpdate = true;
}

function normalizeCurve(curve) {
  return Array.isArray(curve)
    ? { interpolation: 'Linear', keys: curve }
    : curve || { interpolation: 'Linear', keys: [] };
}

function createSkinBinding(geometry, material, skin) {
  const vertexCount = geometry.getAttribute('position')?.count || 0;
  if (!skin?.bones?.length
    || skin.indices?.length !== vertexCount * 4
    || skin.weights?.length !== vertexCount * 4) {
    return null;
  }

  const indices = skin.indices instanceof Uint16Array
    ? skin.indices
    : Uint16Array.from(skin.indices);
  const weights = skin.weights instanceof Float32Array
    ? skin.weights
    : Float32Array.from(skin.weights);
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));

  const skinTransform = new THREE.Matrix4().fromArray(skin.transform);
  const bindMatrix = skinTransform.clone().invert();
  const bones = skin.bones.map(() => new THREE.Bone());
  const boneInverses = skin.bones.map((bone) => new THREE.Matrix4()
    .fromArray(bone.transform)
    .multiply(skinTransform));
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bindMode = 'detached';
  mesh.bind(skeleton, bindMatrix);
  // The static geometry bounds describe the bind pose. Disable frustum culling
  // so an animated limb cannot disappear after deforming outside that box.
  mesh.frustumCulled = false;
  return {
    mesh,
    skeleton,
    rootNodeId: skin.rootNodeId,
    boneNodeIds: skin.bones.map(bone => bone.nodeId),
    rootParentInverse: new THREE.Matrix4(),
  };
}

function updateSkinBinding(binding, objects) {
  const rootNode = objects.get(binding.rootNodeId);
  const rootParent = rootNode?.parent || binding.mesh.parent;
  if (rootParent) binding.rootParentInverse.copy(rootParent.matrixWorld).invert();
  else binding.rootParentInverse.identity();

  for (let index = 0; index < binding.skeleton.bones.length; index += 1) {
    const boneNode = objects.get(binding.boneNodeIds[index]);
    const bone = binding.skeleton.bones[index];
    if (boneNode) {
      bone.matrixWorld.multiplyMatrices(binding.rootParentInverse, boneNode.matrixWorld);
    } else {
      // Synthetic unweighted vertices use an identity live-bone transform;
      // their adjusted inverse bind matrix cancels the overall skin transform.
      bone.matrixWorld.identity();
    }
  }
  binding.skeleton.update();
}

function renderObjectsBelow(targets) {
  const objects = new Set();
  for (const target of targets) {
    target.traverse((object) => {
      if (object.isMesh || object.isPoints) objects.add(object);
    });
  }
  return objects;
}

function setMaterialMap(material, texture) {
  material.map = texture;
  if (material.uniforms?.particleMap) {
    material.uniforms.particleMap.value = texture;
    material.uniforms.hasParticleMap.value = true;
  } else {
    material.needsUpdate = true;
  }
  applyTextureMapSettings(
    texture,
    material.userData?.clampMode,
    material.userData?.filterMode,
  );
}

function finiteAnimationStart(animation) {
  const value = Number(animation?.startTime);
  return Number.isFinite(value) ? value : 0;
}

function detectBacksideWithVisibilityMask({
  renderer,
  scene,
  camera,
  modelRoot,
  grid,
  axes,
}) {
  const target = thumbnailVisibilityRenderTarget();
  const originalQuaternion = modelRoot.quaternion.clone();
  const originalBackground = scene.background;
  const originalOverrideMaterial = scene.overrideMaterial;
  const originalRenderTarget = renderer.getRenderTarget();
  const originalClearColor = renderer.getClearColor(new THREE.Color());
  const originalClearAlpha = renderer.getClearAlpha();
  const originalAutoClear = renderer.autoClear;
  const originalScissorTest = renderer.getScissorTest();
  const originalViewport = renderer.getViewport(new THREE.Vector4());
  const originalScissor = renderer.getScissor(new THREE.Vector4());
  const originalGridVisible = grid.visible;
  const originalAxesVisible = axes.visible;
  const visibility = [];

  modelRoot.traverse(object => {
    if (!object.isMesh) return;
    visibility.push([object, object.visible]);
    // Detection intentionally excludes editor markers, collision, particles,
    // and hidden nodes even if the interactive viewer is showing them.
    object.visible = object.visible
      && object.userData.thumbnailGeometry === true
      && !object.userData.marker
      && !object.userData.collision
      && !object.userData.hidden;
  });

  try {
    grid.visible = false;
    axes.visible = false;
    scene.background = null;
    scene.overrideMaterial = THUMBNAIL_MASK_MATERIAL;
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);

    const current = renderThumbnailVisibilityCoverage({ renderer, scene, camera, modelRoot, target });
    applyThumbnailRotation(modelRoot, originalQuaternion, 180);
    const flipped = renderThumbnailVisibilityCoverage({ renderer, scene, camera, modelRoot, target });

    return {
      ...thumbnailOrientationFromCoverage(current.coverage, flipped.coverage),
      currentVisibleMeshPixels: current.visibleMeshPixels,
      currentProjectedBoundingBoxArea: current.projectedBoundingBoxArea,
      flippedVisibleMeshPixels: flipped.visibleMeshPixels,
      flippedProjectedBoundingBoxArea: flipped.projectedBoundingBoxArea,
    };
  } finally {
    modelRoot.quaternion.copy(originalQuaternion);
    modelRoot.updateWorldMatrix(true, true);
    for (const [object, visible] of visibility) object.visible = visible;
    grid.visible = originalGridVisible;
    axes.visible = originalAxesVisible;
    scene.background = originalBackground;
    scene.overrideMaterial = originalOverrideMaterial;
    renderer.setRenderTarget(originalRenderTarget);
    renderer.setViewport(originalViewport);
    renderer.setScissor(originalScissor);
    renderer.setScissorTest(originalScissorTest);
    renderer.setClearColor(originalClearColor, originalClearAlpha);
    renderer.autoClear = originalAutoClear;
  }
}

function renderThumbnailVisibilityCoverage({ renderer, scene, camera, modelRoot, target }) {
  modelRoot.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(
    target,
    0,
    0,
    THUMBNAIL_ORIENTATION_RENDER_SIZE,
    THUMBNAIL_ORIENTATION_RENDER_SIZE,
    THUMBNAIL_MASK_PIXELS,
  );

  let visibleMeshPixels = 0;
  for (let offset = 3; offset < THUMBNAIL_MASK_PIXELS.length; offset += 4) {
    if (THUMBNAIL_MASK_PIXELS[offset] !== 0) visibleMeshPixels += 1;
  }
  const projectedBoundingBoxArea = projectedVisibleMeshBoundsArea(modelRoot, camera);
  return {
    visibleMeshPixels,
    projectedBoundingBoxArea,
    coverage: projectedBoundingBoxArea > 0
      ? visibleMeshPixels / projectedBoundingBoxArea
      : 0,
  };
}

function projectedVisibleMeshBoundsArea(modelRoot, camera) {
  const box = new THREE.Box3();
  const objectBox = new THREE.Box3();
  modelRoot.traverse(object => {
    if (!object.isMesh || !object.visible || object.userData.thumbnailGeometry !== true) return;
    objectBox.setFromObject(object);
    if (!objectBox.isEmpty()) box.union(objectBox);
  });
  if (box.isEmpty()) return 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const point = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        point.set(x, y, z).project(camera);
        if (![point.x, point.y].every(Number.isFinite)) continue;
        const screenX = (point.x * 0.5 + 0.5) * THUMBNAIL_ORIENTATION_RENDER_SIZE;
        const screenY = (point.y * 0.5 + 0.5) * THUMBNAIL_ORIENTATION_RENDER_SIZE;
        minX = Math.min(minX, screenX);
        minY = Math.min(minY, screenY);
        maxX = Math.max(maxX, screenX);
        maxY = Math.max(maxY, screenY);
      }
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return 0;
  minX = THREE.MathUtils.clamp(minX, 0, THUMBNAIL_ORIENTATION_RENDER_SIZE);
  minY = THREE.MathUtils.clamp(minY, 0, THUMBNAIL_ORIENTATION_RENDER_SIZE);
  maxX = THREE.MathUtils.clamp(maxX, 0, THUMBNAIL_ORIENTATION_RENDER_SIZE);
  maxY = THREE.MathUtils.clamp(maxY, 0, THUMBNAIL_ORIENTATION_RENDER_SIZE);
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function applyThumbnailRotation(modelRoot, originalQuaternion, rotationY) {
  modelRoot.quaternion.copy(originalQuaternion);
  const radians = THREE.MathUtils.degToRad(Number(rotationY) || 0);
  if (radians) {
    modelRoot.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(THUMBNAIL_VERTICAL_AXIS, radians),
    );
  }
  modelRoot.updateWorldMatrix(true, true);
}

function thumbnailVisibilityRenderTarget() {
  if (thumbnailMaskRenderTarget) return thumbnailMaskRenderTarget;
  thumbnailMaskRenderTarget = new THREE.WebGLRenderTarget(
    THUMBNAIL_ORIENTATION_RENDER_SIZE,
    THUMBNAIL_ORIENTATION_RENDER_SIZE,
    {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    },
  );
  thumbnailMaskRenderTarget.texture.name = 'OAAB thumbnail visibility mask';
  thumbnailMaskRenderTarget.texture.colorSpace = THREE.NoColorSpace;
  return thumbnailMaskRenderTarget;
}

function createNormalInspectorMaterial(sourceMaterial, wireframe) {
  const material = new THREE.MeshNormalMaterial({
    side: sourceMaterial.side,
    wireframe,
    depthTest: sourceMaterial.depthTest,
    depthWrite: sourceMaterial.depthWrite,
  });
  material.userData.normalInspector = true;
  return material;
}

function createParticleGeometry(packet) {
  const positions = packet.positions instanceof Float32Array
    ? packet.positions
    : Float32Array.from(packet.positions || []);
  const count = Math.floor(positions.length / 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 4);
  let maxSize = 0;

  for (let index = 0; index < count; index += 1) {
    const size = Number(packet.sizes?.[index]);
    sizes[index] = Number.isFinite(size) ? size : 1;
    maxSize = Math.max(maxSize, Math.abs(sizes[index]));
    for (let channel = 0; channel < 4; channel += 1) {
      const value = Number(packet.colors?.[index * 4 + channel]);
      colors[index * 4 + channel] = Number.isFinite(value) ? value : 1;
    }
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
     1, -1, 0,
     1,  1, 0,
    -1,  1, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2));
  geometry.setAttribute('particlePosition', new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute('particleSize', new THREE.InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('particleColor', new THREE.InstancedBufferAttribute(colors, 4));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;

  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let index = 0; index < count; index += 1) {
    point.fromArray(positions, index * 3);
    if ([point.x, point.y, point.z].every(Number.isFinite)) bounds.expandByPoint(point);
  }
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3());

  const transform = new THREE.Matrix4().fromArray(packet.transform || new THREE.Matrix4().elements);
  const transformScale = new THREE.Vector3();
  transform.decompose(new THREE.Vector3(), new THREE.Quaternion(), transformScale);
  const nodeScale = Math.max(
    Math.abs(transformScale.x),
    Math.abs(transformScale.y),
    Math.abs(transformScale.z),
  );
  const radius = Number.isFinite(packet.radius) ? Math.abs(packet.radius) : 0;
  // The original point renderer transforms its camera basis into model space
  // with the node scale, then transforms the completed quad back again. Its
  // observable world-space sprite extent therefore scales by s².
  bounds.expandByScalar(radius * maxSize * (Number.isFinite(nodeScale) ? nodeScale : 1));
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

function createParticleMaterial(particlePacket, texture, expectedTexture, wireframe) {
  const packet = particlePacket.material;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      particleMap: { value: texture || null },
      hasParticleMap: { value: !!texture },
      expectedTexture: { value: expectedTexture },
      applyReplace: { value: expectedTexture && packet.applyMode === 'Replace' },
      particleRadius: {
        value: Number.isFinite(particlePacket.radius) ? particlePacket.radius : 0,
      },
      fallbackColor: { value: new THREE.Color(FALLBACK_COLOR) },
      alphaTestMode: { value: alphaTestMode(packet) },
      alphaThreshold: {
        value: THREE.MathUtils.clamp(Number(packet.alphaThreshold) || 0, 0, 1),
      },
    },
    vertexShader: `
      attribute vec3 particlePosition;
      attribute float particleSize;
      attribute vec4 particleColor;
      varying vec2 vParticleUv;
      varying vec4 vParticleColor;
      uniform float particleRadius;

      void main() {
        vParticleUv = uv;
        vParticleColor = particleColor;
        vec4 modelViewCenter = modelViewMatrix * vec4(particlePosition, 1.0);
        float nodeScale = length(modelMatrix[0].xyz);
        float halfExtent = particleRadius * particleSize * nodeScale * nodeScale;
        modelViewCenter.xy += position.xy * halfExtent;
        gl_Position = projectionMatrix * modelViewCenter;
      }
    `,
    fragmentShader: `
      varying vec2 vParticleUv;
      varying vec4 vParticleColor;
      uniform sampler2D particleMap;
      uniform bool hasParticleMap;
      uniform bool expectedTexture;
      uniform bool applyReplace;
      uniform vec3 fallbackColor;
      uniform int alphaTestMode;
      uniform float alphaThreshold;

      bool passesAlphaTest(float alpha) {
        if (alphaTestMode == 1) return true;
        if (alphaTestMode == 2) return alpha < alphaThreshold;
        if (alphaTestMode == 3) return alpha == alphaThreshold;
        if (alphaTestMode == 4) return alpha <= alphaThreshold;
        if (alphaTestMode == 5) return alpha > alphaThreshold;
        if (alphaTestMode == 6) return alpha != alphaThreshold;
        if (alphaTestMode == 7) return alpha >= alphaThreshold;
        return alphaTestMode != 8;
      }

      void main() {
        vec4 textureColor = hasParticleMap
          ? texture2D(particleMap, vParticleUv)
          : vec4(expectedTexture ? fallbackColor : vec3(1.0), 1.0);
        vec4 outgoingColor = applyReplace
          ? textureColor
          : textureColor * vParticleColor;
        if (alphaTestMode != 0 && !passesAlphaTest(outgoingColor.a)) discard;
        gl_FragColor = outgoingColor;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: !!packet.alphaBlend,
    depthTest: packet.depthTest !== false,
    depthWrite: packet.depthWrite !== false,
    side: sideForDrawMode(packet.drawMode),
    wireframe,
    toneMapped: false,
  });
  material.map = texture || null;
  material.userData.nifParticle = true;
  material.userData.clampMode = packet.clampMode;
  material.userData.filterMode = packet.filterMode;
  if (texture) applyTextureMapSettings(texture, packet.clampMode, packet.filterMode);
  if (packet.alphaBlend) {
    applyBlendMode(material, packet.sourceBlend, packet.destinationBlend);
  }
  return material;
}

function alphaTestMode(packet) {
  if (!packet.alphaTest) return 0;
  return {
    Always: 1,
    Less: 2,
    Equal: 3,
    LessEqual: 4,
    Greater: 5,
    NotEqual: 6,
    GreaterEqual: 7,
    Never: 8,
  }[packet.alphaTestMode] ?? 1;
}

function sideForDrawMode(mode) {
  if (mode === 'Both') return THREE.DoubleSide;
  if (mode === 'Clockwise') return THREE.BackSide;
  return THREE.FrontSide;
}

function applyTextureMapSettings(texture, clampMode, filterMode) {
  texture.wrapS = clampMode === 'ClampSClampT' || clampMode === 'ClampSWrapT'
    ? THREE.ClampToEdgeWrapping
    : THREE.RepeatWrapping;
  texture.wrapT = clampMode === 'ClampSClampT' || clampMode === 'WrapSClampT'
    ? THREE.ClampToEdgeWrapping
    : THREE.RepeatWrapping;
  if (filterMode === 'Nearest') {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
  } else if (filterMode === 'Bilerp') {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
  }
  texture.needsUpdate = true;
}

function applyBlendMode(material, source, destination) {
  const factors = {
    One: THREE.OneFactor,
    Zero: THREE.ZeroFactor,
    SrcColor: THREE.SrcColorFactor,
    InvSrcColor: THREE.OneMinusSrcColorFactor,
    DstColor: THREE.DstColorFactor,
    InvDstColor: THREE.OneMinusDstColorFactor,
    SrcAlpha: THREE.SrcAlphaFactor,
    InvSrcAlpha: THREE.OneMinusSrcAlphaFactor,
    DstAlpha: THREE.DstAlphaFactor,
    InvDstAlpha: THREE.OneMinusDstAlphaFactor,
    SrcAlphaSat: THREE.SrcAlphaSaturateFactor,
  };
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = factors[source] ?? THREE.SrcAlphaFactor;
  material.blendDst = factors[destination] ?? THREE.OneMinusSrcAlphaFactor;
}

function applyEmissiveVertexColors(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        totalEmissiveRadiance = vColor.rgb;
        #ifdef USE_COLOR_ALPHA
          diffuseColor.a *= vColor.a;
        #endif
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'nif-emissive-vertex-colors-v1';
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}
