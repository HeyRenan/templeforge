// Zero-dep Bitbucket Cloud client. Node stdlib only (global fetch).
// Auth: an app password sent via Basic auth. Resolve, in order:
//   1. $BITBUCKET_TOKEN (treated as a raw bearer/access token)
//   2. $BITBUCKET_USERNAME + $BITBUCKET_APP_PASSWORD (Basic)
// Host is Bitbucket Cloud (api.bitbucket.org/2.0). "project" is "workspace/repo".
// Contract matches the other drivers: openOrUpdateMR, resolveAuth.

import { parseBody, errorDetail } from './rest.mjs';

const API = 'https://api.bitbucket.org/2.0';

export function resolveAuth() {
  const token = process.env.BITBUCKET_TOKEN;
  if (token) return { token, scheme: 'bearer' };
  const user = process.env.BITBUCKET_USERNAME;
  const pass = process.env.BITBUCKET_APP_PASSWORD;
  if (user && pass) return { token: Buffer.from(`${user}:${pass}`).toString('base64'), scheme: 'basic' };
  throw new Error(
    'No Bitbucket credentials. Set BITBUCKET_TOKEN (access token), or ' +
    'BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD (Settings > App passwords, scope: pullrequest:write).'
  );
}

export const resolveToken = () => resolveAuth().token;

function headers() {
  const { token, scheme } = resolveAuth();
  return scheme === 'basic'
    ? { Authorization: `Basic ${token}` }
    : { Authorization: `Bearer ${token}` };
}

export function splitRepo(project) {
  const [workspace, ...rest] = project.split('/').filter(Boolean);
  return { workspace, repo: rest.join('/') };
}

async function req(method, path, { body } = {}) {
  const opts = { method, headers: headers() };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);
  const json = parseBody(await res.text());
  if (!res.ok) {
    throw new Error(`Bitbucket ${method} ${path} -> ${res.status}: ${errorDetail(json)}`);
  }
  return json;
}

export async function getDefaultBranch(project) {
  const { workspace, repo } = splitRepo(project);
  const r = await req('GET', `/repositories/${workspace}/${repo}`);
  return (r && r.mainbranch && r.mainbranch.name) || 'main';
}

export async function findOpenPR(project, sourceBranch) {
  const { workspace, repo } = splitRepo(project);
  // Escape \ and " inside the BBQL string literal — git allows a double quote in a
  // branch name, which would otherwise close the literal and break the query (URL
  // encoding is not query escaping). BBQL escapes both with a backslash.
  const safeBranch = sourceBranch.replace(/[\\"]/g, '\\$&');
  const q = encodeURIComponent(`state="OPEN" AND source.branch.name="${safeBranch}"`);
  const list = await req('GET', `/repositories/${workspace}/${repo}/pullrequests?q=${q}`);
  return list && Array.isArray(list.values) && list.values.length ? list.values[0] : null;
}

export async function createPR(project, { sourceBranch, targetBranch, title, description, draft = false }) {
  const { workspace, repo } = splitRepo(project);
  return req('POST', `/repositories/${workspace}/${repo}/pullrequests`, {
    body: {
      title,
      description: description || '',
      draft: !!draft,
      source: { branch: { name: sourceBranch } },
      destination: { branch: { name: targetBranch || 'main' } },
    },
  });
}

export async function updatePR(project, id, fields) {
  const { workspace, repo } = splitRepo(project);
  return req('PUT', `/repositories/${workspace}/${repo}/pullrequests/${id}`, { body: fields });
}

function webUrl(pr) {
  return (pr && pr.links && pr.links.html && pr.links.html.href) || '';
}

export async function openOrUpdatePR(project, args) {
  const existing = await findOpenPR(project, args.sourceBranch);
  if (existing) {
    const updated = await updatePR(project, existing.id, { title: args.title, description: args.description });
    return { web_url: webUrl(updated), iid: updated.id, action: 'updated' };
  }
  const created = await createPR(project, args);
  return { web_url: webUrl(created), iid: created.id, action: 'created' };
}

// Uniform name so host.client.openOrUpdateMR works for every provider.
export const openOrUpdateMR = openOrUpdatePR;
