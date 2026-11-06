import { createHttpCachePolicy, type CacheDecision } from '@lp-labs/http-cache-policy';
const policy = createHttpCachePolicy({ sharedCache: true, maxFreshnessMs: 60_000 });
const decision: CacheDecision = policy.evaluate(
  { method: 'GET', url: 'https://example.test/items', headers: { accept: 'application/json' } },
  { status: 200, headers: { 'cache-control': 'max-age=60', vary: 'accept' } },
);
const key: string | undefined = policy.key({ method: 'GET', url: '/items' }, { vary: 'accept' });
void [decision, key];
