import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, buildPlan, lintStrictness, readStrictnessDefault } from '../ship-flow.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const M = {
  wrike: 'http://w/?id=1', title: 't', slug: 'feat/x', project: 'g/r',
  vars: { ticket: 'AB-9' },
  sections: { summary: 's.md', changes: 'c.md', testing: 't.md' },
};

test('validateManifest: complete manifest passes', () => {
  assert.deepEqual(validateManifest(M), []);
});

test('validateManifest: title/slug/sections required', () => {
  const errs = validateManifest({ sections: {} });
  assert.ok(errs.some((e) => /missing required field: title/.test(e)));
  assert.ok(errs.some((e) => /missing required field: slug/.test(e)));
  assert.ok(errs.some((e) => /sections .* required/.test(e)));
  assert.deepEqual(validateManifest(null), ['manifest must be a JSON object']);
});

test('validateManifest: project optional (detected from remote)', () => {
  const { project, ...noProject } = M;
  assert.deepEqual(validateManifest(noProject), []);
});

test('validateManifest: strictness absent or valid passes, invalid errors', () => {
  assert.deepEqual(validateManifest(M), []);
  assert.deepEqual(validateManifest({ ...M, strictness: 'strict' }), []);
  const errs = validateManifest({ ...M, strictness: 'epic' });
  assert.ok(errs.some((e) => /strictness must be one of loose\|rich\|strict/.test(e)));
});

test('buildPlan: stage order forge -> ship -> wrike-link', () => {
  const ids = buildPlan(M).map((s) => s.id);
  assert.deepEqual(ids, ['forge', 'ship', 'wrike-link']);
});

test('buildPlan: no wrike drops the wrike-link stage', () => {
  const { wrike, ...noWrike } = M;
  const ids = buildPlan(noWrike).map((s) => s.id);
  assert.deepEqual(ids, ['forge', 'ship']);
});

test('buildPlan: forge carries sections, vars, wrike, out', () => {
  const forge = buildPlan(M).find((s) => s.id === 'forge').cmd.join(' ');
  assert.match(forge, /--wrike http:\/\/w\/\?id=1/);
  assert.match(forge, /--section summary=s\.md/);
  assert.match(forge, /--section changes=c\.md/);
  assert.match(forge, /--var ticket=AB-9/);
  assert.match(forge, /--out mr-desc\.md/);
});

test('buildPlan: ship gets --project, wrike-link gets the url placeholder', () => {
  const plan = buildPlan(M);
  const ship = plan.find((s) => s.id === 'ship');
  assert.ok(ship.cmd.includes('--project') && ship.cmd.includes('g/r'));
  const wl = plan.find((s) => s.id === 'wrike-link');
  assert.equal(wl.cmd.at(-1), '{{MR_URL}}');
});

test('buildPlan: no project -> ship omits --project (remote detection)', () => {
  const { project, ...noProject } = M;
  const ship = buildPlan(noProject).find((s) => s.id === 'ship');
  assert.ok(!ship.cmd.includes('--project'));
});

test('lintStrictness rich (default): nudges for a wrike url', () => {
  const { wrike, ...noWrike } = M;
  assert.deepEqual(lintStrictness(noWrike), ['rich level: consider a wrike url for the top line']);
  assert.deepEqual(lintStrictness(M), []);
});

test('lintStrictness strict: demands wrike + 2 sections', () => {
  const { wrike, ...noWrike } = M;
  const msgs = lintStrictness({ ...noWrike, strictness: 'strict', sections: { summary: 's.md' } });
  assert.ok(msgs.some((m) => /no wrike url/.test(m)));
  assert.ok(msgs.some((m) => /only one section/.test(m)));
});

test('lintStrictness loose: silent', () => {
  const { wrike, ...noWrike } = M;
  assert.deepEqual(lintStrictness({ ...noWrike, strictness: 'loose' }), []);
});

test('lintStrictness: tolerates junk input', () => {
  assert.deepEqual(lintStrictness(null), []);
});

test('readStrictnessDefault: global file only — absent or blank -> undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'str-'));
  const glob = join(dir, 'global-strictness');
  assert.equal(readStrictnessDefault(glob), undefined);
  writeFileSync(glob, '  ');
  assert.equal(readStrictnessDefault(glob), undefined);
  writeFileSync(glob, 'strict');
  assert.equal(readStrictnessDefault(glob), 'strict');
});
