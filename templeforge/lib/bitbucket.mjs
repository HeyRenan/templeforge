// Bitbucket Cloud driver. Auth: BITBUCKET_TOKEN (repository/workspace access
// token, Bearer), or BITBUCKET_EMAIL + BITBUCKET_API_TOKEN (Atlassian API token, Basic).

import { request } from './rest.mjs';

const API = 'https://api.bitbucket.org/2.0/repositories';

export function resolveAuth() {
  const { BITBUCKET_TOKEN, BITBUCKET_EMAIL, BITBUCKET_API_TOKEN } = process.env;
  if (BITBUCKET_TOKEN) return { header: `Bearer ${BITBUCKET_TOKEN}`, source: 'BITBUCKET_TOKEN' };
  if (BITBUCKET_EMAIL && BITBUCKET_API_TOKEN) {
    const basic = Buffer.from(`${BITBUCKET_EMAIL}:${BITBUCKET_API_TOKEN}`).toString('base64');
    return { header: `Basic ${basic}`, source: 'BITBUCKET_EMAIL+BITBUCKET_API_TOKEN' };
  }
  throw new Error('no Bitbucket token: set BITBUCKET_TOKEN, or BITBUCKET_EMAIL + BITBUCKET_API_TOKEN');
}

// Git allows `"` in branch names; it must be escaped inside the BBQL string literal.
export function openPullQuery(source) {
  const escaped = source.replace(/[\\"]/g, '\\$&');
  return encodeURIComponent(`state="OPEN" AND source.branch.name="${escaped}"`);
}

export async function openOrUpdate({ project, source, target, title, description, draft }) {
  const { header } = resolveAuth();
  const call = (method, path, body) => request('Bitbucket', `${API}/${project}/pullrequests${path}`, { method, headers: { Authorization: header }, body });

  const openPulls = await call('GET', `?q=${openPullQuery(source)}`);
  if (openPulls.values?.length) {
    const pull = await call('PUT', `/${openPulls.values[0].id}`, { title, description });
    return { url: pull.links.html.href, action: 'updated' };
  }
  const pull = await call('POST', '', {
    title,
    description,
    draft: Boolean(draft),
    source: { branch: { name: source } },
    destination: { branch: { name: target } },
  });
  return { url: pull.links.html.href, action: 'created' };
}
