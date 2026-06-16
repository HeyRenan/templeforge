import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, providerForHost } from '../../lib/host.mjs';

test('parseRemote: scp-like git@github', () => {
  assert.deepEqual(parseRemote('git@github.com:owner/repo.git'),
    { host: 'github.com', project: 'owner/repo', owner: 'owner', repo: 'repo' });
});

test('parseRemote: https github with .git', () => {
  assert.deepEqual(parseRemote('https://github.com/owner/repo.git'),
    { host: 'github.com', project: 'owner/repo', owner: 'owner', repo: 'repo' });
});

test('parseRemote: https github without .git', () => {
  assert.deepEqual(parseRemote('https://github.com/owner/repo'),
    { host: 'github.com', project: 'owner/repo', owner: 'owner', repo: 'repo' });
});

test('parseRemote: scp-like gitlab nested subgroups', () => {
  assert.deepEqual(parseRemote('git@gitlab.com:group/sub/repo.git'),
    { host: 'gitlab.com', project: 'group/sub/repo', owner: 'group', repo: 'repo' });
});

test('parseRemote: https gitlab nested subgroups', () => {
  assert.deepEqual(parseRemote('https://gitlab.com/group/sub/repo'),
    { host: 'gitlab.com', project: 'group/sub/repo', owner: 'group', repo: 'repo' });
});

test('parseRemote: ssh:// with port strips the port', () => {
  assert.deepEqual(parseRemote('ssh://git@gitlab.example.com:22/group/sub/repo.git'),
    { host: 'gitlab.example.com', project: 'group/sub/repo', owner: 'group', repo: 'repo' });
});

test('parseRemote: https self-hosted with port strips the port', () => {
  const r = parseRemote('https://git.acme.io:8443/team/app.git');
  assert.equal(r.host, 'git.acme.io');
  assert.equal(r.project, 'team/app');
});

test('parseRemote: trailing slash tolerated', () => {
  assert.deepEqual(parseRemote('https://github.com/owner/repo/'),
    { host: 'github.com', project: 'owner/repo', owner: 'owner', repo: 'repo' });
});

test('parseRemote: throws on missing owner/repo', () => {
  assert.throws(() => parseRemote('https://github.com/onlyowner'), /missing owner\/repo/);
});

test('parseRemote: throws on empty', () => {
  assert.throws(() => parseRemote(''), /No origin remote/);
  assert.throws(() => parseRemote('garbage-no-host'), /Unrecognized|missing/);
});

test('providerForHost: github / gitlab / self-hosted', () => {
  assert.equal(providerForHost('github.com'), 'github');
  assert.equal(providerForHost('gitlab.com'), 'gitlab');
  assert.equal(providerForHost('github.acme.io'), 'github');
  assert.equal(providerForHost('gitlab.acme.io'), 'gitlab');
});

test('providerForHost: neutral self-hosted defaults to gitlab', () => {
  const prev = process.env.TEMPLEFORGE_PROVIDER;
  delete process.env.TEMPLEFORGE_PROVIDER;
  assert.equal(providerForHost('git.acme.io'), 'gitlab');
  if (prev) process.env.TEMPLEFORGE_PROVIDER = prev;
});

test('providerForHost: TEMPLEFORGE_PROVIDER override on neutral host', () => {
  process.env.TEMPLEFORGE_PROVIDER = 'github';
  assert.equal(providerForHost('git.acme.io'), 'github');
  delete process.env.TEMPLEFORGE_PROVIDER;
});
