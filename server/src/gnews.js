const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const DEFAULT_RETRIES = 2;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 4_000;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const defaultScheduler = createGNewsRequestScheduler();

export function createGNewsRequestScheduler({ intervalMs = 1_100, sleep = wait, now = () => Date.now() } = {}) {
  let queue = Promise.resolve();
  let lastStartedAt = 0;
  return async request => {
    let release;
    const previous = queue;
    queue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const delay = Math.max(0, intervalMs - (now() - lastStartedAt));
      if (delay) await sleep(delay);
      lastStartedAt = now();
      return await request();
    } finally {
      release();
    }
  };
}

export class GNewsApiError extends Error {
  constructor(status, message, responseBody = '', upstreamStatus = status) {
    super(message);
    this.name = 'GNewsApiError';
    this.status = status;
    this.responseBody = responseBody;
    this.upstreamStatus = upstreamStatus;
  }
}

export class GNewsFetchGateError extends Error {
  constructor(status, message, retryAfter = 0) {
    super(message);
    this.name = 'GNewsFetchGateError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const gnewsAdminMessage = status => ({
  400: 'GNews rejected the search request. Check the search terms and selected category.',
  401: 'The GNews API key is invalid or expired. Update NEWS_API_KEY in the server environment.',
  403: 'The GNews daily quota is exhausted or the subscription is inactive. Check the GNews account; the daily quota resets at 00:00 UTC.',
  429: 'GNews is rate limiting requests. The server retried briefly; wait before fetching again.',
  500: 'GNews had a temporary server error. The server retried briefly; try again later.',
  503: 'GNews is temporarily unavailable. The server retried briefly; try again later.',
}[status] || `GNews request failed with HTTP ${status}. Try again later.`);

function errorBodyText(payload, rawText) {
  const errors = payload?.errors;
  if (Array.isArray(errors)) return errors.map(String).join('; ').slice(0, 400);
  if (errors && typeof errors === 'object') {
    return Object.entries(errors).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('; ').slice(0, 400);
  }
  if (typeof errors === 'string') return errors.slice(0, 400);
  if (typeof payload?.message === 'string') return payload.message.slice(0, 400);
  return rawText.slice(0, 400);
}

function redact(text, apiKey) {
  return String(text || '')
    .replaceAll(apiKey, '[redacted]')
    .replaceAll(encodeURIComponent(apiKey), '[redacted]')
    .replace(/apikey\s*[=:]\s*[^&\s"']+/gi, 'apikey=[redacted]')
    .replace(/x-api-key\s*[=:]\s*[^&\s"']+/gi, 'X-Api-Key=[redacted]')
    .slice(0, 400);
}

export async function requestGNews({
  apiKey,
  category,
  language,
  q,
  fetchImpl = fetch,
  sleep = wait,
  schedule = defaultScheduler,
  logger = console.warn,
  retries = DEFAULT_RETRIES,
}) {
  const retryCount = Math.min(DEFAULT_RETRIES, Math.max(0, Number.isInteger(retries) ? retries : DEFAULT_RETRIES));
  const url = new URL('https://gnews.io/api/v4/top-headlines');
  for (const [key, value] of Object.entries({ category, lang: language, country: 'in', max: '10', q })) {
    if (value) url.searchParams.set(key, value);
  }

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    let response;
    try {
      response = await schedule(() => fetchImpl(url, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(20_000),
      }));
    } catch (error) {
      throw new GNewsApiError(502, 'Could not connect to GNews. Check the server network and try again.', '', null);
    }

    const rawText = await response.text();
    let payload = {}, parsed = false;
    try { payload = rawText ? JSON.parse(rawText) : {}; parsed = Boolean(rawText); } catch { /* handled below */ }

    if (response.ok) {
      if (!parsed || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new GNewsApiError(502, 'GNews returned an unreadable response. Try again later.', '', null);
      }
      return payload;
    }

    const safeBody = redact(rawText || errorBodyText(payload, rawText), apiKey);
    logger('GNews upstream response', { status: response.status, body: safeBody });
    if (RETRYABLE_STATUSES.has(response.status) && attempt < retryCount) {
      const delay = Math.min(BASE_BACKOFF_MS * (2 ** attempt), MAX_BACKOFF_MS);
      await sleep(delay);
      continue;
    }
    throw new GNewsApiError(response.status, gnewsAdminMessage(response.status), safeBody);
  }
  throw new GNewsApiError(502, 'GNews request failed after retries. Try again later.');
}

export class GNewsFetchGate {
  constructor({ cooldownMs = 15_000, now = () => Date.now() } = {}) {
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.sessions = new Map();
  }

  acquire(sessionId) {
    const now = this.now();
    for (const [id, state] of this.sessions) {
      if (!state.active && state.nextAllowedAt <= now) this.sessions.delete(id);
    }
    const current = this.sessions.get(sessionId);
    if (current?.active) {
      throw new GNewsFetchGateError(409, 'A news fetch is already running for this admin session. Wait for it to finish.');
    }
    if (current && current.nextAllowedAt > now) {
      const retryAfter = Math.ceil((current.nextAllowedAt - now) / 1000);
      throw new GNewsFetchGateError(429, `Please wait ${retryAfter} seconds before fetching news again.`, retryAfter);
    }

    this.sessions.set(sessionId, { active: true, nextAllowedAt: 0 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.sessions.set(sessionId, { active: false, nextAllowedAt: this.now() + this.cooldownMs });
    };
  }
}
