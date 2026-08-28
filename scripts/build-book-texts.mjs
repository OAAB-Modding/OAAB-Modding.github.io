import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initSync, parse_plugin } from '../wasm/pkg/oaab_tes3_wasm.js';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = resolve(ROOT, 'assets/data/library');
const SPECS = [
  ['oaab', 'OAAB_Data_filtered.json'],
  ['morrowind', 'Morrowind_filtered.json'],
  ['tribunal', 'Tribunal_filtered.json'],
  ['bloodmoon', 'Bloodmoon_filtered.json'],
];

function sourceArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(argv[index]);
    if (!match) continue;
    const value = match[2] == null ? argv[++index] : match[2];
    if (value) values.set(match[1], resolve(value));
  }
  return values;
}

function topLevelRecords(json) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push([start, index + 1]);
        start = -1;
      }
    }
  }
  return spans;
}

function withBookText(source, text, newline) {
  const property = `    "text": ${JSON.stringify(text)}`;
  const existing = /\r?\n    "text": "(?:\\.|[^"\\])*",(?=\r?\n)/;
  if (existing.test(source)) return source.replace(existing, `${newline}${property},`);
  const data = /\r?\n    "data":/;
  if (data.test(source)) return source.replace(data, `${newline}${property},${newline}    "data":`);
  return source.replace(/\r?\n  }$/, `${newline}${property}${newline}  }`);
}

async function updateSnapshot(sourcePath, snapshotName) {
  const packet = JSON.parse(parse_plugin(readFileSync(sourcePath)));
  const texts = new Map(packet.records
    .filter(record => record.type === 'Book' && record.id)
    .map(record => [record.id.toLowerCase(), String(record.raw?.text || '')]));
  const snapshotPath = resolve(DATA, snapshotName);
  const json = await readFile(snapshotPath, 'utf8');
  const newline = json.includes('\r\n') ? '\r\n' : '\n';
  let updated = 0;
  let missing = 0;
  let cursor = 0;
  let output = '';
  for (const [start, end] of topLevelRecords(json)) {
    output += json.slice(cursor, start);
    const source = json.slice(start, end);
    const record = JSON.parse(source);
    if (String(record.type || '').toLowerCase() !== 'book') {
      output += source;
      cursor = end;
      continue;
    }
    const text = texts.get(String(record.id || '').toLowerCase());
    if (text == null) {
      missing += 1;
      output += source;
      cursor = end;
      continue;
    }
    updated += 1;
    output += withBookText(source, text, newline);
    cursor = end;
  }
  output += json.slice(cursor);
  if (missing) throw new Error(`${snapshotName}: ${missing} book records were not found in ${sourcePath}`);
  await writeFile(snapshotPath, output);
  return `${snapshotName}: embedded text for ${updated} books`;
}

const sources = sourceArguments(process.argv.slice(2));
if (!sources.size) {
  console.error('Usage: node scripts/build-book-texts.mjs --oaab OAAB_Data.esm --morrowind Morrowind.esm --tribunal Tribunal.esm --bloodmoon Bloodmoon.esm');
  process.exitCode = 1;
} else {
  initSync({ module: readFileSync(resolve(ROOT, 'wasm/pkg/oaab_tes3_wasm_bg.wasm')) });
  for (const [key, snapshot] of SPECS) {
    const sourcePath = sources.get(key);
    if (!sourcePath) continue;
    console.log(await updateSnapshot(sourcePath, snapshot));
  }
}
