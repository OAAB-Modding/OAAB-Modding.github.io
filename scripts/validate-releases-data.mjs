#!/usr/bin/env node
/**
 * Fails if generated release data contains GitHub attachment URLs that are
 * likely to expire after the workflow commits them.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const releasesApi = require('../releases-data.js');

const EXPIRING_URL_RE = /(?:private-user-images\.githubusercontent\.com|X-Amz-|[?&](?:jwt|Expires|Signature|Policy|Key-Pair-Id)=)/i;
const SIGNED_CANONICAL_ATTACHMENT_RE = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}\?/i;

function visit(value, path, errors) {
  if (typeof value === 'string') {
    if (EXPIRING_URL_RE.test(value) || SIGNED_CANONICAL_ATTACHMENT_RE.test(value)) {
      errors.push(path);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => visit(item, `${path}[${i}]`, errors));
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => visit(item, `${path}.${key}`, errors));
  }
}

const errors = [];
visit(releasesApi.all || [], 'releases', errors);

if (errors.length) {
  console.error('Found expiring or signed GitHub attachment URLs in releases-data.js:');
  errors.slice(0, 20).forEach(path => console.error(`- ${path}`));
  if (errors.length > 20) console.error(`...and ${errors.length - 20} more.`);
  process.exit(1);
}

console.log('Release data URL validation passed.');
