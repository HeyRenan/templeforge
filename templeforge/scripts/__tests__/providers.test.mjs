import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerForHost, requestTerm, PROVIDERS } from '../../lib/host.mjs';
import * as bitbucket from '../../lib/bitbucket.mjs';
import * as gitea from '../../lib/gitea.mjs';
import * as azure from '../../lib/azure.mjs';

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

test('every driver exposes the uniform contract', () => {
  for (const drv of [bitbucket, gitea, azure]) {
    assert.equal(typeof drv.openOrUpdateMR, 'function');
    assert.equal(typeof drv.openOrUpdatePR, 'function');
    assert.equal(typeof drv.resolveAuth, 'function');
    assert.equal(typeof drv.getDefaultBranch, 'function');
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
