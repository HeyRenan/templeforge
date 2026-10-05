import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHost, parseRemote, providerForHost } from '../templeforge/lib/host.mjs';

test('parseRemote handles scp, https, ssh with port, nested groups and trailing slash', () => {
  assert.deepEqual(parseRemote('git@github.com:o/r.git'), { host: 'github.com', project: 'o/r' });
  assert.deepEqual(parseRemote('https://user@GitLab.com/g/sub/r.git/'), { host: 'gitlab.com', project: 'g/sub/r' });
  assert.deepEqual(parseRemote('ssh://git@git.acme.io:2222/g/r.git'), { host: 'git.acme.io', project: 'g/r' });
  assert.deepEqual(parseRemote('git@bitbucket.org:ws/r.git'), { host: 'bitbucket.org', project: 'ws/r' });
});

test('parseRemote rejects missing or unusable urls', () => {
  assert.throws(() => parseRemote(null), /no "origin" remote/);
  assert.throws(() => parseRemote('https://github.com/only'), /no owner\/repo/);
  assert.throws(() => parseRemote('/local/path'), /unrecognized/);
});

test('providerForHost: github, bitbucket, everything else is GitLab', () => {
  assert.equal(providerForHost('github.com'), 'github');
  assert.equal(providerForHost('github.acme.com'), 'github');
  assert.equal(providerForHost('bitbucket.org'), 'bitbucket');
  assert.equal(providerForHost('gitlab.com'), 'gitlab');
  assert.equal(providerForHost('git.acme.io'), 'gitlab');
});

test('detectHost loads the matching driver and request term', async () => {
  const github = await detectHost('git@github.com:o/r.git');
  assert.equal(github.term, 'pull request');
  assert.equal(typeof github.driver.openOrUpdate, 'function');
  const gitlab = await detectHost('git@gitlab.com:g/r.git');
  assert.equal(gitlab.term, 'merge request');
});
