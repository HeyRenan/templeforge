// Detect the git remote provider and hand back a normalized client.
// Zero-dep: parses `git remote get-url origin` and dynamically imports the
// matching provider module (gitlab.mjs / github.mjs).
//
//   const host = await detectHost();        // from cwd's origin remote
//   const host = await detectHost(url);     // from an explicit remote url
//   host -> { provider, project, owner, repo, host, webBase, client }
//
// `project` is "group/repo" (the form both clients accept).
// `client` exposes: openOrUpdateMR(project, args), uploadFile(project, file, opts),
// resolveAuth(), and (github only) getDefaultBranch(project).

import { execFileSync } from 'node:child_process';

export function originUrl(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// Parse any of:
//   git@github.com:owner/repo.git
//   https://github.com/owner/repo.git
//   ssh://git@gitlab.example.com:22/group/sub/repo.git
//   https://gitlab.com/group/sub/repo
export function parseRemote(url) {
  if (!url) throw new Error('No origin remote URL to parse.');
  let host, path;

  if (/^[a-z]+:\/\//i.test(url)) {
    // URL form (https://, http://, ssh://, git://). Normalize ssh -> parseable.
    let u = url.replace(/^ssh:\/\/[^@]+@/, 'ssh://').replace(/^[a-z]+:\/\//i, 'https://');
    const m = u.match(/^https:\/\/([^/]+)\/(.+)$/);
    if (!m) throw new Error(`Unrecognized remote URL: ${url}`);
    host = m[1].replace(/:\d+$/, ''); // strip :port
    path = m[2];
  } else {
    // scp-like: git@host:group/repo.git
    const scp = url.match(/^[^@]+@([^:]+):(.+)$/);
    if (!scp) throw new Error(`Unrecognized remote URL: ${url}`);
    host = scp[1].replace(/:\d+$/, '');
    path = scp[2];
  }

  path = path.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  const segs = path.split('/').filter(Boolean);
  if (segs.length < 2) throw new Error(`Remote URL missing owner/repo: ${url}`);

  return { host, project: segs.join('/'), owner: segs[0], repo: segs[segs.length - 1] };
}

// Every supported forge. Each maps to a lib/<provider>.mjs driver exposing the
// same contract: openOrUpdateMR(project, args) -> { action, iid, web_url }, and
// resolveAuth().
export const PROVIDERS = ['github', 'gitlab', 'bitbucket', 'gitea', 'azure'];

export function providerForHost(host) {
  const h = host.toLowerCase();
  if (h === 'github.com' || h.includes('github')) return 'github';
  if (h === 'gitlab.com' || h.includes('gitlab')) return 'gitlab';
  if (h === 'bitbucket.org' || h.includes('bitbucket')) return 'bitbucket';
  if (h === 'dev.azure.com' || h.includes('azure') || h.includes('visualstudio.com')) return 'azure';
  if (h.includes('gitea') || h.includes('forgejo') || h.includes('codeberg')) return 'gitea';
  // Self-hosted with a neutral name: respect an explicit override, else guess gitlab.
  if (process.env.TEMPLEFORGE_PROVIDER) return process.env.TEMPLEFORGE_PROVIDER;
  return 'gitlab';
}

// What the forge calls a change request. Drivers print this so the vocabulary
// matches the host (GitLab: merge request, everyone else: pull request).
export function requestTerm(provider) {
  return provider === 'gitlab' ? 'merge request' : 'pull request';
}

const DRIVERS = {
  github: () => import('./github.mjs'),
  gitlab: () => import('./gitlab.mjs'),
  bitbucket: () => import('./bitbucket.mjs'),
  gitea: () => import('./gitea.mjs'),
  azure: () => import('./azure.mjs'),
};

export async function detectHost(url = originUrl()) {
  const { host, project, owner, repo } = parseRemote(url);
  const provider = providerForHost(host);
  const load = DRIVERS[provider] || DRIVERS.gitlab;
  const client = await load();
  const webBase = `https://${host}`;
  return { provider, project, owner, repo, host, webBase, term: requestTerm(provider), client };
}
