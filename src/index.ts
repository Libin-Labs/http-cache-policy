export type HeaderRecord = Readonly<Record<string, string>>;

export interface CacheRequest {
  method: string;
  url: string;
  headers?: HeaderRecord;
}

export interface CacheResponse {
  status: number;
  headers?: HeaderRecord;
}

export interface CacheDecision {
  cacheable: boolean;
  freshnessLifetimeMs: number;
  currentAgeMs: number;
  staleWhileRevalidateMs: number;
  requiresRevalidation: boolean;
  reasons: readonly string[];
}

export interface HttpCachePolicyOptions {
  sharedCache?: boolean;
  maxFreshnessMs?: number;
  now?: () => number;
  maxHeaders?: number;
  maxHeaderBytes?: number;
}

export interface HttpCachePolicy {
  evaluate(request: CacheRequest, response: CacheResponse): CacheDecision;
  key(request: CacheRequest, responseHeaders?: HeaderRecord): string | undefined;
}

export class CachePolicyInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CachePolicyInputError';
  }
}

function headers(
  input: HeaderRecord | undefined,
  maxHeaders: number,
  maxHeaderBytes: number,
): Map<string, string> {
  if (input === undefined) return new Map();
  if (
    !input ||
    typeof input !== 'object' ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    throw new CachePolicyInputError('Headers must be a plain record.');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > maxHeaders) throw new RangeError('Header count exceeds maxHeaders.');
  const result = new Map<string, string>();
  let bytes = 0;
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key)) {
      throw new CachePolicyInputError('Invalid HTTP header name.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new CachePolicyInputError('Headers must be enumerable string data properties.');
    }
    const value = descriptor.value;
    if (/[\r\n\0]/.test(value))
      throw new CachePolicyInputError('Header values cannot contain line breaks or NUL.');
    bytes += new TextEncoder().encode(key + value).byteLength;
    if (bytes > maxHeaderBytes) throw new RangeError('Combined headers exceed maxHeaderBytes.');
    const normalized = key.toLowerCase();
    result.set(normalized, result.has(normalized) ? `${result.get(normalized)}, ${value}` : value);
  }
  return result;
}

function directives(value: string | undefined): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  if (value === undefined) return result;
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    const name = (separator < 0 ? trimmed : trimmed.slice(0, separator)).trim().toLowerCase();
    let argument = separator < 0 ? undefined : trimmed.slice(separator + 1).trim();
    if (argument?.startsWith('"') && argument.endsWith('"')) argument = argument.slice(1, -1);
    if (/^[a-z][a-z0-9-]*$/.test(name)) result.set(name, argument);
  }
  return result;
}

function seconds(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  const milliseconds = parsed * 1000;
  return Number.isSafeInteger(parsed) && Number.isSafeInteger(milliseconds)
    ? milliseconds
    : undefined;
}

function requestParts(request: CacheRequest): {
  method: string;
  url: string;
  headers: Map<string, string>;
} {
  if (!request || typeof request !== 'object')
    throw new CachePolicyInputError('Request must be an object.');
  if (typeof request.method !== 'string' || !/^[A-Za-z]{1,16}$/.test(request.method)) {
    throw new CachePolicyInputError('Request method must contain 1..16 ASCII letters.');
  }
  if (
    typeof request.url !== 'string' ||
    request.url.length === 0 ||
    request.url.length > 8192 ||
    /[\r\n\0]/.test(request.url)
  )
    throw new CachePolicyInputError(
      'URL must be a nonempty safe string of at most 8192 characters.',
    );
  return { method: request.method.toUpperCase(), url: request.url, headers: new Map() };
}

const cacheableStatuses = new Set([200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501]);

export function createHttpCachePolicy(options: HttpCachePolicyOptions = {}): HttpCachePolicy {
  const sharedCache = options.sharedCache ?? false;
  if (typeof sharedCache !== 'boolean') throw new TypeError('sharedCache must be a boolean.');
  const maxFreshnessMs = options.maxFreshnessMs ?? 86_400_000;
  if (!Number.isSafeInteger(maxFreshnessMs) || maxFreshnessMs < 0) {
    throw new RangeError('maxFreshnessMs must be a non-negative safe integer.');
  }
  const maxHeaders = options.maxHeaders ?? 64;
  const maxHeaderBytes = options.maxHeaderBytes ?? 32_768;
  if (!Number.isSafeInteger(maxHeaders) || maxHeaders < 1)
    throw new RangeError('maxHeaders must be positive.');
  if (!Number.isSafeInteger(maxHeaderBytes) || maxHeaderBytes < 1)
    throw new RangeError('maxHeaderBytes must be positive.');
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  return {
    evaluate(request, response) {
      const req = requestParts(request);
      req.headers = headers(request.headers, maxHeaders, maxHeaderBytes);
      if (
        !response ||
        typeof response !== 'object' ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599
      )
        throw new CachePolicyInputError('Response status must be an HTTP status code.');
      const res = headers(response.headers, maxHeaders, maxHeaderBytes);
      const responseCc = directives(res.get('cache-control'));
      const requestCc = directives(req.headers.get('cache-control'));
      const reasons: string[] = [];
      let cacheable = req.method === 'GET' || req.method === 'HEAD';
      if (!cacheable) reasons.push('method');
      if (
        !cacheableStatuses.has(response.status) &&
        !responseCc.has('public') &&
        !responseCc.has('max-age') &&
        !responseCc.has('s-maxage')
      ) {
        cacheable = false;
        reasons.push('status');
      }
      if (responseCc.has('no-store') || requestCc.has('no-store')) {
        cacheable = false;
        reasons.push('no-store');
      }
      if (sharedCache && responseCc.has('private')) {
        cacheable = false;
        reasons.push('private');
      }
      if (
        sharedCache &&
        req.headers.has('authorization') &&
        !responseCc.has('public') &&
        !responseCc.has('s-maxage')
      ) {
        cacheable = false;
        reasons.push('authorization');
      }
      const ageHeader = res.get('age');
      let ageMs = 0;
      if (ageHeader !== undefined) {
        const parsedAge = seconds(ageHeader.trim());
        if (parsedAge === undefined) reasons.push('invalid-age');
        else ageMs = parsedAge;
      }
      const dateHeader = res.get('date');
      if (dateHeader) {
        const dateMs = Date.parse(dateHeader);
        if (Number.isFinite(dateMs)) ageMs = Math.max(ageMs, Math.max(0, now() - dateMs));
      }
      let freshness = seconds(
        sharedCache
          ? (responseCc.get('s-maxage') ?? responseCc.get('max-age'))
          : responseCc.get('max-age'),
      );
      if (freshness === undefined) {
        const expires = res.get('expires');
        const expiresMs = expires ? Date.parse(expires) : NaN;
        const dateMs = dateHeader ? Date.parse(dateHeader) : now();
        if (Number.isFinite(expiresMs) && Number.isFinite(dateMs))
          freshness = Math.max(0, expiresMs - dateMs);
      }
      freshness = Math.min(freshness ?? 0, maxFreshnessMs);
      const requiresRevalidation =
        responseCc.has('no-cache') ||
        requestCc.has('no-cache') ||
        responseCc.has('must-revalidate') ||
        responseCc.has('proxy-revalidate');
      if (requiresRevalidation) freshness = 0;
      if (freshness === 0 && !requiresRevalidation && cacheable)
        reasons.push('no-explicit-freshness');
      const swr = seconds(responseCc.get('stale-while-revalidate'));
      return Object.freeze({
        cacheable,
        freshnessLifetimeMs: freshness,
        currentAgeMs: ageMs,
        staleWhileRevalidateMs: Math.min(swr ?? 0, maxFreshnessMs),
        requiresRevalidation,
        reasons: Object.freeze(reasons),
      });
    },
    key(request, responseHeaders) {
      const req = requestParts(request);
      const requestHeaders = headers(request.headers, maxHeaders, maxHeaderBytes);
      const response = headers(responseHeaders, maxHeaders, maxHeaderBytes);
      const vary = response.get('vary');
      if (vary === '*') return undefined;
      const names = vary
        ? [
            ...new Set(
              vary
                .split(',')
                .map((name) => name.trim().toLowerCase())
                .filter(Boolean),
            ),
          ].sort()
        : [];
      if (names.some((name) => !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/.test(name))) {
        throw new CachePolicyInputError('Invalid Vary header token.');
      }
      const parts = [
        req.method,
        req.url,
        ...names.flatMap((name) => [name, requestHeaders.get(name) ?? '']),
      ];
      return JSON.stringify(parts);
    },
  };
}
