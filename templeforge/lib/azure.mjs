// Zero-dep Azure DevOps client. Node stdlib only (global fetch).
// Auth: a Personal Access Token via Basic auth (":PAT" base64). Resolve from
//   $AZURE_DEVOPS_TOKEN (or $AZURE_TOKEN).
// "project" is "org/project/repo" (Azure nests an org and a project above the
// repo). Contract: openOrUpdateMR, resolveAuth.

import { parseBody, errorDetail } from './rest.mjs';

const API_VERSION = '7.1';

export function resolveAuth() {
  const token = process.env.AZURE_DEVOPS_TOKEN || process.env.AZURE_TOKEN;
  if (token) return { token: Buffer.from(`:${token}`).toString('base64'), scheme: 'basic' };
  throw new Error(
    'No Azure DevOps token. Set AZURE_DEVOPS_TOKEN (User settings > Personal access tokens, ' +
    'scope: Code Read & Write).'
  );
}

export const resolveToken = () => resolveAuth().token;

function headers() {
  const { token } = resolveAuth();
  return { Authorization: `Basic ${token}` };
}

export function splitRepo(project) {
  // A real Azure remote is "{org}/{project}/_git/{repo}"; parseRemote keeps the
  // "_git" path segment, so drop it before splitting org/project/repo.
  const [org, proj, ...rest] = project.split('/').filter((s) => s && s !== '_git');
  if (!org || !proj || !rest.length) {
    throw new Error('Azure project must be "org/project/repo", got: ' + project);
  }
  return { org, project: proj, repo: rest.join('/') };
}

function base(org, project, repo) {
  return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
}

async function req(method, url, { body } = {}) {
  const sep = url.includes('?') ? '&' : '?';
  const opts = { method, headers: headers() };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${url}${sep}api-version=${API_VERSION}`, opts);
  const json = parseBody(await res.text());
  if (!res.ok) {
    throw new Error(`Azure ${method} ${url} -> ${res.status}: ${errorDetail(json)}`);
  }
  return json;
}

export async function getDefaultBranch(project) {
  const { org, project: proj, repo } = splitRepo(project);
  const r = await req('GET', base(org, proj, repo));
  const ref = (r && r.defaultBranch) || 'refs/heads/main';
  return ref.replace(/^refs\/heads\//, '');
}

function refName(branch) {
  return branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`;
}

export async function findOpenPR(project, sourceBranch) {
  const { org, project: proj, repo } = splitRepo(project);
  const src = encodeURIComponent(refName(sourceBranch));
  const list = await req('GET',
    `${base(org, proj, repo)}/pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=${src}`);
  return list && Array.isArray(list.value) && list.value.length ? list.value[0] : null;
}

export async function createPR(project, { sourceBranch, targetBranch, title, description, draft = false }) {
  const { org, project: proj, repo } = splitRepo(project);
  return req('POST', `${base(org, proj, repo)}/pullrequests`, {
    body: {
      sourceRefName: refName(sourceBranch),
      targetRefName: refName(targetBranch || 'main'),
      title,
      description: description || '',
      isDraft: !!draft,
    },
  });
}

export async function updatePR(project, prId, fields) {
  const { org, project: proj, repo } = splitRepo(project);
  const body = {};
  if (fields.title != null) body.title = fields.title;
  if (fields.description != null) body.description = fields.description;
  return req('PATCH', `${base(org, proj, repo)}/pullrequests/${prId}`, { body });
}

function webUrl(project, pr) {
  const { org, project: proj, repo } = splitRepo(project);
  return `https://dev.azure.com/${org}/${encodeURIComponent(proj)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}`;
}

export async function openOrUpdatePR(project, args) {
  const existing = await findOpenPR(project, args.sourceBranch);
  if (existing) {
    const updated = await updatePR(project, existing.pullRequestId, { title: args.title, description: args.description });
    return { web_url: webUrl(project, updated), iid: updated.pullRequestId, action: 'updated' };
  }
  const created = await createPR(project, args);
  return { web_url: webUrl(project, created), iid: created.pullRequestId, action: 'created' };
}

export const openOrUpdateMR = openOrUpdatePR;
