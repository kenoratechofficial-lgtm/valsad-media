import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGNewsRequestScheduler,
  GNewsApiError,
  GNewsFetchGate,
  GNewsFetchGateError,
  gnewsAdminMessage,
  requestGNews,
} from './gnews.js';

const jsonResponse = (status, payload) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(payload),
});

const request = (overrides = {}) => requestGNews({
  apiKey: 'secret-test-key', category: 'technology', language: 'en', q: 'Valsad news',
  schedule: task => task(), sleep: async () => {}, logger: () => {}, ...overrides,
});

test('success parses articles and sends the key only in the request header', async () => {
  let requestUrl, requestOptions;
  const payload = { articles: [{ title: 'Local technology story' }] };
  const result = await request({fetchImpl: async (url, options) => {
    requestUrl = String(url); requestOptions = options; return jsonResponse(200, payload);
  }});
  assert.deepEqual(result, payload);
  assert.equal(requestUrl.includes('secret-test-key'), false);
  assert.equal(new URL(requestUrl).searchParams.has('apikey'), false);
  assert.equal(requestOptions.headers['X-Api-Key'], 'secret-test-key');
});

test('400, invalid-key 401, and exhausted-quota 403 are handled without retry', async t => {
  for (const [status, body] of [
    [400, { errors: { q: 'Query syntax is invalid.' } }],
    [401, { errors: ['Invalid API Key provided.'] }],
    [403, { errors: ['You have reached your request limit for today.'] }],
  ]) await t.test(`HTTP ${status}`, async () => {
    let calls = 0;
    await assert.rejects(request({fetchImpl: async () => { calls += 1; return jsonResponse(status, body); }}), error => {
      assert.ok(error instanceof GNewsApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, gnewsAdminMessage(status));
      return true;
    });
    assert.equal(calls, 1);
  });
});

test('429 retries with bounded exponential backoff and then succeeds', async () => {
  let calls = 0; const delays = [];
  const result = await request({
    fetchImpl: async () => ++calls < 3 ? jsonResponse(429, { errors: ['Too many requests.'] }) : jsonResponse(200, { articles: [] }),
    sleep: async delay => delays.push(delay),
  });
  assert.deepEqual(result, { articles: [] });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});

test('repeated 429 stops after the retry bound and redacts secrets from logs', async () => {
  let calls = 0; const logs = [];
  await assert.rejects(request({
    fetchImpl: async () => { calls += 1; return jsonResponse(429, { errors: ['Blocked key secret-test-key'] }); },
    logger: (...args) => logs.push(args),
  }), error => error instanceof GNewsApiError && error.status === 429);
  assert.equal(calls, 3);
  assert.equal(JSON.stringify(logs).includes('secret-test-key'), false);
  assert.equal(JSON.stringify(logs).includes('Blocked key'), true);
});

for (const status of [500, 503]) test(`HTTP ${status} retries temporarily and succeeds`, async () => {
  let calls = 0; const delays = [];
  const result = await request({
    fetchImpl: async () => ++calls === 1 ? jsonResponse(status, { errors: ['Temporary upstream failure.'] }) : jsonResponse(200, { articles: [{ title: 'Recovered' }] }),
    sleep: async delay => delays.push(delay),
  });
  assert.equal(result.articles[0].title, 'Recovered');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1_000]);
});

test('request scheduler spaces requests across sessions', async () => {
  let time = 10_000; const delays = [];
  const schedule = createGNewsRequestScheduler({intervalMs: 1_100, now: () => time, sleep: async delay => { delays.push(delay); time += delay; }});
  await schedule(async () => { time += 300; });
  await schedule(async () => {});
  assert.deepEqual(delays, [800]);
});

test('per-session gate rejects concurrent calls and enforces cooldown', () => {
  let time = 5_000; const gate = new GNewsFetchGate({cooldownMs: 15_000, now: () => time});
  const release = gate.acquire('session-a');
  assert.throws(() => gate.acquire('session-a'), error => error instanceof GNewsFetchGateError && error.status === 409);
  release();
  assert.throws(() => gate.acquire('session-a'), error => error instanceof GNewsFetchGateError && error.status === 429 && error.retryAfter === 15);
  assert.doesNotThrow(() => gate.acquire('session-b'));
  time += 15_000;
  assert.doesNotThrow(() => gate.acquire('session-a'));
});
