import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';

import { normalizeAssetPath } from '../resolver/path-utils.js';
import { Tes3WorkerClient } from '../workers/tes3-worker-client.js';

const FALLBACK_COLOR = 0xd45a8b;

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
    this.collisionVisible = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x17130f);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    this.camera.position.set(2, 1.4, 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;

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

    this.scene.add(new THREE.HemisphereLight(0xfff0d5, 0x392d28, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffdec0, 3.2);
    keyLight.position.set(3, 5, 4);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa9c7ff, 1.1);
    fillLight.position.set(-4, 2, -3);
    this.scene.add(fillLight);

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

  async load(path, { display = true, resolveTextures = true } = {}) {
    const generation = ++this.loadGeneration;
    const normalized = normalizeAssetPath(path, { root: 'meshes' });
    this.#status('resolving', `Resolving ${normalized}`);

    const startedAt = performance.now();
    const asset = await this.resolver.resolve(normalized);
    this.#status('parsing', `Parsing ${normalized} in WebAssembly`);
    const packet = await this.worker.parseNif(asset.bytes);

    if (generation !== this.loadGeneration) throw new Error('Load superseded by a newer request');

    const textureDiagnostics = resolveTextures
      ? await this.#resolveTextures(packet.textures || [], generation)
      : [];
    if (generation !== this.loadGeneration) throw new Error('Load superseded by a newer request');

    const result = {
      path: normalized,
      asset,
      packet,
      textureDiagnostics,
      elapsedMs: performance.now() - startedAt,
    };

    if (display) {
      this.#displayPacket(packet, textureDiagnostics);
      this.frameModel();
    } else {
      for (const diagnostic of textureDiagnostics) diagnostic.texture?.dispose();
    }

    this.#status('ready', `Loaded ${normalized}`);
    return result;
  }

  setWireframe(visible) {
    this.wireframe = !!visible;
    this.modelRoot.traverse((object) => {
      if (object.isMesh && object.material) object.material.wireframe = this.wireframe;
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
      if (object.isMesh && object.userData.collision) object.visible = this.collisionVisible;
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

  frameModel() {
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    this.modelRoot.position.sub(center);
    this.modelRoot.updateWorldMatrix(true, true);

    const centeredBox = new THREE.Box3().setFromObject(this.modelRoot);
    const sphere = centeredBox.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = new THREE.Vector3(1, 0.72, 1).normalize();

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
    const blob = new Blob([asset.bytes], { type: asset.mimeType });
    const url = URL.createObjectURL(blob);
    try {
      let texture;
      if (extension === 'dds') texture = await this.ddsLoader.loadAsync(url);
      else if (extension === 'tga') texture = await this.tgaLoader.loadAsync(url);
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

      const rawTexture = meshPacket.material.texture;
      let texturePath = null;
      try {
        if (rawTexture) texturePath = normalizeAssetPath(rawTexture, { root: 'textures' });
      } catch {}
      const texture = texturePath ? textures.get(texturePath) : null;
      const material = this.#createMaterial(meshPacket.material, texture, !!rawTexture);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = meshPacket.name || meshPacket.blockType;
      mesh.matrix.fromArray(meshPacket.transform);
      mesh.matrixAutoUpdate = false;
      mesh.userData.collision = !!meshPacket.collision;
      mesh.userData.hidden = !!meshPacket.hidden;
      mesh.visible = !meshPacket.hidden && (!meshPacket.collision || this.collisionVisible);
      this.modelRoot.add(mesh);
    }
  }

  #createMaterial(packet, texture, expectedTexture) {
    const diffuse = packet.diffuse || [1, 1, 1];
    const material = new THREE.MeshPhongMaterial({
      color: expectedTexture && !texture
        ? FALLBACK_COLOR
        : new THREE.Color().setRGB(diffuse[0], diffuse[1], diffuse[2], THREE.LinearSRGBColorSpace),
      emissive: new THREE.Color().setRGB(...(packet.emissive || [0, 0, 0]), THREE.LinearSRGBColorSpace),
      specular: new THREE.Color().setRGB(...(packet.specular || [0, 0, 0]), THREE.LinearSRGBColorSpace),
      shininess: THREE.MathUtils.clamp(packet.shininess || 0, 0, 100),
      map: texture || null,
      opacity: THREE.MathUtils.clamp(packet.opacity ?? 1, 0, 1),
      transparent: !!packet.alphaBlend || (packet.opacity ?? 1) < 1,
      alphaTest: packet.alphaTest ? Math.max(packet.alphaThreshold || 0, 1 / 255) : 0,
      depthTest: packet.depthTest !== false,
      depthWrite: packet.depthWrite !== false,
      vertexColors: packet.vertexColorMode !== 'Ignore',
      wireframe: this.wireframe,
      side: sideForDrawMode(packet.drawMode),
    });

    if (texture) applyTextureMapSettings(texture, packet.clampMode, packet.filterMode);
    if (packet.alphaBlend) applyBlendMode(material, packet.sourceBlend, packet.destinationBlend);
    return material;
  }

  #disposeModel() {
    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        material.dispose();
      }
    });
    for (const texture of this.loadedTextures || []) texture.dispose();
    this.loadedTextures = null;
    this.modelRoot.clear();
  }

  #status(stage, message) {
    this.onStatus({ stage, message });
  }
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
