// Shared, zero-dep helpers for the provider REST drivers. Only the parts that are
// genuinely identical across every forge live here; each driver still owns its own
// fetch (its url shape, headers, auth scheme), so the providers stay independent.

// Parse a response body that is usually JSON but may be empty or non-JSON (an
// HTML error page, a plain string). Never throws on a parse failure.
export function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// Turn a parsed error body into a readable one-line detail. Forge APIs return the
// human message under `message` or `error` (sometimes with structured `errors`);
// fall back to the stringified body, then the raw text. This is what made GitHub's
// errors readable while the other drivers dumped raw JSON — now shared by all.
export function errorDetail(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  const msg = body.message || body.error || body.error_description;
  if (msg) return String(msg) + (body.errors ? ' ' + JSON.stringify(body.errors) : '');
  return JSON.stringify(body);
}
