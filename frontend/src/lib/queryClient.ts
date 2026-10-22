import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const CATALOGUE_STALE_TIME = 5 * 60 * 1000;

function shouldRetry(failureCount: number, error: unknown): boolean {
  // Client errors (4xx) are deterministic; retrying only delays the message.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
