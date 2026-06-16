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
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

export const STRICTNESS_LEVELS = ['loose', 'rich', 'strict'];

export const GLOBAL_STRICTNESS_FILE = join(homedir(), '.claude', 'templeforge', 'strictness');

export function readStrictnessDefault(globalFile = GLOBAL_STRICTNESS_FILE) {
  try {
    const v = readFileSync(globalFile, 'utf8').trim();
    if (v) return v;
  } catch { /* no global default set */ }
  return undefined;
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
  const sec = m.sections || {};
  if (!sec || typeof sec !== 'object' || !Object.keys(sec).length) {
    errors.push('sections (id -> file path map) is required and non-empty');
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
  const ship = ['bash', join(HERE, 'ship.sh'), '--slug', m.slug, '--title', m.title,
    '--desc', descPath, ...(m.project ? ['--project', m.project] : [])];
  const stages = [
    { id: 'forge', cmd: forge },
    { id: 'ship', cmd: ship },
  ];
  if (m.wrike) {
    stages.push({ id: 'wrike-link', cmd: ['node', join(HERE, 'wrike-link.mjs'), m.wrike, '{{MR_URL}}'] });
  }
  return stages;
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
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
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
      console.error('ship-flow: stage ' + s.id + ' FAILED — fix and re-run (earlier stages are idempotent).');
      process.exit(1);
    }
    process.stdout.write(out);
    if (s.id === 'ship') {
      mrUrl = (out.match(/https?:\/\/\S*\/(merge_requests|pull|pullrequest|pull-requests)\/\d+/) || [])[0]
        || (out.match(/https?:\/\/\S+/) || [])[0];
      if (!mrUrl) { console.error('ship-flow: could not extract the request url from ship output'); process.exit(1); }
    }
  }
  console.log('DONE ' + mrUrl);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
