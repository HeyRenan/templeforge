// GitLab driver (gitlab.com and self-managed). Token: GITLAB_TOKEN / GLAB_TOKEN,
// else the `glab` CLI login. GitLab accepts both PATs and OAuth tokens as Bearer.

import { request, tokenFromCli } from './rest.mjs';

export function resolveAuth(host) {
  const token = process.env.GITLAB_TOKEN || process.env.GLAB_TOKEN;
  if (token) return { header: `Bearer ${token}`, source: 'GITLAB_TOKEN' };
  const cliToken = tokenFromCli('glab', ['config', 'get', 'token', '--host', host]);
  if (cliToken) return { header: `Bearer ${cliToken}`, source: 'glab' };
  throw new Error('no GitLab token: run `glab auth login` or set GITLAB_TOKEN');
}

// GitLab has no draft flag on the API; the "Draft:" title prefix is the signal.
export function draftTitle(title, draft) {
  if (!draft || /^\s*(draft|wip)\s*:/i.test(title)) return title;
  return `Draft: ${title}`;
}

export async function openOrUpdate({ host, project, source, target, title, description, draft }) {
  const { header } = resolveAuth(host);
  const base = `https://${host}/api/v4/projects/${encodeURIComponent(project)}/merge_requests`;
  const call = (method, path, body) => request('GitLab', base + path, { method, headers: { Authorization: header }, body });
  const finalTitle = draftTitle(title, draft);

  const openRequests = await call('GET', `?state=opened&source_branch=${encodeURIComponent(source)}`);
  if (openRequests.length) {
    const mergeRequest = await call('PUT', `/${openRequests[0].iid}`, { title: finalTitle, description });
    return { url: mergeRequest.web_url, action: 'updated' };
  }
  const mergeRequest = await call('POST', '', {
    source_branch: source, target_branch: target, title: finalTitle, description,
  });
  return { url: mergeRequest.web_url, action: 'created' };
}
