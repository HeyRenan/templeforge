import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTemplatePath, countSentences, applyVars, assemble, validate } from '../mr-build.mjs';

const TPL = {
  name: 'default',
  topLine: 'Wrike: {wrike_url}',
  sections: [
    { id: 'summary', title: 'Summary', required: true, rules: { maxSentences: 3 } },
    { id: 'changes', title: 'Changes', required: true },
    { id: 'testing', title: 'Testing', required: false, rules: { minSentences: 1 } },
  ],
  global: { denySections: ['Checklist', 'TODO'], noEmoji: true },
};

function tmp() { return mkdtempSync(join(tmpdir(), 'mrb-')); }

test('resolveTemplatePath: repo .templeforge/template.json wins', () => {
  const d = tmp();
  mkdirSync(join(d, '.templeforge'), { recursive: true });
  const p = join(d, '.templeforge', 'template.json');
  writeFileSync(p, '{}');
  assert.equal(resolveTemplatePath({ repoRoot: d }), p);
});

test('resolveTemplatePath: env wins when no repo file', () => {
  const d = tmp();
  const env = join(d, 'custom.json');
  writeFileSync(env, '{}');
  assert.equal(resolveTemplatePath({ env, repoRoot: d }), env);
});

test('resolveTemplatePath: falls back to embedded default', () => {
  const r = resolveTemplatePath({});
  assert.match(r, /default\.json$/);
});

test('resolveTemplatePath: explicit overrides everything', () => {
  assert.equal(resolveTemplatePath({ explicit: '/x/y.json', env: '/a/b.json' }), '/x/y.json');
});

test('countSentences ignores code blocks', () => {
  assert.equal(countSentences('One sentence. Two.'), 2);
  assert.equal(countSentences('```\na.b.c.\n```\nOne.'), 1);
  assert.equal(countSentences(''), 0);
});

test('applyVars substitutes known, leaves unknown', () => {
  assert.equal(applyVars('hi {name}, see {ticket}', { name: 'Ana', ticket: 'AB-1' }), 'hi Ana, see AB-1');
  assert.equal(applyVars('keep {unknown} brace', { name: 'x' }), 'keep {unknown} brace');
});

test('assemble: topLine + sections in template order, vars applied', () => {
  const md = assemble(TPL, {
    wrikeUrl: 'http://w/1',
    sections: { summary: 'S for {ticket}.', changes: 'edited x', testing: 'ran it' },
    vars: { ticket: 'AB-9' },
  });
  assert.match(md, /^Wrike: http:\/\/w\/1/);
  assert.match(md, /S for AB-9\./);
  assert.ok(md.indexOf('## Summary') < md.indexOf('## Changes'));
  assert.ok(md.indexOf('## Changes') < md.indexOf('## Testing'));
});

test('validate: clean input passes', () => {
  const sections = { summary: 'Does X.', changes: 'touched a, b', testing: 'ran the suite' };
  const assembled = assemble(TPL, { wrikeUrl: 'u', sections });
  assert.deepEqual(validate(TPL, { wrikeUrl: 'u', sections, assembled }), []);
});

test('validate: required section missing -> violation', () => {
  const sections = { summary: 'X.' }; // no changes
  const assembled = assemble(TPL, { wrikeUrl: 'u', sections });
  const v = validate(TPL, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /Changes/.test(x)));
});

test('validate: maxSentences exceeded -> violation', () => {
  const sections = { summary: 'A. B. C. D.', changes: 'x' };
  const assembled = assemble(TPL, { wrikeUrl: 'u', sections });
  const v = validate(TPL, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /sentences/.test(x)));
});

test('validate: mustHaveCodeBlock -> violation', () => {
  const T = { ...TPL, sections: [{ id: 'summary', title: 'Summary', required: true, rules: { mustHaveCodeBlock: true } }] };
  const sections = { summary: 'just run npm i' };
  const assembled = assemble(T, { wrikeUrl: 'u', sections });
  const v = validate(T, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /code block/.test(x)));
});

test('validate: mustMatch -> violation when pattern absent', () => {
  const T = { ...TPL, sections: [{ id: 'summary', title: 'Summary', required: true, rules: { mustMatch: 'AB-\\d+' } }] };
  const sections = { summary: 'no ticket here' };
  const assembled = assemble(T, { wrikeUrl: 'u', sections });
  const v = validate(T, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /pattern/.test(x)));
});

test('validate: forbidden section present -> violation', () => {
  const sections = { summary: 'X.\n## TODO\nlater', changes: 'x' };
  const assembled = assemble(TPL, { wrikeUrl: 'u', sections });
  const v = validate(TPL, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /forbidden section.*TODO/.test(x)));
});

test('validate: emoji present -> violation', () => {
  const sections = { summary: 'X works.', changes: 'done ✅' };
  const assembled = assemble(TPL, { wrikeUrl: 'u', sections });
  const v = validate(TPL, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /emoji/.test(x)));
});

test('validate: empty wrike only fails when global.requireWrike', () => {
  const sections = { summary: 'X.', changes: 'y' };
  // default: no requireWrike -> empty wrike is fine
  assert.deepEqual(validate(TPL, { wrikeUrl: '', sections, assembled: assemble(TPL, { wrikeUrl: '', sections }) }), []);
  // with requireWrike -> violation
  const T = { ...TPL, global: { ...TPL.global, requireWrike: true } };
  const v = validate(T, { wrikeUrl: '', sections, assembled: assemble(T, { wrikeUrl: '', sections }) });
  assert.ok(v.some((x) => /Wrike/.test(x)));
});
