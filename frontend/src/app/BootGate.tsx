import { useEffect, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ensureCsrf } from '@/lib/api';
import { setCurrencySymbol } from '@/lib/money';
import { configQuery } from '@/features/config/api';
import { meQuery } from '@/features/auth/api';
import { catalogApi, catalogKeys } from '@/features/catalog/api';
import { ErrorState } from '@/components/ui';
import { Logo } from './Logo';

/**
 * Loads what every page needs exactly once: the CSRF cookie, GET /api/config, GET /api/auth/me
 * and the city list. Nothing renders until they are in, so pages can rely on them synchronously.
 */
export function BootGate({ children }: { children: ReactNode }) {
  const csrf = useQuery({ queryKey: ['boot', 'csrf'], queryFn: () => ensureCsrf().then(() => true), staleTime: Infinity, gcTime: Infinity });
  const results = useQueries({
    queries: [configQuery, meQuery, { queryKey: catalogKeys.cities(), queryFn: catalogApi.cities, staleTime: Infinity }],
  });
  const [config] = results;

  useEffect(() => {
    if (config.data) setCurrencySymbol(config.data.currencySymbol);
  }, [config.data]);

  const all = [csrf, ...results];
  const failed = all.find((r) => r.isError);
  if (failed) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center">
            <Logo />
          </div>
          <ErrorState
            title="We could not connect to Practice Project"
            error={failed.error}
            retrying={all.some((r) => r.isFetching)}
            onRetry={() => all.forEach((r) => r.isError && r.refetch())}
          />
        </div>
      </div>
    );
  }
  if (all.some((r) => r.isPending)) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading Practice Project">
        <div className="flex flex-col items-center gap-5">
          <Logo />
          <div className="h-0.5 w-40 overflow-hidden rounded-full bg-elevated">
            <div className="skeleton h-full w-full" />
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
