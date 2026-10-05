import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CLAUDE_PLUGIN_DATA = mkdtempSync(join(tmpdir(), 'tf-data-'));
const {
  BUILT_IN_TEMPLATE, applyVars, assertTemplate, countSentences, describeTemplate,
  globalTemplatePath, loadTemplate, render, resolveTemplatePath,
} = await import('../templeforge/lib/template.mjs');

const template = assertTemplate({
  name: 't',
  topLine: 'Wrike: {wrike_url}',
  global: { noEmoji: true, denySections: ['TODO'] },
  sections: [
    { id: 'summary', title: 'Summary', required: true, rules: { maxSentences: 2 } },
    { id: 'setup', title: 'Setup', rules: { mustHaveCodeBlock: true, mustMatch: '^- ' } },
    { id: 'testing', title: 'Testing', rules: { minSentences: 2 } },
  ],
});

test('countSentences ignores fenced code and counts a fragment as one', () => {
  assert.equal(countSentences('One. Two! Three?'), 3);
  assert.equal(countSentences('no period'), 1);
  assert.equal(countSentences('```\na. b. c.\n```'), 0);
});

test('applyVars keeps unknown placeholders', () => {
  assert.equal(applyVars('{a} {b}', { a: 1 }), '1 {b}');
});

test('render orders sections, substitutes vars, skips blank optional sections', () => {
  const { description, violations } = render(template, {
    wrike: 'https://w/1', vars: { t: 'AB-1' }, sections: { summary: 'Fix {t}.', testing: '' },
  });
  assert.deepEqual(violations, []);
  assert.equal(description, 'Wrike: https://w/1\n\n## Summary\n\nFix AB-1.\n');
});

test('render drops a top line whose placeholders are all blank', () => {
  assert.equal(render(template, { sections: { summary: 'X.' } }).description, '## Summary\n\nX.\n');
});

test('render reports every rule violation', () => {
  const { violations } = render(template, {
    sections: { setup: 'no list', testing: 'One.', typo: 'x' },
  });
  assert.deepEqual(violations, [
    'unknown section "typo" (template has: summary, setup, testing)',
    'Summary: required section missing',
    'Setup: needs a fenced code block',
    'Setup: must match /^- /',
    'Testing: 1 sentences, min 2',
  ]);
});

test('render enforces maxSentences, denied headings and emoji, but allows arrows', () => {
  const { violations } = render(template, { sections: { summary: 'A. B. C.\n## TODO\nx ✅' } });
  assert.deepEqual(violations, [
    'Summary: 3 sentences, max 2',
    'forbidden heading "TODO"',
    'emoji present (template forbids emoji)',
  ]);
  assert.deepEqual(render(template, { sections: { summary: 'A → B.' } }).violations, []);
});

test('render flags an invalid mustMatch regex instead of crashing', () => {
  const broken = assertTemplate({ sections: [{ id: 's', title: 'S', rules: { mustMatch: '(' } }] });
  assert.deepEqual(render(broken, { sections: { s: 'x' } }).violations, ['S: invalid mustMatch regex /(/']);
});

test('requireWrike fails without a wrike url', () => {
  const strict = assertTemplate({ global: { requireWrike: true }, sections: [{ id: 's', title: 'S' }] });
  assert.deepEqual(render(strict, { sections: { s: 'x' } }).violations, ['wrike url required by the template']);
});

test('assertTemplate rejects bad shapes with a clear message', () => {
  assert.throws(() => assertTemplate([]), /JSON object/);
  assert.throws(() => assertTemplate({ sections: {} }), /sections must be an array/);
  assert.throws(() => assertTemplate({ sections: [{ id: 'a' }] }), /"id" and "title"/);
  assert.throws(() => assertTemplate({ sections: [{ id: 'a', title: 'A', rules: { maxSentences: -1 } }] }), /non-negative/);
  assert.throws(() => assertTemplate({ sections: [], global: { denySections: [1] } }), /array of strings/);
  assert.throws(() => assertTemplate({ sections: [], global: { noEmoji: 'yes' } }), /boolean/);
});

test('resolveTemplatePath: repo template, then plugin data template, then built-in', () => {
  const root = mkdtempSync(join(tmpdir(), 'tf-repo-'));
  assert.equal(resolveTemplatePath(root), BUILT_IN_TEMPLATE);
  mkdirSync(process.env.CLAUDE_PLUGIN_DATA, { recursive: true });
  writeFileSync(globalTemplatePath(), '{}');
  assert.equal(resolveTemplatePath(root), globalTemplatePath());
  mkdirSync(join(root, '.templeforge'));
  writeFileSync(join(root, '.templeforge', 'template.json'), '{}');
  assert.equal(resolveTemplatePath(root), join(root, '.templeforge', 'template.json'));
});

test('describeTemplate lists rules and hints', () => {
  const text = describeTemplate(loadTemplate(BUILT_IN_TEMPLATE));
  assert.match(text, /section summary "Summary" required maxSentences=4/);
  assert.match(text, /hint: What changed and why/);
});
