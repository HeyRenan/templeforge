import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody, errorDetail } from '../../lib/rest.mjs';

test('parseBody: json, empty, and non-json are all handled', () => {
  assert.deepEqual(parseBody('{"a":1}'), { a: 1 });
  assert.equal(parseBody(''), null);
  assert.equal(parseBody('<html>oops</html>'), '<html>oops</html>');
});

test('errorDetail: prefers message/error over raw JSON', () => {
  assert.equal(errorDetail({ message: '401 Unauthorized' }), '401 Unauthorized');
  assert.equal(errorDetail({ error: 'insufficient_scope' }), 'insufficient_scope');
  assert.equal(errorDetail({ error_description: 'token expired' }), 'token expired');
});

test('errorDetail: appends structured errors when present', () => {
  assert.equal(errorDetail({ message: 'bad', errors: [{ field: 'head' }] }),
    'bad [{"field":"head"}]');
});

test('errorDetail: falls back to string body and stringified object', () => {
  assert.equal(errorDetail('plain text error'), 'plain text error');
  assert.equal(errorDetail({ weird: true }), '{"weird":true}');
  assert.equal(errorDetail(null), '');
});
