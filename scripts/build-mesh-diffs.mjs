#!/usr/bin/env node
/**
 * Regenerates assets/data/library/mesh_diff_<from>_to_<to>.json from the
 * OAAB-Modding/Data git tags. Tags named X.Y or X.Y.0 are treated as major
 * library releases; tags like X.Y.1 are ignored.
 *
 * The library only wants meshes from release package folders: "00 Core" and
 * numbered optional patches. Integration folders may contain copied OAAB mesh
 * paths that collide with real catalogue meshes after path normalization, so
 * they must be excluded at the source.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA_REPO = join(ROOT, '.tmp', 'OAAB_Data.git');
const DATA_REPO = process.env.OAAB_DATA_REPO || DEFAULT_DATA_REPO;
const OUT_DIR = join(ROOT, 'assets', 'data', 'library');

const TAG_VERSION_ALIASES = {
  // Public release 1.10.0 was tagged as 0.10.0 in OAAB-Modding/Data.
  '0.10.0': '1.10.0',
};

const MAJOR_TAG_RE = /^v?(\d+)\.(\d+)(?:\.0)?$/;
const RELEASE_MESH_RE = /^\d{2} [^/]+\/meshes\/.+\.nif$/i;
const ONLY_LATEST = process.argv.includes('--latest');
const MIN_VERSION = process.env.OAAB_MESH_DIFF_MIN_VERSION || '1.9.0';

function git(args) {
  return execFileSync('git', ['-C', DATA_REPO, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function normalizeTagVersion(tag) {
  const m = MAJOR_TAG_RE.exec(tag);
  if (!m) return null;
  const version = `${Number(m[1])}.${Number(m[2])}.0`;
  return TAG_VERSION_ALIASES[version] || version;
}

function versionParts(version) {
  const m = /^(\d+)\.(\d+)\.0$/.exec(version);
  if (!m) throw new Error(`Invalid major version: ${version}. Expected X.Y.0.`);
  return [Number(m[1]), Number(m[2])];
}

function compareVersion(a, b) {
  return a.major - b.major || a.minor - b.minor;
}

function majorTags() {
  const found = new Map();
  const [minMajor, minMinor] = versionParts(MIN_VERSION);
  const min = { major: minMajor, minor: minMinor };

  for (const tag of git(['tag', '--list']).split(/\r?\n/)) {
    if (!tag.trim()) continue;
    const version = normalizeTagVersion(tag.trim());
    if (!version) continue;

    const [major, minor] = version.split('.').map(Number);
    const score = /\.0$/.test(tag.trim()) ? 2 : 1;
    const current = found.get(version);
    if (!current || score > current.score) {
      found.set(version, { tag: tag.trim(), version, major, minor, score });
    }
  }

  return [...found.values()]
    .filter(t => compareVersion(t, min) >= 0)
    .sort(compareVersion);
}

function changedMeshes(from, to) {
  const diff = git(['diff', '--name-status', '--no-renames', from.tag, to.tag]);
  const meshes = [];

  for (const line of diff.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawStatus, ...paths] = line.split('\t');
    const statusCode = rawStatus[0];
    if (!['A', 'M', 'R', 'C'].includes(statusCode)) continue;

    const path = paths[paths.length - 1];
    if (!RELEASE_MESH_RE.test(path)) continue;

    meshes.push({
      status: statusCode === 'A' ? 'A' : 'M',
      path,
    });
  }

  return meshes;
}

function sameJsonFile(file, data) {
  if (!existsSync(file)) return false;
  try {
    const current = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return JSON.stringify(current) === JSON.stringify(data);
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(DATA_REPO)) {
    throw new Error(`Data repo not found: ${DATA_REPO}. Clone OAAB-Modding/Data there or set OAAB_DATA_REPO.`);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const chain = majorTags();
  if (chain.length < 2) {
    throw new Error(`Need at least two major Data tags in ${DATA_REPO}.`);
  }

  const pairs = ONLY_LATEST
    ? [[chain[chain.length - 2], chain[chain.length - 1]]]
    : chain.slice(1).map((to, i) => [chain[i], to]);

  for (const [from, to] of pairs) {
    const meshes = changedMeshes(from, to);
    const out = {
      from: from.version,
      to: to.version,
      range: `${from.version}..${to.version}`,
      count: meshes.length,
      meshes,
    };
    const file = join(OUT_DIR, `mesh_diff_${from.version}_to_${to.version}.json`);
    if (sameJsonFile(file, out)) {
      console.log(`${from.version} -> ${to.version}: ${meshes.length} meshes unchanged`);
    } else {
      await writeFile(file, JSON.stringify(out, null, 2) + '\n');
      console.log(`${from.version} -> ${to.version}: ${meshes.length} meshes updated`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
