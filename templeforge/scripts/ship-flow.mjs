#!/usr/bin/env node
// ship-flow.mjs — open the whole MR/PR in ONE command, driven by a manifest.
// Chains the already-tested tools: forge (render description from template) ->
// ship (branch/commit/push/open) -> wrike-link. Plain shell, no MCP, fails
// loudly at the first broken stage. Provider-agnostic (GitLab MR / GitHub PR /
// Bitbucket / Gitea / Azure — resolved by lib/host.mjs from the origin remote).
//
//   node ship-flow.mjs manifest.json [--dry-run]
//
// manifest.json:
// {
//   "wrike": "https://www.wrike.com/open.htm?id=123",   // optional top line
//   "title": "feat: thing",
//   "slug": "feat/thing",
//   "project": "group/repo",               // optional; else detected from remote
//   "draft": false,                         // optional; open as draft/WIP request
//   "strictness": "rich",                   // loose|rich|strict (absent = rich)
//   "template": "path/to/template.json",    // optional; else resolved (see forge)
//   "vars": { "ticket": "AB-12" },          // optional free key/value, fed to template
//   "sections": {                           // section id -> body file path
//     "summary": "summary.md",
//     "changes": "changes.md",
//     "testing": "testing.md"
//   }
// }
//
// templeforge renders a template and opens the request. It knows nothing about
// screenshots, video, or any capture tool — a section body is whatever you wrote.
//
// --dry-run prints the exact stage commands without executing anything.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STRICTNESS_LEVELS, GLOBAL_STRICTNESS_FILE, readStrictnessDefault } from '../lib/strictness.mjs';

// Re-export the strictness domain so existing importers of ship-flow keep working.
export { STRICTNESS_LEVELS, GLOBAL_STRICTNESS_FILE, readStrictnessDefault };

const HERE = dirname(fileURLToPath(import.meta.url));

// Read + parse a manifest file with friendly errors — the manifest is
// hand-written, so a missing path or a JSON typo are the common mistakes and
// deserve a clear message, not a raw ENOENT / SyntaxError.
export function loadManifest(path, readFile = (p) => readFileSync(p, 'utf8')) {
  let raw;
  try {
    raw = readFile(path);
  } catch {
    throw new Error('manifest not found: ' + path);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('manifest is not valid JSON (' + path + '): ' + e.message);
  }
}

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest must be a JSON object'];
  for (const k of ['title', 'slug']) {
    if (!m[k]) errors.push('missing required field: ' + k);
  }
  if (m.strictness != null && !STRICTNESS_LEVELS.includes(m.strictness)) {
    errors.push('strictness must be one of loose|rich|strict, got: ' + m.strictness);
  }
  const isPlainObject = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  const sec = m.sections;
  if (!isPlainObject(sec) || !Object.keys(sec).length) {
    errors.push('sections (id -> file path map) is required and non-empty');
  } else if (!Object.values(sec).every((v) => typeof v === 'string' && v.trim())) {
    errors.push('every sections entry must be a string file path');
  }
  if (m.vars != null && !isPlainObject(m.vars)) {
    errors.push('vars must be an object map of key -> value');
  }
  return errors;
}

// Ordered stage plan. Pure: no I/O, fully unit-testable.
export function buildPlan(m, { descPath = 'mr-desc.md' } = {}) {
  const sectionArgs = [];
  for (const [id, file] of Object.entries(m.sections || {})) {
    sectionArgs.push('--section', id + '=' + file);
  }
  const varArgs = [];
  for (const [k, val] of Object.entries(m.vars || {})) {
    varArgs.push('--var', k + '=' + String(val));
  }
  const forge = ['node', join(HERE, 'mr-build.mjs'),
    ...(m.wrike ? ['--wrike', m.wrike] : []),
    ...(m.template ? ['--template', m.template] : []),
    ...sectionArgs, ...varArgs, '--out', descPath];
  // ship.mjs is the one true ship driver — it routes all five providers via
  // lib/host.mjs. (ship.sh is a thin back-compat shim that execs this same file.)
  const ship = ['node', join(HERE, 'ship.mjs'), '--slug', m.slug, '--title', m.title,
    '--desc', descPath,
    ...(m.project ? ['--project', m.project] : []),
    ...(m.draft ? ['--draft'] : [])];
  const stages = [
    { id: 'forge', cmd: forge },
    { id: 'ship', cmd: ship },
  ];
  if (m.wrike) {
    stages.push({ id: 'wrike-link', cmd: ['node', join(HERE, 'wrike-link.mjs'), m.wrike, '{{MR_URL}}'] });
  }
  return stages;
}

// Pull the opened request's web url out of the ship stage's stdout. Each forge's
// url carries a recognizable "<verb>/<number>" tail: GitLab merge_requests,
// GitHub pull, Bitbucket pull-requests, Gitea pulls, Azure pullrequest. Prefer
// that precise shape; fall back to the first absolute url only if none matched.
const REQUEST_URL_RE =
  /https?:\/\/\S*\/(?:merge_requests|pull-requests|pullrequest|pulls|pull)\/\d+/;

export function extractRequestUrl(out) {
  const s = String(out || '');
  return (s.match(REQUEST_URL_RE) || [])[0] || (s.match(/https?:\/\/\S+/) || [])[0] || null;
}

// Strictness lint: pure, never fails the run. Printed as `LINT <level>: <msg>`.
export function lintStrictness(m) {
  if (!m || typeof m !== 'object') return [];
  const level = STRICTNESS_LEVELS.includes(m.strictness) ? m.strictness : 'rich';
  const sections = m.sections || {};
  const out = [];
  const ids = Object.keys(sections);
  if (level === 'strict') {
    if (!m.wrike) out.push('strict level: no wrike url on the top line');
    if (ids.length < 2) out.push('strict level: only one section — a request usually needs summary + testing');
  } else if (level === 'rich') {
    if (!m.wrike) out.push('rich level: consider a wrike url for the top line');
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const manifestPath = argv.find((x) => !x.startsWith('--'));
  if (!manifestPath) {
    console.error('usage: ship-flow.mjs manifest.json [--dry-run]');
    process.exit(2);
  }
  const m = loadManifest(manifestPath);
  // strictness default: `/templeforge:strictness <level>` writes the GLOBAL file —
  // a machine-wide preference, never per-repo scratch. An explicit manifest wins.
  if (m.strictness == null) m.strictness = readStrictnessDefault();
  const errors = validateManifest(m);
  if (errors.length) {
    errors.forEach((e) => console.error('ship-flow: ' + e));
    process.exit(2);
  }
  const stages = buildPlan(m);
  const level = m.strictness || 'rich';
  for (const msg of lintStrictness(m)) console.error('LINT ' + level + ': ' + msg);

  if (dry) {
    console.log('ship-flow plan (' + stages.length + ' stages):');
    for (const s of stages) console.log('  [' + s.id + '] ' + s.cmd.join(' '));
    return;
  }

  let mrUrl = null;
  for (const s of stages) {
    const cmd = s.cmd.map((c) => (c === '{{MR_URL}}' ? mrUrl : c));
    console.error('ship-flow: [' + s.id + '] ' + cmd.join(' '));
    let out;
    try {
      out = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    } catch (e) {
      // The failing stage's own stderr already streamed (stdio inherit); add its
      // exit code so log/CI scrapes of ship-flow's output carry the failure too.
      const code = typeof e.status === 'number' ? e.status : 1;
      console.error('ship-flow: stage ' + s.id + ' FAILED (exit ' + code + ') — fix and re-run (earlier stages are idempotent).');
      process.exit(code || 1);
    }
    process.stdout.write(out);
    if (s.id === 'ship') {
      mrUrl = extractRequestUrl(out);
      if (!mrUrl) { console.error('ship-flow: could not extract the request url from ship output'); process.exit(1); }
    }
  }
  // The rendered description file is left on disk (it's the request body that was
  // sent — handy to inspect). It's a generated artifact, so note it: a user who
  // doesn't want it committed should gitignore it.
  console.error('ship-flow: rendered description left at mr-desc.md (a generated artifact — gitignore it if you keep one)');
  console.log('DONE ' + mrUrl);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
