import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// wrike-link CLI exit contract, all offline: with no WRIKE_TOKEN it prints the
// MCP plan (no network), and the input guards (usage / bad url / unreadable task
// id) all exit 2 before any API work.

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'wrike-link.mjs');

function run(args) {
  const env = { ...process.env };
  delete env.WRIKE_TOKEN; // force the offline MCP-plan path for the happy case
  try {
    const out = execFileSync('node', [BIN, ...args], { encoding: 'utf8', env });
    return { out: out.trim(), code: 0 };
  } catch (e) {
    return { out: ((e.stdout || '') + (e.stderr || '')).trim(), code: e.status };
  }
}

test('wrike-link CLI: no args exits 2 (usage)', () => {
  const r = run([]);
  assert.equal(r.code, 2);
  assert.match(r.out, /usage/);
});

test('wrike-link CLI: non-http url exits 2', () => {
  const r = run(['123', 'ftp://nope']);
  assert.equal(r.code, 2);
  assert.match(r.out, /must be absolute http/);
});

test('wrike-link CLI: unreadable task id exits 2', () => {
  const r = run(['https://www.wrike.com/open.htm', 'https://git.x/mr/1']);
  assert.equal(r.code, 2);
  assert.match(r.out, /could not read a task id/);
});

test('wrike-link CLI: valid input, no token -> prints MCP plan, exits 0', () => {
  const r = run(['123', 'https://git.x/mr/1']);
  assert.equal(r.code, 0);
  const plan = JSON.parse(r.out);
  assert.match(plan.note, /No WRIKE_TOKEN/);
  assert.equal(plan.step1.tool, 'wrike_get_tasks');
  assert.equal(plan.step2.tool, 'wrike_update_task');
  assert.match(plan.step2.arguments.description, /git\.x\/mr\/1/);
});
