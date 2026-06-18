import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTemplatePath, countSentences, applyVars, assemble, validate, assertTemplate } from '../mr-build.mjs';

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

test('assertTemplate: clear errors for malformed templates', () => {
  assert.throws(() => assertTemplate(null), /must be a JSON object/);
  assert.throws(() => assertTemplate([]), /must be a JSON object/);
  assert.throws(() => assertTemplate({}), /sections must be an array/);
  assert.throws(() => assertTemplate({ sections: {} }), /sections must be an array/);
  assert.throws(() => assertTemplate({ sections: [{ title: 'No id' }] }), /needs both an "id" and a "title"/);
  assert.throws(() => assertTemplate({ sections: [{ id: 'x' }] }), /needs both an "id" and a "title"/);
  // a valid template passes through unchanged
  const ok = { sections: [{ id: 'summary', title: 'Summary' }] };
  assert.equal(assertTemplate(ok), ok);
});

test('assertTemplate: validates the global block shape', () => {
  const withGlobal = (global) => ({ sections: [{ id: 's', title: 'S' }], global });
  assert.throws(() => assertTemplate(withGlobal('nope')), /global must be an object/);
  assert.throws(() => assertTemplate(withGlobal({ denySections: 'TODO' })), /global\.denySections must be an array of strings/);
  assert.throws(() => assertTemplate(withGlobal({ denySections: [1] })), /global\.denySections must be an array of strings/);
  assert.throws(() => assertTemplate(withGlobal({ noEmoji: 'yes' })), /global\.noEmoji must be a boolean/);
  assert.throws(() => assertTemplate(withGlobal({ requireWrike: 1 })), /global\.requireWrike must be a boolean/);
  // valid global passes
  assert.doesNotThrow(() => assertTemplate(withGlobal({ noEmoji: true, requireWrike: false, denySections: ['TODO'] })));
});

test('assertTemplate: validates per-section rules shape', () => {
  const withRules = (rules) => ({ sections: [{ id: 's', title: 'S', rules }] });
  assert.throws(() => assertTemplate(withRules({ maxSentences: 'three' })), /maxSentences must be a (number|positive)/i);
  assert.throws(() => assertTemplate(withRules({ minSentences: -1 })), /minSentences must be a (number|positive)/i);
  assert.throws(() => assertTemplate(withRules({ mustHaveCodeBlock: 'yes' })), /mustHaveCodeBlock must be a boolean/);
  assert.throws(() => assertTemplate(withRules({ mustMatch: 42 })), /mustMatch must be a string/);
  assert.doesNotThrow(() => assertTemplate(withRules({ maxSentences: 4, mustHaveCodeBlock: true, mustMatch: 'AB-\\d+' })));
});

test('assemble: a topLine whose placeholders all resolve empty is dropped (no bare "Wrike:")', () => {
  const t = { topLine: 'Wrike: {wrike_url}', sections: [{ id: 's', title: 'S', required: true }], global: {} };
  const md = assemble(t, { wrikeUrl: '', sections: { s: 'body' } });
  assert.ok(!/Wrike:/.test(md), 'orphan label must not render when the url is empty');
  assert.match(md, /^## S/);
});

test('assemble: topLine kept when its placeholder resolves to a value', () => {
  const t = { topLine: 'Wrike: {wrike_url}', sections: [{ id: 's', title: 'S', required: true }], global: {} };
  assert.match(assemble(t, { wrikeUrl: 'http://w/1', sections: { s: 'b' } }), /^Wrike: http:\/\/w\/1/);
});

test('assemble: a static topLine (no placeholders) is always kept', () => {
  const t = { topLine: 'Please review', sections: [{ id: 's', title: 'S', required: true }], global: {} };
  assert.match(assemble(t, { wrikeUrl: '', sections: { s: 'b' } }), /^Please review/);
});

test('assemble: an empty/whitespace section body is skipped (no bare heading)', () => {
  const md = assemble(TPL, {
    wrikeUrl: 'u',
    sections: { summary: 'Does X.', changes: 'edited', testing: '   ' },
  });
  assert.ok(!/## Testing/.test(md), 'empty optional section must not emit a heading');
  assert.match(md, /## Summary/);
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

test('validate: an invalid mustMatch regex is reported, not thrown', () => {
  const T = { ...TPL, sections: [{ id: 'summary', title: 'Summary', required: true, rules: { mustMatch: '([unclosed' } }] };
  const sections = { summary: 'whatever' };
  const assembled = assemble(T, { wrikeUrl: 'u', sections });
  let v;
  assert.doesNotThrow(() => { v = validate(T, { wrikeUrl: 'u', sections, assembled }); });
  assert.ok(v.some((x) => /Summary.*invalid.*regex|invalid mustMatch/i.test(x)), 'should flag the bad regex');
});

test('validate: forbidden section present -> violation', () => {
  const sections = { summary: 'X.\n## TODO\nlater', changes: 'x' };
  const assembled = assemble(TPL, { wrikeUrl: 'u', sections });
  const v = validate(TPL, { wrikeUrl: 'u', sections, assembled });
  assert.ok(v.some((x) => /forbidden section.*TODO/.test(x)));
});

test('validate: non-string denySections entries are ignored, not crashed on', () => {
  const T = { ...TPL, global: { denySections: ['TODO', 123, null] } };
  const sections = { summary: 'X.\n## TODO\nlater', changes: 'y' };
  const assembled = assemble(T, { wrikeUrl: 'u', sections });
  let v;
  assert.doesNotThrow(() => { v = validate(T, { wrikeUrl: 'u', sections, assembled }); });
  assert.ok(v.some((x) => /forbidden section.*TODO/.test(x)), 'the valid "TODO" entry still works');
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
