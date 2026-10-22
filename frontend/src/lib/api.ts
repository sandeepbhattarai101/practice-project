import type { ErrorEnvelope, FieldError } from '@/types/api';

/** Base URL for the API. Empty string means same origin (the Vite proxy in development). */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

const CSRF_COOKIE = 'XSRF-TOKEN';
const CSRF_HEADER = 'X-XSRF-TOKEN';

/** A failed API call. `status` is 0 when the request never reached the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: FieldError[];
    details?: Record<string, unknown>;
    requestId?: string | null;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? [];
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  /** The message for one field, if the server reported one. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((f) => f.field === field)?.message;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isApiErrorCode(error: unknown, code: string): error is ApiError {
  return error instanceof ApiError && error.code === code;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

/** Builds an absolute-or-relative API URL, dropping empty query values. */
export function apiUrl(path: string, query?: QueryParams): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (v === undefined || v === null || v === '') continue;
        qs.append(key, String(v));
      }
    }
  }
  const search = qs.toString();
  return `${API_BASE_URL}${path}${search ? `?${search}` : ''}`;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // Not JSON (e.g. a proxy error page) — fall through to a generic error below.
    }
  }
  if (isErrorEnvelope(body)) {
    return new ApiError({
      status: response.status,
      code: body.error.code,
      message: body.error.message || response.statusText || 'Request failed',
      fieldErrors: body.error.fieldErrors,
      details: body.error.details,
      requestId: body.requestId ?? null,
    });
  }
  return new ApiError({
    status: response.status,
    code: response.status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${response.status}`,
    message:
      response.status === 502 || response.status === 503 || response.status === 504
        ? 'The service is temporarily unavailable. Please try again shortly.'
        : `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`,
  });
}

let csrfPromise: Promise<void> | null = null;

/** Fetches the CSRF cookie. Safe to call repeatedly; concurrent calls share one request. */
export function ensureCsrf(force = false): Promise<void> {
  if (!force && readCookie(CSRF_COOKIE)) return Promise.resolve();
  if (!csrfPromise || force) {
    csrfPromise = (async () => {
      const response = await fetch(apiUrl('/api/auth/csrf'), { credentials: 'include' });
      if (!response.ok) throw await toApiError(response);
    })().finally(() => {
      csrfPromise = null;
    });
  }
  return csrfPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (error) {
    // An expired session drops the CSRF token: fetch a fresh one and retry the write once.
    if (error instanceof ApiError && error.code === 'CSRF_INVALID' && (options.method ?? 'GET') !== 'GET') {
      await ensureCsrf(true);
      return send<T>(path, options);
    }
    throw error;
  }
}

async function send<T>(path: string, options: RequestOptions): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (method !== 'GET') {
    if (!readCookie(CSRF_COOKIE)) await ensureCsrf();
    const token = readCookie(CSRF_COOKIE);
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'We could not reach the server. Check your connection and try again.',
      cause,
    });
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) => apiRequest<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'POST', body, headers }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** A readable message for any thrown value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Downloads a GET endpoint (e.g. a CSV export) using the session cookie. */
export async function downloadFile(path: string, query: QueryParams, filename: string): Promise<void> {
  const response = await fetch(apiUrl(path, query), { credentials: 'include' });
  if (!response.ok) throw await toApiError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
