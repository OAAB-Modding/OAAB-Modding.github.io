#!/usr/bin/env node
/**
 * build-thumbnail-paths.mjs
 * -------------------------------------------------------------------------
 * Writes the Library thumbnail manifest used for case-insensitive lookups in
 * library/index.html. The manifest stores each thumbnail's real repo path
 * relative to assets/images/library/thumbnails/meshes/.
 */

import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THUMB_ROOT = join(ROOT, 'assets/images/library/thumbnails/meshes');
const OUT = join(ROOT, 'assets/data/library/thumbnail-paths.json');

async function webpFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await webpFiles(path));
    } else if (entry.isFile() && /\.webp$/i.test(entry.name)) {
      out.push(relative(THUMB_ROOT, path).split(sep).join('/'));
    }
  }
  return out;
}

const paths = (await webpFiles(THUMB_ROOT)).sort((a, b) => a.localeCompare(b));
await writeFile(OUT, JSON.stringify(paths, null, 2) + '\n');
console.log(`Wrote ${OUT} - ${paths.length} thumbnail paths.`);
