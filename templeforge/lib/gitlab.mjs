// Zero-dep GitLab client. Node stdlib only (global fetch, node:fs, node:child_process).
// Portable: no `glab` binary required. Resolves a token from, in order:
//   1. $GITLAB_TOKEN  2. $GLAB_TOKEN  3. ~/.config/glab-cli/config.yml or
//      ~/Library/Application Support/glab-cli/config.yml (if glab happens to be set up)
// Host comes from the detected remote (set by the router), then $GITLAB_HOST,
// then gitlab.com — see setHost below.

import { execFileSync } from 'node:child_process';
import { parseBody, errorDetail } from './rest.mjs';

// Host resolution order: an explicit host set by the router (from the detected
// remote) wins, then $GITLAB_HOST, then gitlab.com. This is what makes a
// self-managed GitLab work via remote detection — without it every REST call hit
// gitlab.com regardless of the origin.
let HOST = process.env.GITLAB_HOST || 'gitlab.com';
export function setHost(h) { if (h) HOST = h; }
const api = () => `https://${HOST}/api/v4`;

// If glab is installed and logged in, ask it for the token. Most reliable —
// glab stores tokens in YAML or the OS keyring, which we shouldn't parse by hand.
function fromGlab() {
  try {
    const out = execFileSync('glab', ['config', 'get', 'token', '--host', HOST], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Returns { token, scheme }. PATs (from GITLAB_TOKEN env) authenticate via the
// PRIVATE-TOKEN header; glab's stored credential is an OAuth token and needs
// Authorization: Bearer. We tag the source so we send the right header.
let _glabSource = fromGlab;
export function setGlabSource(fn) { _glabSource = typeof fn === 'function' ? fn : fromGlab; }

export function resolveAuth() {
  const pat = process.env.GITLAB_TOKEN || process.env.GLAB_TOKEN;
  if (pat) return { token: pat, scheme: 'private' };
  const oauth = _glabSource();
  if (oauth) return { token: oauth, scheme: 'bearer' };
  throw new Error(
    'No GitLab token. Set GITLAB_TOKEN env (Settings > Access Tokens, scope: api), ' +
    'or install glab and run `glab auth login`.'
  );
}

export const resolveToken = () => resolveAuth().token;

function headers() {
  const { token, scheme } = resolveAuth();
  return scheme === 'bearer'
    ? { Authorization: `Bearer ${token}` }
    : { 'PRIVATE-TOKEN': token };
}

export const encodeProject = (p) => encodeURIComponent(p); // "group/repo" -> "group%2Frepo"

async function req(method, path, { body, form } = {}) {
  const opts = { method, headers: headers() };
  if (form) {
    opts.body = form; // FormData
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${api()}${path}`, opts);
  const json = parseBody(await res.text());
  if (!res.ok) {
    throw new Error(`GitLab ${method} ${path} -> ${res.status}: ${errorDetail(json)}`);
  }
  return json;
}

// Resolve the project's default branch (so ship targets `master`/custom defaults,
// not a hardcoded `main`). Completes the uniform driver contract — the other four
// providers already expose this.
export async function getDefaultBranch(project) {
  const r = await req('GET', `/projects/${encodeProject(project)}`);
  return (r && r.default_branch) || 'main';
}

// Find an open MR for a source branch (returns the MR object or null)
export async function findOpenMR(project, sourceBranch) {
  const list = await req('GET',
    `/projects/${encodeProject(project)}/merge_requests?state=opened&source_branch=${encodeURIComponent(sourceBranch)}`);
  return Array.isArray(list) && list.length ? list[0] : null;
}

export async function createMR(project, { sourceBranch, targetBranch = 'main', title, description, removeSource = false, squash = false }) {
  return req('POST', `/projects/${encodeProject(project)}/merge_requests`, {
    body: {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      description,
      remove_source_branch: removeSource,
      squash,
    },
  });
}

export async function updateMR(project, iid, fields) {
  return req('PUT', `/projects/${encodeProject(project)}/merge_requests/${iid}`, { body: fields });
}

// Create-or-update: idempotent MR open
export async function openOrUpdateMR(project, args) {
  const existing = await findOpenMR(project, args.sourceBranch);
  if (existing) {
    const updated = await updateMR(project, existing.iid, {
      title: args.title,
      description: args.description,
    });
    return { web_url: updated.web_url, iid: updated.iid, action: 'updated' };
  }
  const created = await createMR(project, args);
  return { web_url: created.web_url, iid: created.iid, action: 'created' };
}
