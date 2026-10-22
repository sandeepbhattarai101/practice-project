import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AppConfig } from '@/types/api';

export const configKeys = {
  all: ['config'] as const,
};

export const fetchConfig = () => api.get<AppConfig>('/api/config');

export const configQuery = {
  queryKey: configKeys.all,
  queryFn: fetchConfig,
  staleTime: Infinity,
  gcTime: Infinity,
} as const;

/** The public config. The boot gate loads it before any page renders, so this never suspends in practice. */
export function useConfig(): AppConfig {
  return useSuspenseQuery(configQuery).data;
}

export function useConfigQuery() {
  return useQuery(configQuery);
}
