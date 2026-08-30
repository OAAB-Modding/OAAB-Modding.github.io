import initWasm, {
  parse_nif as parseNif,
  parse_plugin as parsePlugin,
  parser_version as parserVersion,
} from '../../../wasm/pkg/oaab_tes3_wasm.js';

const ready = initWasm();

function typedRenderPacket(packet) {
  const transfers = [];
  for (const mesh of packet.meshes || []) {
    mesh.vertices = transferArray(Float32Array.from(mesh.vertices || []), transfers);
    mesh.normals = transferArray(Float32Array.from(mesh.normals || []), transfers);
    mesh.uvs = transferArray(Float32Array.from(mesh.uvs || []), transfers);
    mesh.colors = transferArray(Float32Array.from(mesh.colors || []), transfers);

    const values = mesh.indices || [];
    const maxIndex = values.reduce((max, value) => Math.max(max, value), 0);
    const IndexArray = maxIndex > 0xffff ? Uint32Array : Uint16Array;
    mesh.indices = transferArray(IndexArray.from(values), transfers);
    mesh.transform = transferArray(Float32Array.from(mesh.transform || []), transfers);
    mesh.localTransform = transferArray(Float32Array.from(mesh.localTransform || []), transfers);
    if (mesh.skin) {
      mesh.skin.indices = transferArray(Uint16Array.from(mesh.skin.indices || []), transfers);
      mesh.skin.weights = transferArray(Float32Array.from(mesh.skin.weights || []), transfers);
      mesh.skin.transform = transferArray(Float32Array.from(mesh.skin.transform || []), transfers);
      for (const bone of mesh.skin.bones || []) {
        bone.transform = transferArray(Float32Array.from(bone.transform || []), transfers);
      }
    }
  }
  for (const node of packet.nodes || []) {
    node.transform = transferArray(Float32Array.from(node.transform || []), transfers);
    node.localTransform = transferArray(Float32Array.from(node.localTransform || []), transfers);
  }
  for (const particle of packet.particles || []) {
    particle.positions = transferArray(Float32Array.from(particle.positions || []), transfers);
    particle.colors = transferArray(Float32Array.from(particle.colors || []), transfers);
    particle.sizes = transferArray(Float32Array.from(particle.sizes || []), transfers);
    particle.transform = transferArray(Float32Array.from(particle.transform || []), transfers);
    particle.localTransform = transferArray(Float32Array.from(particle.localTransform || []), transfers);
  }
  return { packet, transfers };
}

function transferArray(array, transfers) {
  if (array.byteLength) transfers.push(array.buffer);
  return array;
}

self.addEventListener('message', async (event) => {
  const { id, op, bytes } = event.data || {};
  if (!id) return;

  try {
    await ready;
    if (op === 'version') {
      self.postMessage({ id, ok: true, result: parserVersion() });
      return;
    }
    if (op === 'parsePlugin') {
      const json = parsePlugin(new Uint8Array(bytes));
      self.postMessage({ id, ok: true, result: JSON.parse(json) });
      return;
    }
    if (op !== 'parseNif') throw new Error(`Unknown TES3 worker operation: ${op}`);

    const json = parseNif(new Uint8Array(bytes));
    const { packet, transfers } = typedRenderPacket(JSON.parse(json));
    self.postMessage({ id, ok: true, result: packet }, transfers);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
