import { test } from 'node:test';
import assert from 'node:assert/strict';

function freshEnv() {
  delete process.env.GITLAB_TOKEN;
  delete process.env.GLAB_TOKEN;
}

test('encodeProject encodes group/repo and spaces', async () => {
  const { encodeProject } = await import('../../lib/gitlab.mjs');
  assert.equal(encodeProject('group/repo'), 'group%2Frepo');
  assert.equal(encodeProject('a/b with space'), 'a%2Fb%20with%20space');
  assert.equal(encodeProject('x/y/z'), 'x%2Fy%2Fz');
});

test('resolveAuth: GITLAB_TOKEN env -> private scheme', async () => {
  freshEnv();
  process.env.GITLAB_TOKEN = 'glpat-env-123';
  const { resolveAuth, resolveToken, setGlabSource } = await import('../../lib/gitlab.mjs');
  setGlabSource(() => { throw new Error('glab must not be called when env token present'); });
  assert.deepEqual(resolveAuth(), { token: 'glpat-env-123', scheme: 'private' });
  assert.equal(resolveToken(), 'glpat-env-123');
  freshEnv();
  setGlabSource(null);
});

test('resolveAuth: GLAB_TOKEN env also -> private scheme', async () => {
  freshEnv();
  process.env.GLAB_TOKEN = 'glpat-glab-env';
  const { resolveAuth } = await import('../../lib/gitlab.mjs');
  assert.deepEqual(resolveAuth(), { token: 'glpat-glab-env', scheme: 'private' });
  freshEnv();
});

test('resolveAuth: no env + stub glab token -> bearer scheme', async () => {
  freshEnv();
  const { resolveAuth, setGlabSource } = await import('../../lib/gitlab.mjs');
  setGlabSource(() => 'oauth-from-glab');
  assert.deepEqual(resolveAuth(), { token: 'oauth-from-glab', scheme: 'bearer' });
  setGlabSource(null);
});

test('resolveAuth: no env + no glab token -> throws', async () => {
  freshEnv();
  const { resolveAuth, setGlabSource } = await import('../../lib/gitlab.mjs');
  setGlabSource(() => null);
  assert.throws(() => resolveAuth(), /No GitLab token/);
  setGlabSource(null);
});
