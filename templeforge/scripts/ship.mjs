#!/usr/bin/env node
// Provider-agnostic ship: branch off target, commit (no AI signature), push,
// then open/update the MR (GitLab) or PR (GitHub). Routes via lib/host.mjs.
// Prefers the native CLI (glab / gh) when present+authed, falls back to REST.
//
//   node ship.mjs --slug feat/x --title "T" --desc descfile [--message "msg"]
//                 [--target main] [--project owner/repo] [--draft]
//
// --project overrides remote detection (form "group/repo" or "owner/repo").
// Prints the MR/PR web url on stdout; diagnostics go to stderr.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { detectHost } from '../lib/host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const map = {
      '--slug': 'slug', '--title': 'title', '--desc': 'desc',
      '--message': 'message', '--target': 'target', '--project': 'project',
    };
    if (k === '--draft') { a.draft = true; continue; }
    if (map[k]) { a[map[k]] = argv[++i]; continue; }
    throw new Error(`ship.mjs: unknown arg ${k}`);
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

function refuseAISig(msg) {
  // Case-insensitive AND whitespace/separator-tolerant: catches "co_authored_by",
  // "Co Authored By", "Generated  with", etc., not just the canonical spelling.
  if (/co[-_\s]?authored[-_\s]?by|generated\s+with|🤖/i.test(msg)) {
    throw new Error('ship.mjs: refusing AI signature in commit message');
  }
}

function gitInit(slug, target) {
  const staged = (() => { try { return sh('git', ['diff', '--cached', '--name-only']); } catch { return ''; } })();
  const offenders = staged.split('\n').filter((l) => /(^|\/)(build|dist)\//.test(l));
  if (offenders.length) {
    throw new Error('ship.mjs: refusing to commit build artifacts:\n  ' + offenders.join('\n  '));
  }
  const cur = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (cur !== slug) {
    shQuiet('git', ['checkout', target]);
    shQuiet('git', ['pull', '--ff-only']);
    if (!shQuiet('git', ['checkout', '-b', slug])) shQuiet('git', ['checkout', slug]);
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
  if (shQuiet('git', ['push', '-u', 'origin', slug])) return;
  shQuiet('git', ['push']);
}

// ---- GitLab native (glab) ----
function glabAuthed() {
  try { execFileSync('glab', ['auth', 'status'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function glabShip({ slug, target, title, desc }) {
  const view = (() => { try { return sh('glab', ['mr', 'view', slug, '-F', 'json']); } catch { return ''; } })();
  if (/"iid"/.test(view)) {
    sh('glab', ['mr', 'update', slug, '--title', title, '--description', readFileSync(desc, 'utf8')]);
  } else {
    sh('glab', ['mr', 'create', '--source-branch', slug, '--target-branch', target,
      '--title', title, '--description', readFileSync(desc, 'utf8'), '--yes']);
  }
  const out = (() => { try { return sh('glab', ['mr', 'view', slug, '-F', 'json']); } catch { return ''; } })();
  const m = out.match(/"web_url":\s*"([^"]+\/merge_requests\/\d+)"/);
  return m ? m[1] : `opened MR for ${slug} (run: glab mr view ${slug})`;
}

// ---- GitHub native (gh) ----
function ghAuthed() {
  try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function ghShip({ slug, target, title, desc, draft }) {
  const existing = (() => {
    try { return sh('gh', ['pr', 'view', slug, '--json', 'url,number']); } catch { return ''; }
  })();
  if (/"number"/.test(existing)) {
    sh('gh', ['pr', 'edit', slug, '--title', title, '--body-file', desc]);
    const m = existing.match(/"url":\s*"([^"]+)"/);
    if (m) return m[1];
  } else {
    const args = ['pr', 'create', '--head', slug, '--base', target,
      '--title', title, '--body-file', desc];
    if (draft) args.push('--draft');
    const created = sh('gh', args).trim();
    const url = created.split('\n').find((l) => /^https?:\/\//.test(l));
    if (url) return url;
  }
  const out = (() => { try { return sh('gh', ['pr', 'view', slug, '--json', 'url']); } catch { return ''; } })();
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
  if (!existsSync(descPath)) { console.error('ship.mjs: desc file not found: ' + descPath); process.exit(1); }
  args.desc = descPath;

  // Provider/host always come from the real origin remote. --project only
  // overrides the path (group/repo), never the provider — a synthetic URL would
  // misdetect the provider for a self-hosted or GitHub remote.
  const host = await detectHost();
  const project = args.project || host.project;
  // Resolve the target branch from the forge when the driver can tell us;
  // GitLab MRs default to 'main' (glab handles it server-side).
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
    url = ghShip({ slug: args.slug, target, title: args.title, desc: args.desc, draft: !!args.draft });
  } else if (host.provider === 'gitlab' && has('glab') && glabAuthed()) {
    url = glabShip({ slug: args.slug, target, title: args.title, desc: args.desc });
  } else {
    const r = await host.client.openOrUpdateMR(project, {
      sourceBranch: args.slug, targetBranch: target, title: args.title,
      description: readFileSync(args.desc, 'utf8'), draft: !!args.draft,
    });
    const tag = host.provider === 'gitlab' ? `!${r.iid}` : `#${r.iid}`;
    console.error(`${host.term} ${r.action} (${tag})`);
    url = r.web_url;
  }
  console.log(url);
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
