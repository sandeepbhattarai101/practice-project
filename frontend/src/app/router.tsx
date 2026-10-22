import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Outlet, ScrollRestoration } from 'react-router';
import { PageLoader } from '@/components/ui';
import { SiteLayout } from './layout/SiteLayout';
import { MinimalErrorShell, NotFoundPage, RouteError } from './RouteError';
import { RequireAuth } from './guards';

type PageModule = { default: ComponentType };

function page(loader: () => Promise<PageModule>, options: { auth?: boolean } = {}): ReactNode {
  const Component = lazy(loader);
  const el = (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
  return options.auth ? <RequireAuth>{el}</RequireAuth> : el;
}

function RootShell() {
  return (
    <>
      <ScrollRestoration getKey={(location) => location.pathname} />
      <Outlet />
    </>
  );
}

const AdminRoot = lazy(() => import('@/features/admin/AdminRoot'));

export const router = createBrowserRouter([
  {
    element: <RootShell />,
    errorElement: <MinimalErrorShell />,
    children: [
      {
        element: <SiteLayout />,
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { index: true, element: page(() => import('@/features/catalog/pages/HomePage')) },
              { path: 'movies', element: page(() => import('@/features/catalog/pages/MoviesPage')) },
              { path: 'movies/:slug', element: page(() => import('@/features/catalog/pages/MovieDetailPage')) },
              { path: 'cinemas', element: page(() => import('@/features/catalog/pages/CinemasPage')) },
              { path: 'cinemas/:slug', element: page(() => import('@/features/catalog/pages/CinemaDetailPage')) },
              { path: 'offers', element: page(() => import('@/features/catalog/pages/OffersPage')) },
              { path: 'book/:showtimeId', element: page(() => import('@/features/booking/pages/SeatSelectionPage')) },
              { path: 'checkout/:reference', element: page(() => import('@/features/checkout/pages/CheckoutPage')) },
              { path: 'bookings/find', element: page(() => import('@/features/booking/pages/FindBookingPage')) },
              { path: 'bookings/:reference', element: page(() => import('@/features/booking/pages/BookingPage')) },
              {
                path: 'bookings/:reference/invoices/:number',
                element: page(() => import('@/features/billing/pages/InvoicePage')),
              },
              { path: 'login', element: page(() => import('@/features/auth/pages/LoginPage')) },
              { path: 'register', element: page(() => import('@/features/auth/pages/RegisterPage')) },
              { path: 'forgot-password', element: page(() => import('@/features/auth/pages/ForgotPasswordPage')) },
              { path: 'reset-password', element: page(() => import('@/features/auth/pages/ResetPasswordPage')) },
              { path: 'verify-email', element: page(() => import('@/features/auth/pages/VerifyEmailPage')) },
              { path: 'account', element: page(() => import('@/features/account/pages/AccountPage'), { auth: true }) },
              {
                path: 'account/bookings',
                element: page(() => import('@/features/account/pages/AccountBookingsPage'), { auth: true }),
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
      {
        path: 'admin/*',
        errorElement: <MinimalErrorShell />,
        element: (
          <Suspense fallback={<PageLoader />}>
            <AdminRoot />
          </Suspense>
        ),
      },
    ],
  },
]);
