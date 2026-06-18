import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ship-flow CLI exit contract end to end — the orchestrator's exit codes gate CI,
// so lock them: 2 usage/bad-manifest, 0 dry-run, non-zero stage failure (and the
// failure must stop before the ship stage runs). TEMPLEFORGE_TEMPLATE='' keeps it
// independent of any repo .templeforge file.

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'ship-flow.mjs');

function run(args, env = {}) {
  try {
    const out = execFileSync('node', [BIN, ...args], {
      encoding: 'utf8', env: { ...process.env, TEMPLEFORGE_TEMPLATE: '', ...env },
    });
    return { out: out.trim(), code: 0 };
  } catch (e) {
    return { out: ((e.stdout || '') + (e.stderr || '')).trim(), code: e.status };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), 'sfcli-')); }

test('ship-flow CLI: no manifest exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.out, /usage/);
});

test('ship-flow CLI: missing manifest file exits with a clear error', () => {
  const r = run(['/no/such/manifest.json']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /manifest not found/);
});

test('ship-flow CLI: invalid manifest (no title/slug) exits 2', () => {
  const d = tmp();
  const m = join(d, 'm.json'); writeFileSync(m, JSON.stringify({ sections: { summary: 's.md' } }));
  const r = run([m]);
  assert.equal(r.code, 2);
  assert.match(r.out, /missing required field/);
});

test('ship-flow CLI: --dry-run prints the plan and exits 0', () => {
  const d = tmp();
  const m = join(d, 'm.json');
  writeFileSync(m, JSON.stringify({ title: 't', slug: 'feat/x', sections: { summary: 's.md' } }));
  const r = run([m, '--dry-run']);
  assert.equal(r.code, 0);
  assert.match(r.out, /ship-flow plan/);
  assert.match(r.out, /\[forge\]/);
  assert.match(r.out, /\[ship\]/);
});

test('ship-flow CLI: a failing forge stage stops before ship, non-zero exit', () => {
  const d = tmp();
  const m = join(d, 'm.json');
  // section file does not exist -> forge stage fails
  writeFileSync(m, JSON.stringify({ title: 't', slug: 'feat/x', sections: { summary: 'NOPE.md' } }));
  const r = run([m]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /stage forge FAILED/);
  assert.ok(!/\[ship\]/.test(r.out) || !/DONE /.test(r.out), 'must not reach a successful ship/DONE');
});
