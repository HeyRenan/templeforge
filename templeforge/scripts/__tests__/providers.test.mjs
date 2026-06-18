import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerForHost, requestTerm, PROVIDERS } from '../../lib/host.mjs';
import * as bitbucket from '../../lib/bitbucket.mjs';
import * as gitea from '../../lib/gitea.mjs';
import * as azure from '../../lib/azure.mjs';
import * as gitlab from '../../lib/gitlab.mjs';
import * as github from '../../lib/github.mjs';
import { detectHost } from '../../lib/host.mjs';

test('providerForHost: known forges by hostname', () => {
  assert.equal(providerForHost('github.com'), 'github');
  assert.equal(providerForHost('gitlab.com'), 'gitlab');
  assert.equal(providerForHost('bitbucket.org'), 'bitbucket');
  assert.equal(providerForHost('dev.azure.com'), 'azure');
  assert.equal(providerForHost('codeberg.org'), 'gitea');
  assert.equal(providerForHost('gitea.acme.io'), 'gitea');
  assert.equal(providerForHost('git.acme.io'), 'gitlab'); // neutral -> default
});

test('providerForHost: env override wins for neutral host', () => {
  const prev = process.env.TEMPLEFORGE_PROVIDER;
  process.env.TEMPLEFORGE_PROVIDER = 'gitea';
  try { assert.equal(providerForHost('git.acme.io'), 'gitea'); }
  finally { if (prev == null) delete process.env.TEMPLEFORGE_PROVIDER; else process.env.TEMPLEFORGE_PROVIDER = prev; }
});

test('requestTerm: gitlab says merge request, everyone else pull request', () => {
  assert.equal(requestTerm('gitlab'), 'merge request');
  assert.equal(requestTerm('github'), 'pull request');
  assert.equal(requestTerm('bitbucket'), 'pull request');
  assert.equal(requestTerm('azure'), 'pull request');
});

test('PROVIDERS lists all five drivers', () => {
  assert.deepEqual([...PROVIDERS].sort(), ['azure', 'bitbucket', 'gitea', 'github', 'gitlab']);
});

test('detectHost: routes each remote to the right provider + client (no git/network)', async () => {
  const cases = [
    ['git@github.com:o/r.git', 'github', 'pull request'],
    ['https://gitlab.com/g/s/r.git', 'gitlab', 'merge request'],
    ['https://bitbucket.org/w/r', 'bitbucket', 'pull request'],
    ['https://codeberg.org/o/r', 'gitea', 'pull request'],
    ['https://dev.azure.com/org/proj/_git/repo', 'azure', 'pull request'],
  ];
  for (const [url, provider, term] of cases) {
    const h = await detectHost(url);
    assert.equal(h.provider, provider, url);
    assert.equal(h.term, term, url);
    assert.equal(typeof h.client.openOrUpdateMR, 'function', url);
    assert.equal(typeof h.client.getDefaultBranch, 'function', url);
  }
});

test('detectHost: Azure remote splits to org/project/repo without _git', async () => {
  const h = await detectHost('https://dev.azure.com/myorg/myproj/_git/myrepo');
  const { splitRepo } = await import('../../lib/azure.mjs');
  assert.deepEqual(splitRepo(h.project), { org: 'myorg', project: 'myproj', repo: 'myrepo' });
});

test('every driver exposes the uniform contract (incl. gitlab + github)', () => {
  for (const drv of [gitlab, github, bitbucket, gitea, azure]) {
    assert.equal(typeof drv.openOrUpdateMR, 'function');
    assert.equal(typeof drv.resolveAuth, 'function');
    assert.equal(typeof drv.getDefaultBranch, 'function', 'every driver must resolve the default branch');
  }
});

test('bitbucket.splitRepo: workspace/repo', () => {
  assert.deepEqual(bitbucket.splitRepo('acme/widgets'), { workspace: 'acme', repo: 'widgets' });
});

test('gitea.splitRepo: owner/repo', () => {
  assert.deepEqual(gitea.splitRepo('ana/widgets'), { owner: 'ana', repo: 'widgets' });
});

test('azure.splitRepo: org/project/repo, rejects short form', () => {
  assert.deepEqual(azure.splitRepo('myorg/myproj/widgets'), { org: 'myorg', project: 'myproj', repo: 'widgets' });
  assert.throws(() => azure.splitRepo('org/repo'), /org\/project\/repo/);
});

test('azure.splitRepo: drops the "_git" path segment from a real remote', () => {
  // a real Azure remote is .../{org}/{project}/_git/{repo}; parseRemote keeps _git
  assert.deepEqual(azure.splitRepo('myorg/myproj/_git/myrepo'),
    { org: 'myorg', project: 'myproj', repo: 'myrepo' });
  // project with spaces + _git
  assert.deepEqual(azure.splitRepo('my org/my proj/_git/my repo'),
    { org: 'my org', project: 'my proj', repo: 'my repo' });
});

test('splitRepo: a trailing slash never leaks into repo (bitbucket/gitea/azure)', () => {
  assert.deepEqual(bitbucket.splitRepo('acme/widgets/'), { workspace: 'acme', repo: 'widgets' });
  assert.deepEqual(gitea.splitRepo('ana/widgets/'), { owner: 'ana', repo: 'widgets' });
  assert.deepEqual(azure.splitRepo('org/proj/repo/'), { org: 'org', project: 'proj', repo: 'repo' });
});

test('resolveAuth throws a helpful error when no credentials', () => {
  const saved = { ...process.env };
  for (const k of ['BITBUCKET_TOKEN', 'BITBUCKET_USERNAME', 'BITBUCKET_APP_PASSWORD',
    'GITEA_TOKEN', 'FORGEJO_TOKEN', 'AZURE_DEVOPS_TOKEN', 'AZURE_TOKEN']) delete process.env[k];
  try {
    assert.throws(() => bitbucket.resolveAuth(), /Bitbucket/);
    assert.throws(() => gitea.resolveAuth(), /Gitea/);
    assert.throws(() => azure.resolveAuth(), /Azure/);
  } finally {
    Object.assign(process.env, saved);
  }
});

test('bitbucket.resolveAuth: app password -> basic scheme', () => {
  const saved = { ...process.env };
  delete process.env.BITBUCKET_TOKEN;
  process.env.BITBUCKET_USERNAME = 'ana';
  process.env.BITBUCKET_APP_PASSWORD = 'pw';
  try {
    const a = bitbucket.resolveAuth();
    assert.equal(a.scheme, 'basic');
    assert.equal(Buffer.from(a.token, 'base64').toString(), 'ana:pw');
  } finally { Object.assign(process.env, saved); }
});
