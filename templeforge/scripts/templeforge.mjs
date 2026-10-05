#!/usr/bin/env node
// templeforge CLI. Every step the agent would otherwise do by hand lives here, so
// opening a request costs two calls: `context`, then `open`.
//
//   templeforge.mjs context                 repo, auth, branch, commits, template rules + hints
//   templeforge.mjs open [--dry-run] < req  validate, branch, push, open/update, link Wrike
//   templeforge.mjs init-template [--global]
//
// `open` reads one JSON object on stdin:
//   { "title": "feat: x", "slug": "feat/x", "wrike": "<permalink>", "draft": false,
//     "vars": { "ticket": "AB-1" }, "sections": { "summary": "...", "testing": "..." } }
// Output lines start with PLAN, FAIL, WARN, DONE or WRIKE.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { detectHost } from '../lib/host.mjs';
import { linkTask } from '../lib/wrike.mjs';
import * as git from '../lib/git.mjs';
import {
  BUILT_IN_TEMPLATE, describeTemplate, globalTemplatePath, isPlainObject, loadTemplate,
  render, repoTemplatePath, resolveTemplatePath,
} from '../lib/template.mjs';

const MAX_LISTED = 20;

class UsageError extends Error {}

function repoContext() {
  const root = git.repoRoot();
  if (!root) throw new UsageError('not inside a git repository');
  const templatePath = resolveTemplatePath(root);
  return { templatePath, template: loadTemplate(templatePath), base: git.defaultBranch() };
}

function indentedList(label, lines) {
  if (!lines.length) return [];
  const shown = lines.slice(0, MAX_LISTED).map((line) => `  ${line}`);
  if (lines.length > MAX_LISTED) shown.push(`  ... ${lines.length - MAX_LISTED} more`);
  return [`${label}:`, ...shown];
}

const splitLines = (text) => (text ? text.split('\n') : []);

async function showContext() {
  const { templatePath, template, base } = repoContext();
  const host = await detectHost(git.originUrl());
  git.fetchBase(base);
  let auth;
  try {
    auth = `ok (${host.driver.resolveAuth(host.host).source})`;
  } catch (error) {
    auth = `MISSING: ${error.message}`;
  }
  const branch = git.currentBranch() ?? '(detached)';
  const ahead = git.commitsAhead(base);
  const dirty = git.uncommittedFiles();
  console.log([
    `repo ${host.provider} ${host.project} (${host.host}), opens a ${host.term}`,
    `auth ${auth}`,
    `branch ${branch}  base ${base}  ahead ${ahead ?? '?'}  uncommitted ${dirty.length}`,
    ...indentedList('commits', splitLines(git.tryGit(['log', '--oneline', `origin/${base}..HEAD`]))),
    ...indentedList('changed', splitLines(git.tryGit(['diff', '--stat=100', `origin/${base}...HEAD`]))),
    ...indentedList('uncommitted', dirty),
    `template ${template.name ?? 'unnamed'} (${templatePath})`,
    describeTemplate(template),
  ].join('\n'));
}

function readRequest() {
  if (process.stdin.isTTY) throw new UsageError('open reads the request JSON on stdin');
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error) {
    throw new UsageError(`request is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(input)) throw new UsageError('request must be a JSON object');
  const problems = requestProblems(input);
  if (problems.length) throw new UsageError(problems.join('; '));
  return input;
}

function requestProblems(input) {
  const problems = [];
  if (typeof input.title !== 'string' || !input.title.trim()) problems.push('title: required string');
  if (!isPlainObject(input.sections) || !Object.values(input.sections).every((body) => typeof body === 'string')) {
    problems.push('sections: required object of section id -> markdown string');
  }
  for (const key of ['slug', 'wrike']) {
    if (input[key] != null && typeof input[key] !== 'string') problems.push(`${key}: must be a string`);
  }
  if (input.vars != null && !isPlainObject(input.vars)) problems.push('vars: must be an object');
  if (input.draft != null && typeof input.draft !== 'boolean') problems.push('draft: must be a boolean');
  return problems;
}

function chooseBranch(slug, base) {
  const branch = slug || git.currentBranch();
  if (!branch || branch === base) throw new UsageError(`slug required: you are on ${base}`);
  if (git.tryGit(['check-ref-format', '--branch', branch]) === null) throw new UsageError(`invalid branch name: ${branch}`);
  return branch;
}

async function openRequest({ dryRun }) {
  const input = readRequest();
  const { template, base } = repoContext();
  const { description, violations } = render(template, input);
  if (violations.length) {
    console.log(`FAIL template "${template.name ?? 'unnamed'}" (nothing pushed):`);
    for (const violation of violations) console.log(`  - ${violation}`);
    return 1;
  }
  const branch = chooseBranch(input.slug, base);
  const host = await detectHost(git.originUrl());
  console.log(`PLAN ${host.provider} ${host.project} ${branch} -> ${base}${input.draft ? ' (draft)' : ''}`);
  if (dryRun) {
    console.log(`title: ${input.title}\n\n${description}`);
    return 0;
  }

  // Fail on missing auth before anything is pushed.
  host.driver.resolveAuth(host.host);
  git.fetchBase(base);
  git.switchToBranch(branch, base);
  const dirty = git.uncommittedFiles();
  if (dirty.length) console.log(`WARN ${dirty.length} uncommitted file(s) are not in the request`);
  if (git.commitsAhead(base) === 0) throw new UsageError(`no commits on ${branch} ahead of origin/${base}`);
  git.push(branch);
  const opened = await host.driver.openOrUpdate({
    host: host.host, project: host.project, source: branch, target: base,
    title: input.title, description, draft: Boolean(input.draft),
  });
  console.log(`DONE ${opened.url} (${host.term} ${opened.action})`);
  if (input.wrike) await reportWrikeLink(input.wrike, opened.url);
  return 0;
}

// The request is already open, so a Wrike failure is reported, never fatal.
async function reportWrikeLink(task, requestUrl) {
  try {
    const link = await linkTask(task, requestUrl);
    console.log(link.status === 'todo'
      ? `WRIKE todo: no WRIKE_TOKEN; append to task ${link.taskId} description unless present: ${link.block}`
      : `WRIKE ${link.status} (task ${link.taskId})`);
  } catch (error) {
    console.log(`WRIKE failed: ${error.message}`);
  }
}

function initTemplate({ isGlobal }) {
  const root = git.repoRoot();
  if (!isGlobal && !root) throw new UsageError('not inside a git repository (use --global)');
  const destination = isGlobal ? globalTemplatePath() : repoTemplatePath(root);
  if (existsSync(destination)) throw new UsageError(`${destination} already exists; edit it directly`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(BUILT_IN_TEMPLATE, destination);
  console.log(`wrote ${destination}`);
  return 0;
}

async function main(args) {
  const [command, ...flags] = args;
  if (command === 'context') return showContext().then(() => 0);
  if (command === 'open') return openRequest({ dryRun: flags.includes('--dry-run') });
  if (command === 'init-template') return initTemplate({ isGlobal: flags.includes('--global') });
  throw new UsageError('usage: templeforge.mjs context | open [--dry-run] < request.json | init-template [--global]');
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error) => {
    const detail = error instanceof UsageError ? error.message : (error.stderr?.trim() || error.message);
    console.log(`FAIL ${detail}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  },
);
