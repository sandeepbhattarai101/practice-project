import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { BookingSummary, Page } from '@/types/api';

export type BookingScope = 'upcoming' | 'past' | 'all';

export const accountKeys = {
  all: ['account'] as const,
  bookings: (scope: BookingScope, page: number) => [...accountKeys.all, 'bookings', scope, page] as const,
};

export const accountApi = {
  bookings: (scope: BookingScope, page: number, size = 10) =>
    api.get<Page<BookingSummary>>('/api/me/bookings', { scope, page, size }),
};

export const useMyBookings = (scope: BookingScope, page: number, enabled = true) =>
  useQuery({
    queryKey: accountKeys.bookings(scope, page),
    queryFn: () => accountApi.bookings(scope, page),
    placeholderData: keepPreviousData,
    enabled,
  });
