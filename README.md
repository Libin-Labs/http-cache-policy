# @lp-labs/http-cache-policy

A dependency-free evaluator for basic HTTP response cacheability, freshness and `Vary`-aware
request keys. It is a policy core, not an HTTP client or storage implementation.

## Install

```bash
npm install @lp-labs/http-cache-policy
```

Independent npm package with ESM/CommonJS builds and TypeScript declarations. CommonJS consumers
can use `require('@lp-labs/http-cache-policy')`; there are no runtime or peer dependencies.

## Quickstart

```js
import { createHttpCachePolicy } from '@lp-labs/http-cache-policy';

const policy = createHttpCachePolicy({ maxFreshnessMs: 60_000 });
const decision = policy.evaluate(
  { method: 'GET', url: 'https://api.example.test/items' },
  { status: 200, headers: { 'cache-control': 'max-age=30', vary: 'accept' } },
);
if (decision.cacheable && decision.currentAgeMs < decision.freshnessLifetimeMs) {
  const key = policy.key(
    {
      method: 'GET',
      url: 'https://api.example.test/items',
      headers: { accept: 'application/json' },
    },
    { vary: 'accept' },
  );
  // Store and retrieve a response using key in your own bounded cache.
}
```

## API and customization

`createHttpCachePolicy({ sharedCache = false, maxFreshnessMs = 86400000, now = Date.now,
maxHeaders = 64, maxHeaderBytes = 32768 })` returns:

- `evaluate(request, response)`: handles GET/HEAD, a conservative cacheable status set,
  `Cache-Control` (`no-store`, `no-cache`, `private`, `public`, `max-age`, `s-maxage`,
  `must-revalidate`, `proxy-revalidate`, `stale-while-revalidate`), `Age`, `Date`, and `Expires`.
  The result reports cacheability, bounded freshness, current age, stale-while-revalidate allowance,
  revalidation requirement and reason codes.
- `key(request, responseHeaders?)`: a deterministic method/URL key incorporating request header
  values named by `Vary`; returns `undefined` for `Vary: *`.

Invalid header records throw the exported `CachePolicyInputError`; other invalid request fields
throw `TypeError` or `RangeError`. Header names are normalized case-insensitively. Header records, method, URL, status and resource
limits are validated. Freshness durations are capped to `maxFreshnessMs`; injected time enables
deterministic tests.

## Limitations

This is not a complete RFC 9111 cache. It does not store or replay responses, parse multiple
`Warning`/conditional headers, compute heuristic freshness from `Last-Modified`, handle ranges,
request freshness extensions, validators/304 merging, cookies, or body size limits. It does not
normalize URLs or implement shared-cache security beyond Authorization and `private` rules. Review
and extend the policy for your threat model and protocol needs; callers must store bodies in a
separately bounded cache.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
