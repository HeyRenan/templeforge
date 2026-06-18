import test from 'node:test';
import assert from 'node:assert';
import { execFileSync, } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Exercise the mr-build CLI end to end for its documented exit contract
// (0 PASS, 1 error, 2 usage) — the part the pure-function tests can't reach.
// Uses TEMPLEFORGE_TEMPLATE so it never depends on a repo's .templeforge file.

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'mr-build.mjs');

function run(args, env = {}) {
  try {
    const out = execFileSync('node', [BIN, ...args], {
      encoding: 'utf8', env: { ...process.env, ...env },
    });
    return { out: out.trim(), code: 0 };
  } catch (e) {
    return { out: ((e.stdout || '') + (e.stderr || '')).trim(), code: e.status };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), 'mrcli-')); }

const TPL = JSON.stringify({
  name: 't', topLine: 'Wrike: {wrike_url}',
  sections: [{ id: 'summary', title: 'Summary', required: true }],
  global: {},
});

test('mr-build CLI: valid input exits 0 with PASS', () => {
  const d = tmp();
  const tpl = join(d, 'tpl.json'); writeFileSync(tpl, TPL);
  const sec = join(d, 's.md'); writeFileSync(sec, 'Adds the thing.');
  const out = join(d, 'desc.md');
  const r = run(['--template', tpl, '--section', `summary=${sec}`, '--out', out], { TEMPLEFORGE_TEMPLATE: '' });
  assert.equal(r.code, 0);
  assert.match(r.out, /PASS/);
});

test('mr-build CLI: no --out exits 2 (usage)', () => {
  const r = run(['--section', 'summary=x.md'], { TEMPLEFORGE_TEMPLATE: '' });
  assert.equal(r.code, 2);
  assert.match(r.out, /usage/);
});

test('mr-build CLI: required section missing exits 1 (validation)', () => {
  const d = tmp();
  const tpl = join(d, 'tpl.json');
  writeFileSync(tpl, JSON.stringify({
    name: 't', sections: [{ id: 'summary', title: 'Summary', required: true }], global: {},
  }));
  const out = join(d, 'desc.md');
  const r = run(['--template', tpl, '--out', out], { TEMPLEFORGE_TEMPLATE: '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /required section missing/);
});

test('mr-build CLI: unreadable section file exits 1 with a clear message', () => {
  const d = tmp();
  const tpl = join(d, 'tpl.json'); writeFileSync(tpl, TPL);
  const out = join(d, 'desc.md');
  const r = run(['--template', tpl, '--section', 'summary=NOPE.md', '--out', out], { TEMPLEFORGE_TEMPLATE: '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /section "summary".*can't be read/);
});
