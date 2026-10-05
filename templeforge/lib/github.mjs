// GitHub driver (github.com and GitHub Enterprise). Token: GITHUB_TOKEN / GH_TOKEN,
// else the `gh` CLI login.

import { request, tokenFromCli } from './rest.mjs';

export function resolveAuth(host) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) return { header: `Bearer ${token}`, source: 'GITHUB_TOKEN' };
  const hostArgs = host === 'github.com' ? [] : ['--hostname', host];
  const cliToken = tokenFromCli('gh', ['auth', 'token', ...hostArgs]);
  if (cliToken) return { header: `Bearer ${cliToken}`, source: 'gh' };
  throw new Error('no GitHub token: run `gh auth login` or set GITHUB_TOKEN');
}

const apiBase = (host) => (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`);

export async function openOrUpdate({ host, project, source, target, title, description, draft }) {
  const { header } = resolveAuth(host);
  const headers = {
    Authorization: header,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'templeforge',
  };
  const call = (method, path, body) => request('GitHub', `${apiBase(host)}/repos/${project}${path}`, { method, headers, body });

  const owner = project.split('/')[0];
  const openPulls = await call('GET', `/pulls?state=open&head=${encodeURIComponent(`${owner}:${source}`)}`);
  if (openPulls.length) {
    const pull = await call('PATCH', `/pulls/${openPulls[0].number}`, { title, body: description });
    return { url: pull.html_url, action: 'updated' };
  }
  const pull = await call('POST', '/pulls', { title, head: source, base: target, body: description, draft });
  return { url: pull.html_url, action: 'created' };
}
