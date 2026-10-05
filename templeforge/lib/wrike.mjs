// Appends the request link to a Wrike task description. Token: WRIKE_TOKEN.
// Without it, the caller gets the task id + HTML block to append via the Wrike MCP.

import { request } from './rest.mjs';

const DEFAULT_HOST = 'www.wrike.com';

// Accepts a permalink (https://<host>/open.htm?id=123), a bare numeric id, or an API id.
export function parseTaskRef(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const permalink = text.match(/^https?:\/\/([^/]+)\/.*[?&]id=(\d+)/);
  if (permalink) return { host: permalink[1], permalinkId: permalink[2] };
  if (/^\d+$/.test(text)) return { host: DEFAULT_HOST, permalinkId: text };
  if (/^[A-Z0-9]+$/.test(text)) return { host: DEFAULT_HOST, apiId: text };
  return null;
}

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function linkBlock(url) {
  const safeUrl = escapeHtml(url);
  return `<br/><b>MERGE REQUEST</b><br/><a href="${safeUrl}">${safeUrl}</a>`;
}

// Returns { status: 'linked' | 'present' | 'todo', taskId, block }.
export async function linkTask(input, requestUrl) {
  const ref = parseTaskRef(input);
  if (!ref) throw new Error(`not a Wrike task id or permalink: ${input}`);
  const block = linkBlock(requestUrl);
  const token = process.env.WRIKE_TOKEN;
  if (!token) return { status: 'todo', taskId: ref.apiId || ref.permalinkId, block };

  const api = `https://${ref.host}/api/v4/tasks`;
  const headers = { Authorization: `Bearer ${token}` };
  const permalink = encodeURIComponent(`https://${ref.host}/open.htm?id=${ref.permalinkId}`);
  const query = ref.apiId
    ? `${api}/${ref.apiId}`
    : `${api}?permalink=${permalink}&fields=${encodeURIComponent('["description"]')}`;
  const task = (await request('Wrike', query, { headers }))?.data?.[0];
  if (!task) throw new Error(`Wrike task not found: ${input}`);

  const description = task.description || '';
  if (description.includes(escapeHtml(requestUrl))) return { status: 'present', taskId: task.id, block };
  await request('Wrike', `${api}/${task.id}`, {
    method: 'PUT', headers, body: new URLSearchParams({ description: description + block }),
  });
  return { status: 'linked', taskId: task.id, block };
}
