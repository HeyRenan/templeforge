// Zero-dep Gitea / Forgejo / Codeberg client. Node stdlib only (global fetch).
// Auth: a token via the `token` Authorization scheme. Resolve, in order:
//   1. $GITEA_TOKEN  2. $FORGEJO_TOKEN
// Host defaults to codeberg.org; override with $GITEA_HOST (e.g. gitea.acme.io).
// "project" is "owner/repo". Contract: openOrUpdateMR, resolveAuth.

const HOST = process.env.GITEA_HOST || 'codeberg.org';
const API = `https://${HOST}/api/v1`;

export function resolveAuth() {
  const token = process.env.GITEA_TOKEN || process.env.FORGEJO_TOKEN;
  if (token) return { token };
  throw new Error(
    'No Gitea/Forgejo token. Set GITEA_TOKEN (Settings > Applications > Generate Token, ' +
    'scope: write:repository). Set GITEA_HOST for self-hosted instances.'
  );
}

export const resolveToken = () => resolveAuth().token;

function headers() {
  const { token } = resolveAuth();
  return { Authorization: `token ${token}` };
}

export function splitRepo(project) {
  const [owner, ...rest] = project.split('/');
  return { owner, repo: rest.join('/') };
}

async function req(method, path, { body } = {}) {
  const opts = { method, headers: headers() };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`Gitea ${method} ${path} -> ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

export async function getDefaultBranch(project) {
  const { owner, repo } = splitRepo(project);
  const r = await req('GET', `/repos/${owner}/${repo}`);
  return (r && r.default_branch) || 'main';
}

export async function findOpenPR(project, sourceBranch) {
  const { owner, repo } = splitRepo(project);
  const list = await req('GET', `/repos/${owner}/${repo}/pulls?state=open`);
  if (!Array.isArray(list)) return null;
  return list.find((pr) => pr.head && pr.head.ref === sourceBranch) || null;
}

export async function createPR(project, { sourceBranch, targetBranch, title, description }) {
  const { owner, repo } = splitRepo(project);
  return req('POST', `/repos/${owner}/${repo}/pulls`, {
    body: { head: sourceBranch, base: targetBranch || 'main', title, body: description || '' },
  });
}

export async function updatePR(project, index, fields) {
  const { owner, repo } = splitRepo(project);
  const body = {};
  if (fields.title != null) body.title = fields.title;
  if (fields.description != null) body.body = fields.description;
  return req('PATCH', `/repos/${owner}/${repo}/pulls/${index}`, { body });
}

export async function openOrUpdatePR(project, args) {
  const existing = await findOpenPR(project, args.sourceBranch);
  if (existing) {
    const updated = await updatePR(project, existing.number, { title: args.title, description: args.description });
    return { web_url: updated.html_url, iid: updated.number, action: 'updated' };
  }
  const created = await createPR(project, args);
  return { web_url: created.html_url, iid: created.number, action: 'created' };
}

export const openOrUpdateMR = openOrUpdatePR;
