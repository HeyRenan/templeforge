// Zero-dep GitHub client (node fetch). Mirrors lib/gitlab.mjs's surface so the
// host router can treat both providers uniformly.
//
// Exports:
//   resolveAuth()  -> { token, scheme:'bearer' }
//   resolveToken() -> token
//   openOrUpdatePR(repo, { sourceBranch, targetBranch, title, description, draft })
//   getDefaultBranch(repo)
//
// `repo` is "owner/name". Auth: GITHUB_TOKEN (or GH_TOKEN) env -> Bearer.
// Falls back to the `gh` CLI's stored token (`gh auth token`) when present.
// Host comes from the detected remote (set by the router), then GITHUB_HOST, then
// github.com — see setHost below. GHE uses /api/v3.

import { execFileSync } from 'node:child_process';
import { parseBody, errorDetail } from './rest.mjs';

// Host order: router-set (from the detected remote) > $GITHUB_HOST > github.com.
// Without this a GitHub Enterprise remote would still hit api.github.com.
let HOST = process.env.GITHUB_HOST || 'github.com';
export function setHost(h) { if (h) HOST = h; }
// github.com -> api.github.com/...  ;  GHE host -> https://HOST/api/v3
const api = () => (HOST === 'github.com' ? 'https://api.github.com' : `https://${HOST}/api/v3`);

const ACCEPT = 'application/vnd.github+json';
const API_VERSION = '2022-11-28';

function fromGhCli() {
  try {
    const args = ['auth', 'token'];
    if (HOST !== 'github.com') args.push('--hostname', HOST);
    const out = execFileSync('gh', args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function resolveAuth() {
  const pat = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (pat) return { token: pat, scheme: 'bearer' };
  const cli = fromGhCli();
  if (cli) return { token: cli, scheme: 'bearer' };
  throw new Error(
    'No GitHub token. Set GITHUB_TOKEN env (Settings > Developer settings > ' +
    'Personal access tokens; classic needs `repo` scope, fine-grained needs ' +
    'Contents:write + Pull requests:write), or install gh and run `gh auth login`.'
  );
}

export const resolveToken = () => resolveAuth().token;

function headers() {
  const { token } = resolveAuth();
  return {
    Authorization: `Bearer ${token}`,
    Accept: ACCEPT,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'templeforge',
  };
}

export function splitRepo(repo) {
  const parts = String(repo).replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Bad GitHub repo "${repo}", expected "owner/name".`);
  }
  return { owner: parts[0], repo: parts[1] };
}

async function req(method, path, { body } = {}) {
  const opts = { method, headers: headers() };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${api()}${path}`, opts);
  const json = parseBody(await res.text());
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${errorDetail(json)}`);
  }
  return json;
}

export async function getDefaultBranch(repo) {
  const { owner, repo: name } = splitRepo(repo);
  const r = await req('GET', `/repos/${owner}/${name}`);
  return r.default_branch || 'main';
}

export async function findOpenPR(repo, sourceBranch) {
  const { owner, repo: name } = splitRepo(repo);
  // For same-repo branches GitHub still wants head = "owner:branch".
  const head = `${owner}:${sourceBranch}`;
  const list = await req('GET',
    `/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(head)}`);
  return Array.isArray(list) && list.length ? list[0] : null;
}

export async function createPR(repo, { sourceBranch, targetBranch, title, description, draft = false }) {
  const { owner, repo: name } = splitRepo(repo);
  const base = targetBranch || await getDefaultBranch(repo);
  return req('POST', `/repos/${owner}/${name}/pulls`, {
    body: {
      title,
      head: sourceBranch,   // same-repo branch name; for forks pass "forkowner:branch"
      base,
      body: description,
      draft,
    },
  });
}

export async function updatePR(repo, number, fields) {
  const { owner, repo: name } = splitRepo(repo);
  return req('PATCH', `/repos/${owner}/${name}/pulls/${number}`, { body: fields });
}

export async function openOrUpdatePR(repo, args) {
  const existing = await findOpenPR(repo, args.sourceBranch);
  if (existing) {
    const updated = await updatePR(repo, existing.number, {
      title: args.title,
      body: args.description,
    });
    return { web_url: updated.html_url, iid: updated.number, action: 'updated' };
  }
  const created = await createPR(repo, args);
  return { web_url: created.html_url, iid: created.number, action: 'created' };
}

// Alias so the host layer can call openOrUpdateMR on either provider.
export const openOrUpdateMR = openOrUpdatePR;
