// Maps the `origin` remote to a provider and its driver.

const DRIVERS = {
  github: () => import('./github.mjs'),
  gitlab: () => import('./gitlab.mjs'),
  bitbucket: () => import('./bitbucket.mjs'),
};

// Accepts scp-like (git@host:group/repo.git) and URL forms (https://, ssh://).
export function parseRemote(url) {
  if (!url) throw new Error('no "origin" remote: templeforge detects the provider from it');
  let host;
  let path;
  if (/^[a-z][a-z+]*:\/\//i.test(url)) {
    const match = url.match(/^[a-z+]+:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i);
    if (!match) throw new Error(`unrecognized remote url: ${url}`);
    [, host, path] = match;
  } else {
    const match = url.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
    if (!match) throw new Error(`unrecognized remote url: ${url}`);
    [, host, path] = match;
  }
  const segments = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (segments.length < 2) throw new Error(`remote url has no owner/repo: ${url}`);
  return { host: host.toLowerCase(), project: segments.join('/') };
}

// Any host that is neither GitHub nor Bitbucket is treated as (self-managed) GitLab.
export function providerForHost(host) {
  if (host.includes('github')) return 'github';
  if (host.includes('bitbucket')) return 'bitbucket';
  return 'gitlab';
}

export function requestTerm(provider) {
  return provider === 'gitlab' ? 'merge request' : 'pull request';
}

export async function detectHost(remoteUrl) {
  const { host, project } = parseRemote(remoteUrl);
  const provider = providerForHost(host);
  const driver = await DRIVERS[provider]();
  return { provider, host, project, term: requestTerm(provider), driver };
}
