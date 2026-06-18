import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, buildPlan, lintStrictness, readStrictnessDefault, extractRequestUrl, loadManifest } from '../ship-flow.mjs';
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

test('validateManifest: sections must be an id->path map of strings, not an array', () => {
  const base = { title: 't', slug: 's' };
  assert.ok(validateManifest({ ...base, sections: ['a', 'b'] }).some((e) => /sections/.test(e)));
  assert.ok(validateManifest({ ...base, sections: { a: 123 } }).some((e) => /string file path|path/.test(e)));
  assert.deepEqual(validateManifest({ ...base, sections: { a: 'a.md' } }), []);
});

test('validateManifest: vars, when present, must be an object map', () => {
  const base = { title: 't', slug: 's', sections: { a: 'a.md' } };
  assert.ok(validateManifest({ ...base, vars: 'ticket=AB-1' }).some((e) => /vars/.test(e)));
  assert.ok(validateManifest({ ...base, vars: ['x'] }).some((e) => /vars/.test(e)));
  assert.deepEqual(validateManifest({ ...base, vars: { ticket: 'AB-1' } }), []);
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

test('buildPlan: ship runs node ship.mjs (5-provider router), not bash ship.sh', () => {
  const ship = buildPlan(M).find((s) => s.id === 'ship');
  assert.equal(ship.cmd[0], 'node');
  assert.match(ship.cmd[1], /ship\.mjs$/);
  assert.ok(!ship.cmd.some((c) => /ship\.sh$/.test(c)), 'must not invoke ship.sh');
});

test('buildPlan: manifest draft -> ship gets --draft; absent -> no --draft', () => {
  assert.ok(buildPlan({ ...M, draft: true }).find((s) => s.id === 'ship').cmd.includes('--draft'));
  assert.ok(!buildPlan(M).find((s) => s.id === 'ship').cmd.includes('--draft'));
});

test('buildPlan: no project -> ship omits --project (remote detection)', () => {
  const { project, ...noProject } = M;
  const ship = buildPlan(noProject).find((s) => s.id === 'ship');
  assert.ok(!ship.cmd.includes('--project'));
});

test('loadManifest: clear errors for missing file and bad JSON', () => {
  const missing = () => { throw new Error('ENOENT'); };
  assert.throws(() => loadManifest('nope.json', missing), /manifest not found: nope\.json/);
  assert.throws(() => loadManifest('bad.json', () => '{bad'), /not valid JSON \(bad\.json\)/);
  assert.deepEqual(loadManifest('ok.json', () => '{"title":"t"}'), { title: 't' });
});

test('extractRequestUrl: matches every provider url shape', () => {
  const urls = {
    gitlab: 'https://gitlab.com/g/r/-/merge_requests/12',
    github: 'https://github.com/o/r/pull/34',
    bitbucket: 'https://bitbucket.org/w/r/pull-requests/56',
    gitea: 'https://codeberg.org/o/r/pulls/78',
    azure: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/90',
  };
  for (const [k, u] of Object.entries(urls)) {
    assert.equal(extractRequestUrl(`ship: opened\n${u}\n`), u, `${k} url should match precisely`);
  }
});

test('extractRequestUrl: prefers the request url over an earlier diagnostic url', () => {
  const out = 'see https://docs.example.com/help\nhttps://github.com/o/r/pull/7\n';
  assert.equal(extractRequestUrl(out), 'https://github.com/o/r/pull/7');
});

test('extractRequestUrl: falls back to first absolute url, then null', () => {
  assert.equal(extractRequestUrl('opened at https://example.com/x'), 'https://example.com/x');
  assert.equal(extractRequestUrl('no url here'), null);
  assert.equal(extractRequestUrl(''), null);
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

test('readStrictnessDefault: a hand-edited junk value is ignored, not propagated', () => {
  // The file is one plain word a user may edit by hand. A typo ("Strict",
  // "verbose") must not become m.strictness and fail validateManifest with a
  // confusing manifest error — read is as strict as the CLI write.
  const dir = mkdtempSync(join(tmpdir(), 'str-'));
  const glob = join(dir, 'global-strictness');
  writeFileSync(glob, 'Strict');
  assert.equal(readStrictnessDefault(glob), undefined);
  writeFileSync(glob, 'verbose');
  assert.equal(readStrictnessDefault(glob), undefined);
});
