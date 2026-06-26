#!/usr/bin/env node
/**
 * build-releases-data.mjs
 * -------------------------------------------------------------------------
 * Regenerates releases-data.js from OAAB-Modding/Data GitHub Discussions.
 *
 * Intended CI usage:
 *   GITHUB_TOKEN=... node scripts/build-releases-data.mjs
 *
 * The site consumes window.OAAB_RELEASES, so this script keeps that public API
 * stable while moving the source of truth to GitHub Discussions.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'releases-data.js');

const DATA_OWNER = process.env.RELEASE_DISCUSSIONS_OWNER || 'OAAB-Modding';
const DATA_REPO = process.env.RELEASE_DISCUSSIONS_REPO || 'Data';
const CATEGORY = (process.env.RELEASE_DISCUSSIONS_CATEGORY || 'announcements').toLowerCase();
const MAX_DISCUSSIONS = Number(process.env.RELEASE_DISCUSSIONS_MAX || 500);
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const API = 'https://api.github.com/graphql';
const VERSION_RE = /\bv?(\d+\.\d+\.\d+)\b/i;

if (!TOKEN) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required for the GitHub GraphQL API.');
}

async function graphql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const details = json.errors ? JSON.stringify(json.errors) : `${res.status} ${res.statusText}`;
    throw new Error(`GitHub GraphQL request failed: ${details}`);
  }
  return json.data;
}

async function fetchDiscussions() {
  const query = `
    query ReleaseDiscussions($owner: String!, $name: String!, $first: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        discussions(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            url
            createdAt
            updatedAt
            bodyHTML
            bodyText
            author { login }
            category { name slug }
            labels(first: 40) { nodes { name } }
          }
        }
      }
    }
  `;

  const discussions = [];
  let after = null;
  while (discussions.length < MAX_DISCUSSIONS) {
    const data = await graphql(query, {
      owner: DATA_OWNER,
      name: DATA_REPO,
      first: Math.min(100, MAX_DISCUSSIONS - discussions.length),
      after,
    });
    const conn = data.repository && data.repository.discussions;
    if (!conn) throw new Error(`Repository not found: ${DATA_OWNER}/${DATA_REPO}`);
    discussions.push(...(conn.nodes || []));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return discussions;
}

function categoryMatches(discussion) {
  const cat = discussion.category || {};
  return String(cat.slug || cat.name || '').toLowerCase() === CATEGORY;
}

function versionFromDiscussion(discussion) {
  const titleMatch = VERSION_RE.exec(discussion.title || '');
  if (titleMatch) return titleMatch[1];
  const bodyMatch = VERSION_RE.exec(discussion.bodyText || '');
  return bodyMatch ? bodyMatch[1] : null;
}

function sortKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function displayDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function excerptFromText(text) {
  const blocks = String(text || '')
    .split(/\n{2,}/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(s => !/^#+\s/.test(s))
    .filter(s => !/^[-*]\s/.test(s));
  const first = blocks[0] || '';
  if (first.length <= 240) return first;
  const clipped = first.slice(0, 240).replace(/\s+\S*$/, '');
  return clipped + '...';
}

function firstImage(html) {
  const m = /<img\b[^>]*\bsrc=(["'])(.*?)\1/i.exec(String(html || ''));
  return m ? m[2] : null;
}

function normalizeBody(html) {
  let out = String(html || '').trim();
  if (!out) return null;

  out = out
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');

  out = out.replace(/<a\b(?![^>]*\btarget=)/gi, '<a target="_blank"');
  out = out.replace(/<a\b(?![^>]*\brel=)/gi, '<a rel="noopener"');

  // GitHub emits plain paragraphs. Mark the first prose paragraph as the lead
  // so newly synced release pages keep the current visual hierarchy.
  out = out.replace(/<p(?![^>]*\bclass=)([^>]*)>(?!\s*(?:<a\b[^>]*>)?\s*<img\b)/i, '<p class="lead"$1>');
  return out;
}

function releaseFromDiscussion(discussion) {
  const version = versionFromDiscussion(discussion);
  if (!version) return null;

  const body = normalizeBody(discussion.bodyHTML);
  return {
    version,
    num: discussion.number,
    date: displayDate(discussion.createdAt),
    sort: sortKey(discussion.createdAt),
    author: (discussion.author && discussion.author.login) || 'OAAB',
    labels: ((discussion.labels && discussion.labels.nodes) || [])
      .map(label => label && label.name)
      .filter(Boolean),
    excerpt: excerptFromText(discussion.bodyText),
    cover: firstImage(body),
    body,
  };
}

function semverDesc(a, b) {
  const av = a.version.split('.').map(Number);
  const bv = b.version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return bv[i] - av[i];
  }
  return b.sort - a.sort;
}

function renderJs(releases) {
  const data = JSON.stringify(releases, null, 2);
  return `/* Auto-generated by scripts/build-releases-data.mjs.
   Source: https://github.com/${DATA_OWNER}/${DATA_REPO}/discussions/categories/${CATEGORY}
   Do not edit release entries by hand; edit the source GitHub Discussion instead. */
(function () {
  var RELEASES = ${data};

  RELEASES.sort(function (a, b) { return b.sort - a.sort; });

  var api = {
    all: RELEASES,
    byVersion: function (v) { for (var i = 0; i < RELEASES.length; i++) { if (RELEASES[i].version === v) return RELEASES[i]; } return null; },
    ghBase: 'https://github.com/${DATA_OWNER}/${DATA_REPO}/discussions/'
  };

  if (typeof window !== 'undefined') window.OAAB_RELEASES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
`;
}

async function main() {
  const discussions = await fetchDiscussions();
  const releasesByVersion = new Map();
  for (const discussion of discussions) {
    if (!categoryMatches(discussion)) continue;
    const release = releaseFromDiscussion(discussion);
    if (!release) continue;
    const existing = releasesByVersion.get(release.version);
    if (!existing || release.sort > existing.sort) {
      releasesByVersion.set(release.version, release);
    }
  }

  const releases = [...releasesByVersion.values()].sort(semverDesc);
  if (!releases.length) {
    throw new Error(`No semver release discussions found in ${DATA_OWNER}/${DATA_REPO} category "${CATEGORY}".`);
  }

  await writeFile(OUT, renderJs(releases), 'utf8');
  console.log(`Wrote ${OUT} - ${releases.length} releases from ${DATA_OWNER}/${DATA_REPO} discussions.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
