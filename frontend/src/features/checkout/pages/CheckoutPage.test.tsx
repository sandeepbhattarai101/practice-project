import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import CheckoutPage from './CheckoutPage';
import { ConfirmProvider } from '@/components/ui';
import { configKeys } from '@/features/config/api';
import { authKeys } from '@/features/auth/api';
import { bookingKeys } from '@/features/booking/api';
import type { AppConfig, Booking } from '@/types/api';

const config: AppConfig = {
  currency: 'NPR',
  currencySymbol: 'Rs.',
  holdMinutes: 10,
  maxSeatsPerBooking: 8,
  serviceFeeMinor: 5000,
  taxRateBasisPoints: 1300,
  taxLabel: 'VAT',
  cancellation: { cutoffHours: 4, refundPercent: 80 },
  paymentProviders: [
    { code: 'ESEWA', name: 'eSewa', mode: 'TEST' },
    { code: 'DEV_SANDBOX', name: 'Development sandbox', mode: 'SIMULATOR' },
  ],
  supportEmail: 'support@example.test',
  tmdbEnabled: false,
};

function booking(holdExpiresAt: string): Booking {
  return {
    reference: 'PP7K2Q',
    status: 'HELD',
    showtime: {
      id: 9,
      startsAt: '2026-10-22T12:45:00Z',
      endsAt: '2026-10-22T15:00:00Z',
      format: '2D',
      language: 'English',
      timezone: 'Asia/Kathmandu',
      movie: { slug: 'test-film', title: 'Test Film', posterUrl: '/poster.svg', certification: 'U', runtimeMinutes: 120 },
      cinema: { slug: 'test-cinema', name: 'Test Cinema', address: 'Durbar Marg' },
      auditorium: { name: 'Screen 1' },
    },
    items: [
      { seatId: 1, seatLabel: 'A1', categoryName: 'Standard', priceMinor: 35000 },
      { seatId: 2, seatLabel: 'A2', categoryName: 'Standard', priceMinor: 35000 },
    ],
    pricing: { subtotalMinor: 70000, discountMinor: 0, feeMinor: 5000, taxMinor: 9750, taxLabel: 'VAT', taxRateBasisPoints: 1300, totalMinor: 84750, currency: 'NPR' },
    coupon: null,
    customer: { name: null, email: null, phone: null },
    holdExpiresAt,
    confirmedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    ticket: null,
    checkedInAt: null,
    payments: [],
    refund: null,
    cancellable: false,
    cancellationRefundMinor: 0,
    createdAt: '2026-10-22T11:50:00Z',
  };
}

function renderCheckout(b: Booking) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(configKeys.all, config);
  qc.setQueryData(authKeys.me, { user: null });
  qc.setQueryData(bookingKeys.booking(b.reference), b);
  const router = createMemoryRouter([{ path: '/checkout/:reference', element: <CheckoutPage /> }], {
    initialEntries: [`/checkout/${b.reference}`],
  });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe('CheckoutPage hold countdown', () => {
  beforeEach(() => {
    // The page refetches the booking/showtime; answer with the same HELD booking so only the
    // client-side countdown can move the page into the expired state.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/bookings/')) return new Response(JSON.stringify(booking(new Date(Date.now() + 1200).toISOString())), { status: 200 });
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the server total, the timer and the payment providers with mode tags', () => {
    renderCheckout(booking(new Date(Date.now() + 5 * 60_000).toISOString()));
    expect(screen.getByRole('timer')).toHaveTextContent(/^[45]:\d\d$/);
    expect(screen.getAllByRole('button', { name: /Pay Rs\. 847\.50/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('VAT (13%)')).toBeInTheDocument();
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.getByText('Simulator')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login?next=%2Fcheckout%2FPP7K2Q');
  });

  it('switches to the expired state when the hold timer reaches zero', async () => {
    renderCheckout(booking(new Date(Date.now() + 1200).toISOString()));
    expect(screen.queryByText('Your seat hold has expired')).not.toBeInTheDocument();
    expect(await screen.findByText('Your seat hold has expired', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose seats again' })).toHaveAttribute('href', '/book/9');
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });
});
