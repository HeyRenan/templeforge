#!/usr/bin/env node
// Provider-agnostic ship: branch off target, commit (no AI signature), push,
// then open/update the request on any of the five forges (GitLab MR / GitHub,
// Bitbucket, Gitea, Azure PR). Routes via lib/host.mjs. Prefers the native CLI
// (glab / gh) when present+authed, falls back to the zero-dep REST driver.
//
//   node ship.mjs --slug feat/x --title "T" --desc descfile [--message "msg"]
//                 [--target main] [--project owner/repo] [--draft]
//
// --project overrides remote detection (form "group/repo" or "owner/repo").
// Prints the MR/PR web url on stdout; diagnostics go to stderr.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectHost } from '../lib/host.mjs';

const VALUE_FLAGS = {
  '--slug': 'slug', '--title': 'title', '--desc': 'desc',
  '--message': 'message', '--target': 'target', '--project': 'project',
};

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--draft') { a.draft = true; continue; }
    if (VALUE_FLAGS[k]) { a[VALUE_FLAGS[k]] = argv[++i]; continue; }
    throw new Error(`ship: unknown arg ${k}`);
  }
  return a;
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function shQuiet(cmd, args) {
  try { sh(cmd, args); return true; } catch { return false; }
}
function has(bin) {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// How each forge marks a draft request:
//   - title-marker forges (gitlab, gitea) have NO draft flag; a title prefix
//     ("Draft:" / "WIP:") is the only signal.
//   - flag forges (github, bitbucket, azure) take a real boolean on the API.
const DRAFT_TITLE_MARKER = { gitlab: 'Draft', gitea: 'WIP' };

// Resolve draft into the two things the call sites need: the title to send and
// whether to pass a native draft flag. For marker forges we prefix the title
// (idempotently — never stack "Draft: Draft:") and DON'T set a flag; for flag
// forges we leave the title and set the flag. draft=false is a clean no-op.
export function applyDraft(provider, title, draft) {
  if (!draft) return { title, flag: false };
  const marker = DRAFT_TITLE_MARKER[provider];
  if (marker) {
    const prefixed = /^\s*(draft|wip):/i.test(title) ? title : `${marker}: ${title}`;
    return { title: prefixed, flag: false };
  }
  return { title, flag: true };
}

function refuseAISig(msg) {
  // Case-insensitive AND whitespace/separator-tolerant: catches "co_authored_by",
  // "Co Authored By", "Generated  with", etc., not just the canonical spelling.
  if (/co[-_\s]?authored[-_\s]?by|generated\s+with|🤖/i.test(msg)) {
    throw new Error('ship: refusing AI signature in commit message');
  }
}

function gitInit(slug, target) {
  const staged = (() => { try { return sh('git', ['diff', '--cached', '--name-only']); } catch { return ''; } })();
  const offenders = staged.split('\n').filter((l) => /(^|\/)(build|dist)\//.test(l));
  if (offenders.length) {
    throw new Error('ship: refusing to commit build artifacts:\n  ' + offenders.join('\n  '));
  }
  const cur = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (cur !== slug) {
    shQuiet('git', ['checkout', target]);
    shQuiet('git', ['pull', '--ff-only']);
    if (!shQuiet('git', ['checkout', '-b', slug])) shQuiet('git', ['checkout', slug]);
  }
  // Both checkouts are best-effort (a dirty tree or an existing branch elsewhere
  // can make them fail silently). Assert we actually landed on the slug branch —
  // otherwise the commit + push below would target the WRONG branch (e.g. main).
  const now = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (now !== slug) {
    throw new Error(`ship: expected to be on branch "${slug}" but on "${now}" — ` +
      'resolve your working tree (uncommitted changes? branch exists?) and retry.');
  }
}

function gitCommit(message) {
  if (!message) return;
  const clean = (() => { try { sh('git', ['diff', '--cached', '--quiet']); return true; } catch { return false; } })();
  if (clean) return; // nothing staged
  refuseAISig(message);
  sh('git', ['commit', '-m', message]);
}

function gitPush(slug) {
  // gitInit guarantees HEAD is the slug branch, so a bare push targets the right
  // ref. Try to set upstream first; fall back to a plain push. If BOTH fail, say
  // so — opening the request against an unpushed branch would just error obscurely.
  if (shQuiet('git', ['push', '-u', 'origin', slug])) return;
  if (shQuiet('git', ['push'])) return;
  throw new Error(`ship: failed to push branch "${slug}" to origin — ` +
    'check your remote and credentials, then retry.');
}

// gh and glab both take "-R owner/repo" to target a repo other than the cwd's.
// Without this the native fast path silently ignored --project (the REST path
// honors it), so `ship --project other/repo` opened the request on the WRONG
// repo whenever gh/glab happened to be installed. Empty when no override.
export function repoFlag(project) {
  return project ? ['-R', project] : [];
}

// ---- GitLab native (glab) ----
function glabAuthed() {
  try { execFileSync('glab', ['auth', 'status'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function glabShip({ slug, target, title, desc, draft, project }) {
  // GitLab marks a draft by a "Draft:" title prefix (no API/CLI draft flag).
  const { title: finalTitle } = applyDraft('gitlab', title, draft);
  const R = repoFlag(project);
  const view = (() => { try { return sh('glab', ['mr', 'view', slug, '-F', 'json', ...R]); } catch { return ''; } })();
  const exists = /"iid"/.test(view);
  if (exists) {
    sh('glab', ['mr', 'update', slug, '--title', finalTitle, '--description', readFileSync(desc, 'utf8'), ...R]);
  } else {
    sh('glab', ['mr', 'create', '--source-branch', slug, '--target-branch', target,
      '--title', finalTitle, '--description', readFileSync(desc, 'utf8'), '--yes', ...R]);
  }
  console.error('merge request ' + (exists ? 'updated' : 'created') + ' via glab');
  const out = (() => { try { return sh('glab', ['mr', 'view', slug, '-F', 'json', ...R]); } catch { return ''; } })();
  const m = out.match(/"web_url":\s*"([^"]+\/merge_requests\/\d+)"/);
  return m ? m[1] : `opened MR for ${slug} (run: glab mr view ${slug})`;
}

// ---- GitHub native (gh) ----
function ghAuthed() {
  try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function ghShip({ slug, target, title, desc, draft, project }) {
  const R = repoFlag(project);
  const existing = (() => {
    try { return sh('gh', ['pr', 'view', slug, '--json', 'url,number', ...R]); } catch { return ''; }
  })();
  if (/"number"/.test(existing)) {
    sh('gh', ['pr', 'edit', slug, '--title', title, '--body-file', desc, ...R]);
    console.error('pull request updated via gh');
    const m = existing.match(/"url":\s*"([^"]+)"/);
    if (m) return m[1];
  } else {
    const args = ['pr', 'create', '--head', slug, '--base', target,
      '--title', title, '--body-file', desc, ...R];
    if (draft) args.push('--draft');
    const created = sh('gh', args).trim();
    console.error('pull request created via gh');
    const url = created.split('\n').find((l) => /^https?:\/\//.test(l));
    if (url) return url;
  }
  const out = (() => { try { return sh('gh', ['pr', 'view', slug, '--json', 'url', ...R]); } catch { return ''; } })();
  const m2 = out.match(/"url":\s*"([^"]+)"/);
  return m2 ? m2[1] : `opened PR for ${slug} (run: gh pr view ${slug})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || !args.title || !args.desc) {
    console.error('usage: ship.mjs --slug X --title T --desc FILE [--message M] [--target main] [--project owner/repo] [--draft]');
    process.exit(2);
  }
  const descPath = resolve(args.desc);
  if (!existsSync(descPath)) { console.error('ship: desc file not found: ' + descPath); process.exit(1); }
  args.desc = descPath;

  // Provider/host always come from the real origin remote. --project only
  // overrides the path (group/repo), never the provider — a synthetic URL would
  // misdetect the provider for a self-hosted or GitHub remote.
  const host = await detectHost();
  const project = args.project || host.project;
  // Resolve the target from the forge's real default branch (all five drivers
  // expose getDefaultBranch); fall back to 'main' only if the lookup fails or a
  // future driver lacks it. --target overrides everything.
  const target = args.target || (typeof host.client.getDefaultBranch === 'function'
    ? await host.client.getDefaultBranch(project).catch(() => 'main')
    : 'main');

  gitInit(args.slug, target);
  gitCommit(args.message);
  gitPush(args.slug);

  // Native CLI fast path for the two forges that ship one (gh / glab). Every
  // other provider (bitbucket, gitea, azure, self-hosted) goes straight to its
  // zero-dep REST driver. The vocabulary (MR vs PR) follows host.term.
  let url;
  if (host.provider === 'github' && has('gh') && ghAuthed()) {
    url = ghShip({ slug: args.slug, target, title: args.title, desc: args.desc, draft: !!args.draft, project: args.project });
  } else if (host.provider === 'gitlab' && has('glab') && glabAuthed()) {
    url = glabShip({ slug: args.slug, target, title: args.title, desc: args.desc, draft: !!args.draft, project: args.project });
  } else {
    // Marker forges (gitlab, gitea) get a title prefix; flag forges (bitbucket,
    // azure) get the boolean. applyDraft returns whichever this provider uses.
    const { title, flag } = applyDraft(host.provider, args.title, !!args.draft);
    const r = await host.client.openOrUpdateMR(project, {
      sourceBranch: args.slug, targetBranch: target, title,
      description: readFileSync(args.desc, 'utf8'), draft: flag,
    });
    const tag = host.provider === 'gitlab' ? `!${r.iid}` : `#${r.iid}`;
    console.error(`${host.term} ${r.action} (${tag})`);
    url = r.web_url;
  }
  console.log(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
