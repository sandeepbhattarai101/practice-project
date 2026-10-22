import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiUrl, ensureCsrf, errorMessage, readCookie } from './api';

type FetchArgs = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: FetchArgs) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function headersOf(call: FetchArgs): Record<string, string> {
  return (call[1]?.headers ?? {}) as Record<string, string>;
}

describe('apiUrl', () => {
  it('drops empty query values and repeats arrays', () => {
    expect(apiUrl('/api/movies', { city: 'kathmandu', q: '', genre: undefined, page: 0, tag: ['a', 'b'] })).toBe(
      '/api/movies?city=kathmandu&page=0&tag=a&tag=b',
    );
  });
});

describe('CSRF handling', () => {
  it('sends the XSRF-TOKEN cookie as X-XSRF-TOKEN on non-GET requests', async () => {
    document.cookie = 'XSRF-TOKEN=abc%20123; path=/';
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.post('/api/bookings', { showtimeId: 1, seatIds: [2] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/bookings');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.credentials).toBe('include');
    expect(headersOf(call)['X-XSRF-TOKEN']).toBe('abc 123');
    expect(headersOf(call)['Content-Type']).toBe('application/json');
    expect(call[1]?.body).toBe(JSON.stringify({ showtimeId: 1, seatIds: [2] }));
  });

  it('does not send the header on GET', async () => {
    document.cookie = 'XSRF-TOKEN=tok; path=/';
    fetchMock.mockResolvedValue(jsonResponse([]));
    await api.get('/api/cities');
    expect(headersOf(fetchMock.mock.calls[0])['X-XSRF-TOKEN']).toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include');
  });

  it('fetches /api/auth/csrf first when the cookie is missing', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/auth/csrf') {
        document.cookie = 'XSRF-TOKEN=fresh; path=/';
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    });

    await api.post('/api/auth/logout');

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/auth/csrf', '/api/auth/logout']);
    expect(headersOf(fetchMock.mock.calls[1])['X-XSRF-TOKEN']).toBe('fresh');
  });

  it('shares one request between concurrent ensureCsrf calls', async () => {
    fetchMock.mockImplementation(async () => {
      document.cookie = 'XSRF-TOKEN=x; path=/';
      return new Response(null, { status: 204 });
    });
    await Promise.all([ensureCsrf(), ensureCsrf()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCookie('XSRF-TOKEN')).toBe('x');
  });

  it('refreshes the token and retries once on 403 CSRF_INVALID', async () => {
    document.cookie = 'XSRF-TOKEN=stale; path=/';
    let writes = 0;
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/auth/csrf') {
        document.cookie = 'XSRF-TOKEN=renewed; path=/';
        return new Response(null, { status: 204 });
      }
      writes += 1;
      return writes === 1
        ? jsonResponse({ error: { code: 'CSRF_INVALID', message: 'Your session token is missing or expired.' }, requestId: 'r' }, 403)
        : jsonResponse({ reference: 'PP1' }, 201);
    });

    await expect(api.post('/api/bookings', {})).resolves.toEqual({ reference: 'PP1' });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/bookings', '/api/auth/csrf', '/api/bookings']);
    expect(headersOf(fetchMock.mock.calls[2])['X-XSRF-TOKEN']).toBe('renewed');
  });

  it('passes extra headers such as Idempotency-Key', async () => {
    document.cookie = 'XSRF-TOKEN=t; path=/';
    fetchMock.mockResolvedValue(jsonResponse({ paymentId: 1 }));
    await api.post('/api/bookings/ABC/payments', { provider: 'DEV_SANDBOX' }, { 'Idempotency-Key': 'key-1' });
    expect(headersOf(fetchMock.mock.calls[0])['Idempotency-Key']).toBe('key-1');
  });
});

describe('error parsing', () => {
  it('turns the error envelope into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'SEATS_UNAVAILABLE',
            message: 'Some seats are no longer available',
            details: { seatIds: [11, 12] },
          },
          requestId: 'req-42',
        },
        409,
      ),
    );
    document.cookie = 'XSRF-TOKEN=t; path=/';

    const error = await api.post('/api/bookings', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const e = error as ApiError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('SEATS_UNAVAILABLE');
    expect(e.message).toBe('Some seats are no longer available');
    expect(e.details).toEqual({ seatIds: [11, 12] });
    expect(e.requestId).toBe('req-42');
  });

  it('exposes field errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please check the highlighted fields',
            fieldErrors: [{ field: 'email', message: 'must be a well-formed email address' }],
          },
          requestId: 'r1',
        },
        400,
      ),
    );
    document.cookie = 'XSRF-TOKEN=t; path=/';
    const e = (await api.post('/api/auth/register', {}).catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.fieldErrors).toHaveLength(1);
    expect(e.fieldError('email')).toBe('must be a well-formed email address');
    expect(e.fieldError('password')).toBeUndefined();
  });

  it('handles non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    const e = (await api.get('/api/home').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(502);
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(errorMessage(e)).toMatch(/temporarily unavailable/);
  });

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const e = (await api.get('/api/home').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.cause).toBeInstanceOf(TypeError);
  });

  it('returns undefined for 204 and parses JSON otherwise', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.get('/api/auth/csrf')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: null }));
    await expect(api.get('/api/auth/me')).resolves.toEqual({ user: null });
  });
});
