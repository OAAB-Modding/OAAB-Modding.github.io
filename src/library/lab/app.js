import { AssetResolver } from '../resolver/asset-resolver.js';
import { normalizeAssetPath } from '../resolver/path-utils.js';
import { NifViewer } from '../renderer/viewer.js';
import { OAABSource } from '../sources/oaab-source.js';

const elements = {
  form: document.querySelector('#load-form'),
  input: document.querySelector('#asset-path'),
  loadButton: document.querySelector('#load-button'),
  status: document.querySelector('#status'),
  fixtureSelect: document.querySelector('#fixture-select'),
  runFixtures: document.querySelector('#run-fixtures'),
  fixtureResults: document.querySelector('#fixture-results'),
  fixtureSummary: document.querySelector('#fixture-summary'),
  fixtureResultList: document.querySelector('#fixture-result-list'),
  assetInfo: document.querySelector('#asset-info'),
  geometryInfo: document.querySelector('#geometry-info'),
  textureSummary: document.querySelector('#texture-summary'),
  textureList: document.querySelector('#texture-list'),
  unsupportedList: document.querySelector('#unsupported-list'),
  warningList: document.querySelector('#warning-list'),
};

const resolver = new AssetResolver().addSource(new OAABSource(), 100);
const viewer = new NifViewer({
  canvas: document.querySelector('#nif-canvas'),
  resolver,
  onStatus: ({ stage, message }) => setStatus(stage, message),
});

let fixtures = [];

boot().catch(showError);

async function boot() {
  wireControls();
  fixtures = await fetch('./nif-fixtures.json').then((response) => response.json());
  renderFixtureOptions();
  const version = await viewer.parserVersion();
  setStatus('idle', `WASM parser ${version} ready`);

  const params = new URLSearchParams(location.search);
  const requested = params.get('mesh');
  if (requested) elements.input.value = requested;
  selectFixtureForPath(elements.input.value);
  await loadCurrent();
}

function wireControls() {
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadCurrent().catch(showError);
  });
  elements.fixtureSelect.addEventListener('change', () => {
    const fixture = fixtures[Number(elements.fixtureSelect.value)];
    if (!fixture) return;
    elements.input.value = fixture.path;
    loadCurrent().catch(showError);
  });
  elements.runFixtures.addEventListener('click', () => runFixtureCorpus().catch(showError));
  document.querySelector('#reset-camera').addEventListener('click', () => viewer.resetCamera());
  document.querySelector('#show-markers').addEventListener('change', (event) => viewer.setMarkersVisible(event.target.checked));
  document.querySelector('#wireframe').addEventListener('change', (event) => viewer.setWireframe(event.target.checked));
  document.querySelector('#inspect-normals').addEventListener('change', (event) => viewer.setNormalInspector(event.target.checked));
  document.querySelector('#show-grid').addEventListener('change', (event) => viewer.setGridVisible(event.target.checked));
  document.querySelector('#show-axes').addEventListener('change', (event) => viewer.setAxesVisible(event.target.checked));
  document.querySelector('#show-collision').addEventListener('change', (event) => viewer.setCollisionVisible(event.target.checked));
  document.querySelector('#background').addEventListener('input', (event) => viewer.setBackground(event.target.value));
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    if (window.OAAB_THEME) window.OAAB_THEME.set(window.OAAB_THEME.read() === 'light' ? 'dark' : 'light');
  });
  window.addEventListener('beforeunload', () => viewer.dispose(), { once: true });
}

async function loadCurrent() {
  setBusy(true);
  try {
    const path = normalizeAssetPath(elements.input.value, { root: 'meshes' });
    elements.input.value = path.replace(/^meshes\//, '');
    const url = new URL(location.href);
    url.searchParams.set('mesh', elements.input.value);
    history.replaceState(null, '', url);
    const result = await viewer.load(path);
    renderDiagnostics(result);
  } finally {
    setBusy(false);
  }
}

async function runFixtureCorpus() {
  setBusy(true);
  elements.fixtureResults.hidden = false;
  elements.fixtureResultList.replaceChildren();
  let passed = 0;

  try {
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index];
      setStatus('parsing', `Fixture ${index + 1}/${fixtures.length}: ${fixture.path}`);
      const row = document.createElement('li');
      row.innerHTML = `<span>…</span><span>${escapeHtml(fixture.path)}</span><span>running</span>`;
      elements.fixtureResultList.append(row);
      try {
        const result = await viewer.load(fixture.path, { display: false, resolveTextures: false });
        validateFixture(fixture, result.packet);
        row.className = 'pass';
        row.innerHTML = `<span>✓</span><span>${escapeHtml(fixture.path)}</span><span>${result.packet.stats.meshes} meshes · ${result.packet.stats.triangles} tris</span>`;
        passed += 1;
      } catch (error) {
        row.className = 'fail';
        row.innerHTML = `<span>×</span><span>${escapeHtml(fixture.path)}</span><span>${escapeHtml(error.message)}</span>`;
      }
      elements.fixtureSummary.textContent = `${passed}/${index + 1} passing`;
    }
    setStatus(passed === fixtures.length ? 'ready' : 'error', `${passed}/${fixtures.length} representative NIFs parsed`);
  } finally {
    setBusy(false);
  }
}

function validateFixture(fixture, packet) {
  const minMeshes = fixture.expect?.minMeshes ?? 1;
  const minTriangles = fixture.expect?.minTriangles ?? 1;
  const minParticles = fixture.expect?.minParticles ?? 0;
  const minAnimations = fixture.expect?.minAnimations ?? 0;
  if ((packet.stats?.meshes || 0) < minMeshes) {
    throw new Error(`expected at least ${minMeshes} renderable mesh`);
  }
  if ((packet.stats?.triangles || 0) < minTriangles) {
    throw new Error(`expected at least ${minTriangles} triangle`);
  }
  if ((packet.stats?.particles || 0) < minParticles) {
    throw new Error(`expected at least ${minParticles} particle`);
  }
  if ((packet.stats?.animations || 0) < minAnimations) {
    throw new Error(`expected at least ${minAnimations} animation controller`);
  }
  for (const block of fixture.expect?.blocks || []) {
    if (!packet.blockCounts?.[block]) throw new Error(`expected ${block}`);
  }
}

function renderFixtureOptions() {
  elements.fixtureSelect.replaceChildren(...fixtures.map((fixture, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${fixture.label} — ${fixture.path}`;
    return option;
  }));
}

function selectFixtureForPath(path) {
  let normalized;
  try {
    normalized = normalizeAssetPath(path, { root: 'meshes' });
  } catch {
    return;
  }
  const index = fixtures.findIndex((fixture) => (
    normalizeAssetPath(fixture.path, { root: 'meshes' }) === normalized
  ));
  if (index >= 0) elements.fixtureSelect.value = String(index);
}

function renderDiagnostics({ path, asset, packet, textureDiagnostics, elapsedMs }) {
  const stats = packet.stats || {};
  setDefinitionList(elements.assetInfo, [
    ['Path', path],
    ['Asset source', asset.sourceLabel || asset.source],
    ['Bytes', formatNumber(asset.size)],
    ['NIF version', packet.version],
    ['Load time', `${Math.round(elapsedMs)} ms`],
  ]);
  setDefinitionList(elements.geometryInfo, [
    ['Blocks', formatNumber(stats.blocks)],
    ['Nodes', formatNumber(stats.nodes)],
    ['Meshes', formatNumber(stats.meshes)],
    ['Particles', formatNumber(stats.particles)],
    ['Animations', formatNumber(stats.animations)],
    ['Vertices', formatNumber(stats.vertices)],
    ['Triangles', formatNumber(stats.triangles)],
  ]);

  const resolved = textureDiagnostics.filter((entry) => entry.status === 'resolved');
  const missing = textureDiagnostics.filter((entry) => entry.status === 'missing');
  elements.textureSummary.textContent = `Resolved ${resolved.length} · Missing ${missing.length}`;
  renderList(elements.textureList, textureDiagnostics.map((entry) => ({
    className: entry.status,
    text: `${entry.status === 'resolved' ? '✓' : '×'} ${entry.path || entry.rawPath}${entry.asset ? ` — ${entry.asset.sourceLabel || entry.asset.source}` : ''}`,
  })), 'No external textures');

  renderList(elements.unsupportedList, (packet.unsupportedBlocks || []).map((entry) => ({
    text: `${entry.blockType} × ${entry.count}`,
  })), 'None reported');
  renderList(elements.warningList, (packet.warnings || []).map((text) => ({ text })), 'None');
}

function setDefinitionList(element, rows) {
  element.replaceChildren(...rows.flatMap(([term, value]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value ?? '—';
    return [dt, dd];
  }));
}

function renderList(element, rows, emptyText) {
  const values = rows.length ? rows : [{ text: emptyText }];
  element.replaceChildren(...values.map(({ text, className = '' }) => {
    const item = document.createElement('li');
    item.className = className;
    item.textContent = text;
    return item;
  }));
}

function setBusy(busy) {
  elements.loadButton.disabled = busy;
  elements.runFixtures.disabled = busy;
}

function setStatus(stage, message) {
  elements.status.dataset.stage = stage;
  elements.status.textContent = message;
}

function showError(error) {
  console.error(error);
  setBusy(false);
  setStatus('error', error instanceof Error ? error.message : String(error));
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat().format(value) : '—';
}

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}
