import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpCachePolicy, CachePolicyInputError } from '../dist/esm/index.js';

test('evaluates explicit freshness and current age', () => {
  const policy = createHttpCachePolicy({ now: () => Date.parse('2025-01-01T00:01:00Z') });
  const decision = policy.evaluate(
    { method: 'get', url: '/resource' },
    {
      status: 200,
      headers: { 'Cache-Control': 'max-age=120', Age: '10', Date: 'Wed, 01 Jan 2025 00:00:00 GMT' },
    },
  );
  assert.equal(decision.cacheable, true);
  assert.equal(decision.freshnessLifetimeMs, 120_000);
  assert.equal(decision.currentAgeMs, 60_000);
});

test('caps freshness and accounts for stale-while-revalidate', () => {
  const policy = createHttpCachePolicy({ maxFreshnessMs: 5000 });
  const decision = policy.evaluate(
    { method: 'GET', url: '/' },
    { status: 200, headers: { 'cache-control': 'max-age=600, stale-while-revalidate=30' } },
  );
  assert.equal(decision.freshnessLifetimeMs, 5000);
  assert.equal(decision.staleWhileRevalidateMs, 5000);
});

test('honors no-store, no-cache, and must-revalidate directives', () => {
  const policy = createHttpCachePolicy();
  assert.equal(
    policy.evaluate(
      { method: 'GET', url: '/' },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    ).cacheable,
    false,
  );
  const noCache = policy.evaluate(
    { method: 'GET', url: '/' },
    { status: 200, headers: { 'cache-control': 'max-age=30, no-cache' } },
  );
  assert.equal(noCache.cacheable, true);
  assert.equal(noCache.freshnessLifetimeMs, 0);
  assert.equal(noCache.requiresRevalidation, true);
  const mustRevalidate = policy.evaluate(
    { method: 'GET', url: '/' },
    { status: 200, headers: { 'cache-control': 'max-age=30, must-revalidate' } },
  );
  assert.equal(mustRevalidate.requiresRevalidation, true);
});

test('does not cache unsupported methods or non-cacheable statuses without freshness', () => {
  const policy = createHttpCachePolicy();
  assert.equal(policy.evaluate({ method: 'POST', url: '/' }, { status: 200 }).cacheable, false);
  assert.equal(policy.evaluate({ method: 'GET', url: '/' }, { status: 418 }).cacheable, false);
  assert.equal(policy.evaluate({ method: 'GET', url: '/' }, { status: 404 }).cacheable, true);
});

test('applies shared-cache authentication and private response restrictions', () => {
  const policy = createHttpCachePolicy({ sharedCache: true });
  const request = { method: 'GET', url: '/', headers: { authorization: 'Bearer x' } };
  assert.equal(
    policy.evaluate(request, { status: 200, headers: { 'cache-control': 'max-age=30' } }).cacheable,
    false,
  );
  assert.equal(
    policy.evaluate(request, { status: 200, headers: { 'cache-control': 'public, max-age=30' } })
      .cacheable,
    true,
  );
  assert.equal(
    policy.evaluate(
      { method: 'GET', url: '/' },
      { status: 200, headers: { 'cache-control': 'private, max-age=30' } },
    ).cacheable,
    false,
  );
});

test('uses Expires when explicit max-age is absent', () => {
  const now = Date.parse('2025-01-01T00:00:00Z');
  const policy = createHttpCachePolicy({ now: () => now });
  const decision = policy.evaluate(
    { method: 'GET', url: '/' },
    {
      status: 200,
      headers: { date: 'Wed, 01 Jan 2025 00:00:00 GMT', expires: 'Wed, 01 Jan 2025 00:00:30 GMT' },
    },
  );
  assert.equal(decision.freshnessLifetimeMs, 30_000);
});

test('generates stable Vary-sensitive keys and excludes Vary star', () => {
  const policy = createHttpCachePolicy();
  const request = {
    method: 'get',
    url: '/x',
    headers: { accept: 'application/json', language: 'en' },
  };
  assert.equal(
    policy.key(request, { vary: 'Accept' }),
    policy.key({ ...request, method: 'GET' }, { vary: 'accept' }),
  );
  assert.notEqual(
    policy.key(request, { vary: 'accept' }),
    policy.key({ ...request, headers: { accept: 'text/plain' } }, { vary: 'accept' }),
  );
  assert.equal(policy.key(request, { vary: '*' }), undefined);
});

test('rejects invalid requests, statuses, headers, and policy limits', () => {
  assert.throws(() => createHttpCachePolicy({ maxFreshnessMs: -1 }), RangeError);
  assert.throws(() => createHttpCachePolicy({ maxHeaders: 0 }), RangeError);
  const policy = createHttpCachePolicy();
  assert.throws(
    () => policy.evaluate({ method: 'GET', url: '/' }, { status: 99 }),
    CachePolicyInputError,
  );
  assert.throws(
    () => policy.evaluate({ method: 'GET', url: '/', headers: { x: 'a\r\nb' } }, { status: 200 }),
    CachePolicyInputError,
  );
  assert.throws(
    () => policy.key({ method: 'GET', url: '/' }, { vary: 'bad header' }),
    CachePolicyInputError,
  );
});
