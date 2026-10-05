// Shared HTTP + auth helpers for the forge drivers and Wrike. Zero dependencies.

import { execFileSync } from 'node:child_process';

export function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function errorDetail(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  const message = body.message || body.error_description || body.error?.message || body.error;
  if (message) return String(message) + (body.errors ? ' ' + JSON.stringify(body.errors) : '');
  return JSON.stringify(body);
}

// A URLSearchParams body is sent form-encoded (fetch sets the header); anything
// else is sent as JSON.
export async function request(service, url, { method = 'GET', headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body instanceof URLSearchParams) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const data = parseBody(await response.text());
  if (!response.ok) {
    throw new Error(`${service} ${method} ${url} -> ${response.status}: ${errorDetail(data)}`);
  }
  return data;
}

// Reuses the token a logged-in forge CLI (gh / glab) already stores, so no token
// has to live in the shell environment.
export function tokenFromCli(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}
