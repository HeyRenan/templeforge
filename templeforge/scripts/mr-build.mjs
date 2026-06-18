#!/usr/bin/env node
// mr-build.mjs — assemble + VALIDATE an MR/PR description from a template.
// You fill section bodies; the motor owns structure, order, the top line, and
// the rules. Violations are rejected BEFORE the request opens — no more "opened
// off-template, reviewer complains, redo". This is templeforge's whole job: turn
// a template + section bodies + vars into a validated description. It has no idea
// what the bodies contain — text, links, a table, whatever you wrote.
//
//   node mr-build.mjs --wrike <url> --section summary=body.md \
//     --section testing=test.md --var ticket=AB-12 [--template path] --out mr-desc.md
//
// Template resolution: .templeforge/template.json (repo root) ->
// $TEMPLEFORGE_TEMPLATE -> scripts/templates/default.json (embedded).
// Exit 0 PASS, 1 error (validation FAIL, bad template, unreadable section file…),
// 2 usage.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const EMBEDDED = join(HERE, 'templates', 'default.json');

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}✅❌✔✖]/u;

export function resolveTemplatePath({ explicit, env, repoRoot } = {}) {
  if (explicit) return explicit;
  if (repoRoot) {
    const p = join(repoRoot, '.templeforge', 'template.json');
    if (existsSync(p)) return p;
  }
  if (env && existsSync(env)) return env;
  return EMBEDDED;
}

function gitRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

export function countSentences(text) {
  const t = text.replace(/```[\s\S]*?```/g, '').trim();
  if (!t) return 0;
  return (t.match(/[.!?](\s|$)/g) || []).length || 1;
}

// {var} substitution in a string. Unknown vars are left as-is so a stray brace
// in prose never silently vanishes.
export function applyVars(str, vars = {}) {
  if (!str) return str;
  return str.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Validate the SHAPE of a parsed template before assemble/validate touch it, so a
// hand-edited .templeforge/template.json with a typo fails with a clear message
// instead of a raw "template.sections is not iterable" deep in the loop.
export function assertTemplate(template) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new Error('template must be a JSON object');
  }
  if (!Array.isArray(template.sections)) {
    throw new Error('template.sections must be an array of { id, title } entries');
  }
  for (const [i, sec] of template.sections.entries()) {
    if (!sec || typeof sec !== 'object' || !sec.id || !sec.title) {
      throw new Error(`template.sections[${i}] needs both an "id" and a "title"`);
    }
    assertRules(sec.rules, `template.sections[${i}].rules`);
  }
  assertGlobal(template.global);
  return template;
}

function assertGlobal(g) {
  if (g == null) return;
  if (typeof g !== 'object' || Array.isArray(g)) throw new Error('template.global must be an object');
  if (g.denySections != null &&
      (!Array.isArray(g.denySections) || !g.denySections.every((x) => typeof x === 'string'))) {
    throw new Error('template.global.denySections must be an array of strings');
  }
  for (const k of ['noEmoji', 'requireWrike']) {
    if (g[k] != null && typeof g[k] !== 'boolean') throw new Error(`template.global.${k} must be a boolean`);
  }
}

function assertRules(rules, where) {
  if (rules == null) return;
  if (typeof rules !== 'object' || Array.isArray(rules)) throw new Error(`${where} must be an object`);
  for (const k of ['maxSentences', 'minSentences']) {
    if (rules[k] != null && (typeof rules[k] !== 'number' || rules[k] < 0 || !Number.isFinite(rules[k]))) {
      throw new Error(`${where}.${k} must be a positive number`);
    }
  }
  if (rules.mustHaveCodeBlock != null && typeof rules.mustHaveCodeBlock !== 'boolean') {
    throw new Error(`${where}.mustHaveCodeBlock must be a boolean`);
  }
  if (rules.mustMatch != null && typeof rules.mustMatch !== 'string') {
    throw new Error(`${where}.mustMatch must be a string (a regex pattern)`);
  }
}

// A topLine like "Wrike: {wrike_url}" is an empty shell when it references one or
// more {placeholders} and every referenced value resolves to blank — rendering it
// would leave a bare label ("Wrike: ") atop the request. A static line (no
// placeholders) or one with at least one filled value is kept.
function topLineIsEmptyShell(topLine, ctx) {
  const refs = [...topLine.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
  if (!refs.length) return false;
  return refs.every((k) => !(k in ctx) || !String(ctx[k]).trim());
}

export function assemble(template, { wrikeUrl, sections, vars = {} }) {
  const lines = [];
  const ctx = { ...vars, wrike_url: wrikeUrl || '' };
  if (template.topLine && !topLineIsEmptyShell(template.topLine, ctx)) {
    lines.push(applyVars(template.topLine, ctx));
  }
  lines.push('');
  for (const sec of template.sections) {
    const body = sections[sec.id];
    // Skip a missing OR empty body: an optional section left blank shouldn't emit
    // a bare heading. A required-but-empty section is still caught by validate(),
    // which inspects the raw sections independently of what assemble() renders.
    if (body == null || !String(body).trim()) continue;
    lines.push('## ' + sec.title);
    lines.push('');
    lines.push(applyVars(body.trim(), ctx));
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

export function validate(template, { wrikeUrl, sections, vars = {}, assembled }) {
  const v = [];
  const g = template.global || {};
  // Same context assemble() renders with, so content rules see what the request
  // actually shows (vars + wrike_url substituted), not the raw "{var}" text.
  const ctx = { ...vars, wrike_url: wrikeUrl || '' };

  for (const sec of template.sections) {
    const raw = sections[sec.id];
    if (sec.required && (raw == null || !String(raw).trim())) {
      v.push(`required section missing: ${sec.title}`);
      continue;
    }
    if (raw == null) continue;
    const body = applyVars(String(raw), ctx);
    const rules = sec.rules || {};
    if (rules.maxSentences && countSentences(body) > rules.maxSentences) {
      v.push(`${sec.title}: more than ${rules.maxSentences} sentences (it is a Summary, not a diff walkthrough)`);
    }
    if (rules.minSentences && countSentences(body) < rules.minSentences) {
      v.push(`${sec.title}: fewer than ${rules.minSentences} sentences (say more)`);
    }
    if (rules.mustHaveCodeBlock && !/```/.test(body)) {
      v.push(`${sec.title}: must contain a code block (the commands the reviewer runs)`);
    }
    if (rules.mustMatch) {
      // rules.mustMatch is author-supplied — a typo'd regex must surface as a
      // clear violation, not crash the whole build with a raw SyntaxError.
      let re;
      try { re = new RegExp(rules.mustMatch, 'm'); }
      catch { re = null; v.push(`${sec.title}: rule mustMatch has an invalid regex /${rules.mustMatch}/`); }
      if (re && !re.test(body)) {
        v.push(`${sec.title}: does not match required pattern /${rules.mustMatch}/`);
      }
    }
  }

  if (Array.isArray(g.denySections)) {
    // Tolerate a hand-edited template with a stray non-string entry (e.g. a number
    // or null from a missed quote) instead of crashing on bad.replace(...).
    for (const bad of g.denySections) {
      if (typeof bad !== 'string' || !bad) continue;
      const re = new RegExp('^#{1,6}\\s*' + bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'im');
      if (re.test(assembled)) v.push(`forbidden section present: "${bad}" (template denies it)`);
    }
  }
  if (g.noEmoji && EMOJI_RE.test(assembled)) {
    v.push('emoji present (template forbids emoji anywhere in the request)');
  }
  if (template.topLine && template.topLine.includes('{wrike_url}') && g.requireWrike && !wrikeUrl) {
    v.push('Wrike url is empty but the template requires it on the top line');
  }
  return v;
}

function parse(argv) {
  const a = { sections: {}, vars: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--wrike') a.wrike = argv[++i];
    else if (k === '--template') a.template = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--init-template') a.initTemplate = true;
    else if (k === '--section') {
      const pair = argv[++i] || '';
      const eq = pair.indexOf('=');
      if (eq < 0) throw new Error('mr-build: --section needs id=file');
      a.sections[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (k === '--var') {
      const pair = argv[++i] || '';
      const eq = pair.indexOf('=');
      if (eq < 0) throw new Error('mr-build: --var needs key=value');
      a.vars[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else throw new Error('mr-build: unknown arg ' + k);
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const a = parse(process.argv.slice(2));
    if (a.initTemplate) {
      const dest = join(gitRoot() || process.cwd(), '.templeforge', 'template.json');
      if (existsSync(dest)) { console.error('mr-build: ' + dest + ' already exists — edit it directly'); process.exit(1); }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(EMBEDDED, 'utf8'));
      console.log('wrote ' + dest + ' (copy of the built-in template — edit rules/sections there)');
      process.exit(0);
    }
    if (!a.out) { console.error('usage: mr-build.mjs --wrike URL --section id=file [--var k=v ...] --out mr-desc.md | --init-template'); process.exit(2); }
    const tplPath = resolveTemplatePath({ explicit: a.template, env: process.env.TEMPLEFORGE_TEMPLATE, repoRoot: gitRoot() });
    const template = assertTemplate(JSON.parse(readFileSync(tplPath, 'utf8')));
    const sections = {};
    for (const [id, file] of Object.entries(a.sections)) {
      try { sections[id] = readFileSync(file, 'utf8'); }
      catch { throw new Error(`section "${id}" points to a file that can't be read: ${file}`); }
    }

    const tplName = template.name || basename(tplPath);
    const assembled = assemble(template, { wrikeUrl: a.wrike, sections, vars: a.vars });
    const violations = validate(template, { wrikeUrl: a.wrike, sections, vars: a.vars, assembled });
    if (violations.length) {
      console.error('mr-build: ' + violations.length + ' validation error(s) against template "' + tplName + '":');
      for (const x of violations) console.error('  - ' + x);
      process.exit(1);
    }
    writeFileSync(a.out, assembled);
    console.error('mr-build: wrote ' + a.out + ' (template ' + tplName + ', ' + tplPath + ')');
    console.log('PASS ' + a.out);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}
