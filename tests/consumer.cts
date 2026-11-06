import { createHttpCachePolicy } from '@lp-labs/http-cache-policy';
const policy = createHttpCachePolicy();
const decision = policy.evaluate(
  { method: 'GET', url: '/' },
  { status: 200, headers: { 'cache-control': 'no-store' } },
);
if (decision.cacheable) throw new Error('unexpected');
