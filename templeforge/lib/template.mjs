// Template resolution, shape checks, rendering and validation.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILT_IN_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'default.json');

// Claude Code's persistent per-plugin dir; it survives plugin updates.
export const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA
  || join(homedir(), '.claude', 'plugins', 'data', 'templeforge-templeforge');

export const repoTemplatePath = (root) => join(root, '.templeforge', 'template.json');
export const globalTemplatePath = () => join(DATA_DIR, 'template.json');

export function resolveTemplatePath(root) {
  const candidates = [root && repoTemplatePath(root), globalTemplatePath()].filter(Boolean);
  return candidates.find((path) => existsSync(path)) || BUILT_IN_TEMPLATE;
}

export function loadTemplate(path) {
  let template;
  try {
    template = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`template ${path} is not readable JSON: ${error.message}`);
  }
  return assertTemplate(template);
}

export const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export function assertTemplate(template) {
  if (!isPlainObject(template)) throw new Error('template must be a JSON object');
  if (!Array.isArray(template.sections)) throw new Error('template.sections must be an array');
  template.sections.forEach((section, index) => {
    const where = `template.sections[${index}]`;
    if (!isPlainObject(section) || !section.id || !section.title) throw new Error(`${where} needs "id" and "title"`);
    assertRules(section.rules ?? {}, `${where}.rules`);
  });
  assertGlobal(template.global ?? {});
  return template;
}

function assertGlobal(global) {
  if (!isPlainObject(global)) throw new Error('template.global must be an object');
  const { denySections } = global;
  if (denySections != null && !(Array.isArray(denySections) && denySections.every((heading) => typeof heading === 'string'))) {
    throw new Error('template.global.denySections must be an array of strings');
  }
  for (const key of ['noEmoji', 'requireWrike']) {
    if (global[key] != null && typeof global[key] !== 'boolean') throw new Error(`template.global.${key} must be a boolean`);
  }
}

function assertRules(rules, where) {
  if (!isPlainObject(rules)) throw new Error(`${where} must be an object`);
  for (const key of ['maxSentences', 'minSentences']) {
    if (rules[key] != null && !(Number.isInteger(rules[key]) && rules[key] >= 0)) throw new Error(`${where}.${key} must be a non-negative integer`);
  }
  if (rules.mustHaveCodeBlock != null && typeof rules.mustHaveCodeBlock !== 'boolean') throw new Error(`${where}.mustHaveCodeBlock must be a boolean`);
  if (rules.mustMatch != null && typeof rules.mustMatch !== 'string') throw new Error(`${where}.mustMatch must be a regex string`);
}

// Fenced code is ignored so a command block never counts as prose.
export function countSentences(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '').trim();
  if (!prose) return 0;
  return (prose.match(/[.!?](\s|$)/g) || []).length || 1;
}

// Unknown {vars} stay as typed, so a stray brace in prose never vanishes.
export function applyVars(text, vars) {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

const EMOJI = /[\p{Emoji_Presentation}\uFE0F\u2714\u2716]/u;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isBlank = (text) => text == null || !String(text).trim();

// A top line whose every {placeholder} is blank would render as a bare label ("Wrike: ").
function isEmptyTopLine(topLine, vars) {
  const keys = [...topLine.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
  return keys.length > 0 && keys.every((key) => isBlank(vars[key]));
}

export function render(template, { sections = {}, wrike = '', vars = {} }) {
  const context = { ...vars, wrike_url: wrike || '' };
  const lines = [];
  if (template.topLine && !isEmptyTopLine(template.topLine, context)) {
    lines.push(applyVars(template.topLine, context), '');
  }
  for (const section of template.sections) {
    const body = sections[section.id];
    if (isBlank(body)) continue;
    lines.push(`## ${section.title}`, '', applyVars(String(body).trim(), context), '');
  }
  const description = lines.join('\n').trim() + '\n';
  return { description, violations: validate(template, { sections, wrike, context, description }) };
}

function validate(template, { sections, wrike, context, description }) {
  const violations = [];
  const known = new Set(template.sections.map((section) => section.id));
  for (const id of Object.keys(sections)) {
    if (!known.has(id)) violations.push(`unknown section "${id}" (template has: ${[...known].join(', ')})`);
  }
  for (const section of template.sections) {
    const raw = sections[section.id];
    if (isBlank(raw)) {
      if (section.required) violations.push(`${section.title}: required section missing`);
      continue;
    }
    violations.push(...sectionViolations(section, applyVars(String(raw), context)));
  }
  const global = template.global ?? {};
  for (const denied of global.denySections ?? []) {
    if (new RegExp(`^#{1,6}\\s*${escapeRegex(denied)}\\b`, 'im').test(description)) {
      violations.push(`forbidden heading "${denied}"`);
    }
  }
  if (global.noEmoji && EMOJI.test(description)) violations.push('emoji present (template forbids emoji)');
  if (global.requireWrike && !wrike) violations.push('wrike url required by the template');
  return violations;
}

function sectionViolations(section, body) {
  const rules = section.rules ?? {};
  const found = [];
  const sentences = countSentences(body);
  if (rules.maxSentences != null && sentences > rules.maxSentences) found.push(`${section.title}: ${sentences} sentences, max ${rules.maxSentences}`);
  if (rules.minSentences != null && sentences < rules.minSentences) found.push(`${section.title}: ${sentences} sentences, min ${rules.minSentences}`);
  if (rules.mustHaveCodeBlock && !body.includes('```')) found.push(`${section.title}: needs a fenced code block`);
  if (rules.mustMatch) {
    let pattern;
    try { pattern = new RegExp(rules.mustMatch, 'm'); } catch { found.push(`${section.title}: invalid mustMatch regex /${rules.mustMatch}/`); }
    if (pattern && !pattern.test(body)) found.push(`${section.title}: must match /${rules.mustMatch}/`);
  }
  return found;
}

// One line per rule, plus the author's hints, so the agent writes a passing body
// on the first try.
export function describeTemplate(template) {
  const lines = [];
  if (template.description) lines.push(`  about: ${template.description}`);
  const global = template.global ?? {};
  const flags = [
    template.topLine && `topLine="${template.topLine}"`,
    global.noEmoji && 'noEmoji',
    global.requireWrike && 'requireWrike',
    global.denySections?.length && `denyHeadings=${global.denySections.join('|')}`,
  ].filter(Boolean);
  if (flags.length) lines.push(`  global: ${flags.join(' ')}`);
  if (global.hint) lines.push(`  hint: ${global.hint}`);
  for (const section of template.sections) {
    const rules = Object.entries(section.rules ?? {}).map(([key, value]) => `${key}=${value}`);
    lines.push(`  section ${section.id} "${section.title}"${section.required ? ' required' : ''}${rules.length ? ' ' + rules.join(' ') : ''}`);
    if (section.hint) lines.push(`    hint: ${section.hint}`);
  }
  return lines.join('\n');
}
