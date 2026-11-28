// Builds docs/architecture/viewer.html from the Markdown files in this folder.
// Usage (from the repo root): node docs/architecture/build-viewer.mjs
// No dependencies. The page loads the Mermaid and marked libraries from cdnjs when it is opened.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

const DOCS = [
  ['README', 'Start here'],
  ['01-system-context', 'Level 1: Context'],
  ['02-containers', 'Level 2: Containers'],
  ['03-frontend-components', 'Level 3: Frontend'],
  ['04-backend-components', 'Level 3: Backend'],
  ['05-dynamic-flows', 'Dynamic flows'],
  ['06-dev-environment', 'Dev environment'],
  ['FINDINGS', 'Findings'],
];

const docs = DOCS.map(([name, label]) => {
  const markdown = readFileSync(join(dir, `${name}.md`), 'utf8');
  return { name, label, markdown };
});

const stamp = /Verified against `develop` commit `([0-9a-f]+)` on (\d{4}-\d{2}-\d{2})/.exec(docs[0].markdown);
const meta = { sha: stamp ? stamp[1] : 'unknown', date: stamp ? stamp[2] : 'unknown' };

const template = readFileSync(join(dir, 'viewer.template.html'), 'utf8');
// "<" is escaped so the embedded JSON can never close the script tag.
const data = JSON.stringify({ docs, meta }).replace(/</g, '\\u003c');
const fragment = template.replace('__DATA__', () => data);

// The template is a page fragment (title, styles, body). viewer.html wraps it in a full document.
const split = fragment.indexOf('<header class="top">');
const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n';
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
const full = head + viewport + fragment.slice(0, split) + '</head>\n<body>\n' + fragment.slice(split) + '</body>\n</html>\n';
writeFileSync(join(dir, 'viewer.html'), full);

// Optional: node build-viewer.mjs --fragment <path> also writes the bare fragment (for publishing as an Artifact).
const flag = process.argv.indexOf('--fragment');
if (flag !== -1 && process.argv[flag + 1]) writeFileSync(process.argv[flag + 1], fragment);

console.log(`viewer.html written (${docs.length} documents, develop ${meta.sha}, ${meta.date})`);
