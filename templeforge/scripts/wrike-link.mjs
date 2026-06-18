#!/usr/bin/env node
// Link a merge/pull request back to a Wrike task.
//
//   node wrike-link.mjs <task-id-or-permalink> <mr-or-pr-url>
//
// If WRIKE_TOKEN is set, calls the Wrike REST API directly (zero-dep fetch):
//   GET  /tasks/{id}            -> read current description
//   PUT  /tasks/{id}            -> append the MERGE REQUEST block (idempotent)
// Without a token, it prints the exact MCP tool-call payloads the agent should
// run (wrike_get_tasks then wrike_update_task) so the linkback stays scripted.
//
// Token comes from WRIKE_TOKEN env ONLY. Never hardcode.

const HOST = process.env.WRIKE_HOST || 'www.wrike.com';
const API = `https://${HOST}/api/v4`;

// Accept a numeric id, a permalink (?id=123456789), or an API string id (IEAB...).
export function parseTaskId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/[?&]id=(\d+)/);
  if (m) return { kind: 'numeric', id: m[1] };
  if (/^\d+$/.test(s)) return { kind: 'numeric', id: s };
  // A URL-shaped input (has a scheme or a path) that didn't yield ?id=<digits>
  // is a malformed permalink, NOT an API id — Wrike API ids carry no / : ? chars.
  if (/[/:?]/.test(s)) return null;
  return { kind: 'api', id: s }; // already a Wrike API id
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function block(url) {
  // Matches the established finishing-a-task pattern: a labeled link appended
  // to the description. Wrike descriptions are HTML, so the url is escaped before
  // interpolation — a query "&" or a stray quote must not break the attribute.
  const safe = escapeHtml(url);
  return `<br/><b>MERGE REQUEST</b><br/><a href="${safe}">${safe}</a>`;
}

function printMcpPlan(taskInput, url) {
  const tid = parseTaskId(taskInput);
  const idForApi = tid.id; // Wrike MCP accepts both numeric and API ids as-is
  const plan = {
    note: 'No WRIKE_TOKEN env found. Run these two MCP tool calls in order.',
    step1: {
      tool: 'wrike_get_tasks',
      arguments: { taskIds: [idForApi], fields: ['description'] },
      why: 'Read current description so the append is non-destructive.',
    },
    step2: {
      tool: 'wrike_update_task',
      arguments: {
        taskId: idForApi,
        // Replace <CURRENT_DESCRIPTION> with the value returned by step1 to preserve it.
        description: `<CURRENT_DESCRIPTION>${block(url)}`,
      },
      why: 'Append the MERGE REQUEST link. Skip if the link already present (idempotent).',
    },
  };
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

async function wreq(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.WRIKE_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`Wrike ${method} ${path} -> ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

async function viaApi(taskInput, url) {
  const tid = parseTaskId(taskInput);
  // The REST API needs the string id. A numeric id must be converted first.
  let taskId = tid.id;
  if (tid.kind === 'numeric') {
    const conv = await wreq('GET', `/tasks/${tid.id}?fields=["description"]`).catch(() => null);
    // GET /tasks/{legacyNumericId} works directly in v4; the response carries the api id.
    if (conv && conv.data && conv.data[0]) taskId = conv.data[0].id;
  }

  // Ask for the permalink too, so both exit paths below print the SAME real task
  // url from the API instead of hand-building one (the old code mis-built it for
  // API-id tasks, emitting a broken "...open.htm?id").
  const got = await wreq('GET', `/tasks/${taskId}?fields=["description","permalink"]`);
  const row = (got.data && got.data[0]) || {};
  const cur = row.description || '';
  const fallback = tid.kind === 'numeric' ? `https://${HOST}/open.htm?id=${tid.id}` : taskId;

  // The stored description holds the ESCAPED url (see block()), so the idempotency
  // probe must look for the escaped form, not the raw url.
  if (cur.includes(escapeHtml(url))) {
    console.error('wrike-link: link already present, nothing to do.');
    console.log(row.permalink || fallback);
    return;
  }
  const next = cur + block(url);
  const body = new URLSearchParams({ description: next }).toString();
  const updated = await wreq('PUT', `/tasks/${taskId}`, body);
  const permId = updated.data && updated.data[0] && updated.data[0].permalink;
  console.error('wrike-link: description updated.');
  console.log(permId || row.permalink || fallback);
}

async function main() {
  const [taskInput, url] = process.argv.slice(2);
  if (!taskInput || !url) {
    console.error('usage: wrike-link.mjs <task-id-or-permalink> <mr-or-pr-url>');
    process.exit(2);
  }
  if (!/^https?:\/\//.test(url)) {
    console.error('wrike-link: MR/PR url must be absolute http(s).');
    process.exit(2);
  }
  if (!parseTaskId(taskInput)) {
    console.error('wrike-link: could not read a task id from "' + taskInput +
      '" — pass a numeric id, a permalink with ?id=<number>, or a Wrike API id.');
    process.exit(2);
  }
  if (process.env.WRIKE_TOKEN) {
    await viaApi(taskInput, url);
  } else {
    printMcpPlan(taskInput, url);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
