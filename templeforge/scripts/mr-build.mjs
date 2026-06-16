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
// Exit 0 PASS, 1 validation FAIL, 2 usage.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

export function assemble(template, { wrikeUrl, sections, vars = {} }) {
  const lines = [];
  const ctx = { ...vars, wrike_url: wrikeUrl || '' };
  if (template.topLine) lines.push(applyVars(template.topLine, ctx));
  lines.push('');
  for (const sec of template.sections) {
    const body = sections[sec.id];
    if (body == null) continue;
    lines.push('## ' + sec.title);
    lines.push('');
    lines.push(applyVars(body.trim(), ctx));
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

export function validate(template, { wrikeUrl, sections, assembled }) {
  const v = [];
  const g = template.global || {};

  for (const sec of template.sections) {
    const body = sections[sec.id];
    if (sec.required && (body == null || !String(body).trim())) {
      v.push(`required section missing: ${sec.title}`);
      continue;
    }
    if (body == null) continue;
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
    if (rules.mustMatch && !new RegExp(rules.mustMatch, 'm').test(body)) {
      v.push(`${sec.title}: does not match required pattern /${rules.mustMatch}/`);
    }
  }

  if (g.denySections) {
    for (const bad of g.denySections) {
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
    const template = JSON.parse(readFileSync(tplPath, 'utf8'));
    const sections = {};
    for (const [id, file] of Object.entries(a.sections)) sections[id] = readFileSync(file, 'utf8');

    const assembled = assemble(template, { wrikeUrl: a.wrike, sections, vars: a.vars });
    const violations = validate(template, { wrikeUrl: a.wrike, sections, assembled });
    if (violations.length) {
      console.error('mr-build: ' + violations.length + ' validation error(s) against template "' + template.name + '":');
      for (const x of violations) console.error('  - ' + x);
      process.exit(1);
    }
    writeFileSync(a.out, assembled);
    console.error('mr-build: wrote ' + a.out + ' (template ' + template.name + ', ' + tplPath + ')');
    console.log('PASS ' + a.out);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}
