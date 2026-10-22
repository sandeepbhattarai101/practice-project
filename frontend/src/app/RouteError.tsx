import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui';
import { Logo } from './Logo';

/** Route-level error boundary. Covers render errors, failed lazy chunks and thrown responses. */
export function RouteError() {
  const error = useRouteError();
  const notFound = (isRouteErrorResponse(error) && error.status === 404) || (error instanceof ApiError && error.status === 404);
  if (notFound) return <NotFoundPage />;

  const chunkFailed = error instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);
  const message = chunkFailed
    ? 'A new version of the site is available. Reload to continue.'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';

  if (import.meta.env.DEV) console.error(error);

  return (
    <main className="grid min-h-[70vh] place-items-center px-4 py-16">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto mb-4 size-8 text-danger" aria-hidden />
        <h1 className="font-display text-3xl text-fg">Something went wrong</h1>
        <p className="mt-3 text-muted">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Go home
          </Button>
        </div>
      </div>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main id="main" className="relative grid min-h-[70vh] place-items-center overflow-hidden px-4 py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(245_181_68/0.07),transparent_60%)]" aria-hidden />
      <div className="relative max-w-lg text-center">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 font-display text-5xl text-fg sm:text-6xl">This reel is missing</h1>
        <p className="mt-4 text-muted">
          The page you were looking for has been moved, removed, or never made it out of the edit suite.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <ButtonLink to="/">Back to home</ButtonLink>
          <ButtonLink to="/movies" variant="secondary">
            Browse movies
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}

export function MinimalErrorShell() {
  return (
    <div className="p-6">
      <Link to="/">
        <Logo />
      </Link>
      <RouteError />
    </div>
  );
}
