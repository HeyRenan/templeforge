import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'strictness.mjs');
const run = (home, args = []) => {
  try {
    return { out: execFileSync('node', [BIN, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim(), code: 0 };
  } catch (e) {
    return { out: (e.stderr || '').trim(), code: e.status };
  }
};

test('strictness cli: unset reads as rich default', () => {
  const home = mkdtempSync(join(tmpdir(), 'str-'));
  assert.equal(run(home).out, 'STRICTNESS rich (default)');
});

test('strictness cli: set then read back, script-owned end to end', () => {
  const home = mkdtempSync(join(tmpdir(), 'str-'));
  assert.equal(run(home, ['strict']).out, 'STRICTNESS strict');
  assert.equal(run(home).out, 'STRICTNESS strict');
  assert.equal(run(home, ['loose']).out, 'STRICTNESS loose');
  assert.equal(run(home).out, 'STRICTNESS loose');
});

test('strictness cli: junk level rejected with exit 1', () => {
  const home = mkdtempSync(join(tmpdir(), 'str-'));
  const r = run(home, ['ultra']);
  assert.equal(r.code, 1);
  assert.match(r.out, /loose\|rich\|strict/);
});
