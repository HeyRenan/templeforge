import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDraft } from '../ship.mjs';

test('applyDraft: draft=false is a no-op for every provider', () => {
  for (const p of ['gitlab', 'github', 'bitbucket', 'gitea', 'azure']) {
    assert.deepEqual(applyDraft(p, 'feat: x', false), { title: 'feat: x', flag: false });
  }
});

test('applyDraft: gitlab marks via "Draft:" title, no flag', () => {
  assert.deepEqual(applyDraft('gitlab', 'feat: x', true), { title: 'Draft: feat: x', flag: false });
});

test('applyDraft: gitea marks via "WIP:" title, no flag', () => {
  assert.deepEqual(applyDraft('gitea', 'feat: x', true), { title: 'WIP: feat: x', flag: false });
});

test('applyDraft: flag forges keep the title and set the flag', () => {
  for (const p of ['github', 'bitbucket', 'azure']) {
    assert.deepEqual(applyDraft(p, 'feat: x', true), { title: 'feat: x', flag: true });
  }
});

test('applyDraft: title marker is idempotent (never stacks)', () => {
  assert.equal(applyDraft('gitlab', 'Draft: feat', true).title, 'Draft: feat');
  assert.equal(applyDraft('gitea', 'WIP: feat', true).title, 'WIP: feat');
  assert.equal(applyDraft('gitlab', 'wip: lower', true).title, 'wip: lower');
});
