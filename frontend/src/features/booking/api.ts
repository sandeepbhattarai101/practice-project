import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Booking, Invoice, PaymentRedirect, ProviderCode, SeatMap, ShowtimeDetail } from '@/types/api';

export const bookingKeys = {
  all: ['booking'] as const,
  showtime: (id: number) => [...bookingKeys.all, 'showtime', id] as const,
  seats: (id: number) => [...bookingKeys.all, 'showtime', id, 'seats'] as const,
  booking: (reference: string) => [...bookingKeys.all, 'ref', reference] as const,
  invoices: (reference: string) => [...bookingKeys.all, 'ref', reference, 'invoices'] as const,
};

const enc = encodeURIComponent;

export const bookingApi = {
  showtime: (id: number) => api.get<ShowtimeDetail>(`/api/showtimes/${id}`),
  seats: (id: number) => api.get<SeatMap>(`/api/showtimes/${id}/seats`),
  seatStreamPath: (id: number) => `/api/showtimes/${id}/seats/stream`,
  create: (showtimeId: number, seatIds: number[]) => api.post<Booking>('/api/bookings', { showtimeId, seatIds }),
  get: (reference: string) => api.get<Booking>(`/api/bookings/${enc(reference)}`),
  updateCustomer: (reference: string, body: { name: string; email: string; phone: string }) =>
    api.put<Booking>(`/api/bookings/${enc(reference)}/customer`, body),
  applyCoupon: (reference: string, code: string) => api.post<Booking>(`/api/bookings/${enc(reference)}/coupon`, { code }),
  removeCoupon: (reference: string) => api.delete<Booking>(`/api/bookings/${enc(reference)}/coupon`),
  release: (reference: string) => api.post<void>(`/api/bookings/${enc(reference)}/release`),
  startPayment: (reference: string, provider: ProviderCode, idempotencyKey: string) =>
    api.post<PaymentRedirect>(`/api/bookings/${enc(reference)}/payments`, { provider }, { 'Idempotency-Key': idempotencyKey }),
  verifyPayment: (reference: string) => api.post<Booking>(`/api/bookings/${enc(reference)}/payments/verify`),
  cancel: (reference: string, reason?: string) =>
    api.post<Booking>(`/api/bookings/${enc(reference)}/cancel`, reason ? { reason } : {}),
  resend: (reference: string) => api.post<void>(`/api/bookings/${enc(reference)}/resend`),
  invoices: (reference: string) => api.get<Invoice[]>(`/api/bookings/${enc(reference)}/invoices`),
  lookup: (body: { reference: string; email: string } | { reference: string; token: string }) =>
    api.post<Booking>('/api/bookings/lookup', body),
};

export const useShowtime = (id: number) =>
  useQuery({ queryKey: bookingKeys.showtime(id), queryFn: () => bookingApi.showtime(id), enabled: Number.isFinite(id), staleTime: 30_000 });

/** Seat maps are always fresh: staleTime 0, refetched on focus and on SSE `seats-changed`. */
export const useSeatMap = (id: number) =>
  useQuery({
    queryKey: bookingKeys.seats(id),
    queryFn: () => bookingApi.seats(id),
    enabled: Number.isFinite(id),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

export const useBooking = (reference: string, options: { refetchInterval?: number | false } = {}) =>
  useQuery({
    queryKey: bookingKeys.booking(reference),
    queryFn: () => bookingApi.get(reference),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval,
  });

export const useBookingInvoices = (reference: string) =>
  useQuery({ queryKey: bookingKeys.invoices(reference), queryFn: () => bookingApi.invoices(reference), staleTime: 5 * 60 * 1000 });
