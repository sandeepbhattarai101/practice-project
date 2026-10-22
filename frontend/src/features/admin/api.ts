import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, downloadFile, type QueryParams } from '@/lib/api';
import type {
  AdminBooking,
  AdminBookingRow,
  AdminCinema,
  AdminCinemaDetail,
  AdminCity,
  AdminCoupon,
  AdminDashboard,
  AdminLookups,
  AdminMovie,
  AdminPayment,
  AdminPaymentDetail,
  AdminPromotion,
  AdminRefund,
  AdminSetting,
  AdminShowtime,
  AdminUser,
  AuditEntry,
  BulkShowtimeInput,
  BulkShowtimeResult,
  CheckinResult,
  CinemaInput,
  CouponInput,
  MovieInput,
  OccupancyReport,
  Page,
  PromotionInput,
  Role,
  SalesReport,
  SeatLayout,
  SeatLayoutResponse,
  ShowtimeInput,
  TmdbResult,
  Invoice,
  InvoiceKind,
  InvoiceLedgerSummary,
} from '@/types/api';

const A = '/api/admin';
const enc = encodeURIComponent;

export interface PageParams {
  page?: number;
  size?: number;
}

export interface ShowtimeFilters extends PageParams {
  cinemaId?: number | '';
  movieId?: number | '';
  from?: string;
  to?: string;
  status?: string;
}

export interface BookingFilters extends PageParams {
  q?: string;
  status?: string;
  cinemaId?: number | '';
  showtimeId?: number | '';
  from?: string;
  to?: string;
}

export interface InvoiceFilters extends PageParams {
  q?: string;
  kind?: InvoiceKind | '';
  from?: string;
  to?: string;
}

export interface SalesParams {
  from: string;
  to: string;
  groupBy: 'day' | 'movie' | 'cinema';
  cinemaId?: number | '';
}

export interface OccupancyParams {
  from: string;
  to: string;
  cinemaId?: number | '';
}

export const adminKeys = {
  all: ['admin'] as const,
  lookups: () => [...adminKeys.all, 'lookups'] as const,
  dashboard: (cinemaId: number | '') => [...adminKeys.all, 'dashboard', cinemaId] as const,
  movies: (params: QueryParams) => [...adminKeys.all, 'movies', params] as const,
  movie: (id: number) => [...adminKeys.all, 'movie', id] as const,
  tmdb: (q: string) => [...adminKeys.all, 'tmdb', q] as const,
  cities: () => [...adminKeys.all, 'cities'] as const,
  cinemas: () => [...adminKeys.all, 'cinemas'] as const,
  cinema: (id: number) => [...adminKeys.all, 'cinema', id] as const,
  layout: (auditoriumId: number) => [...adminKeys.all, 'layout', auditoriumId] as const,
  showtimes: (params: ShowtimeFilters) => [...adminKeys.all, 'showtimes', params] as const,
  bookings: (params: BookingFilters) => [...adminKeys.all, 'bookings', params] as const,
  booking: (ref: string) => [...adminKeys.all, 'booking', ref] as const,
  payments: (params: QueryParams) => [...adminKeys.all, 'payments', params] as const,
  payment: (id: number) => [...adminKeys.all, 'payment', id] as const,
  refunds: (params: QueryParams) => [...adminKeys.all, 'refunds', params] as const,
  coupons: (params: PageParams) => [...adminKeys.all, 'coupons', params] as const,
  promotions: () => [...adminKeys.all, 'promotions'] as const,
  users: (params: QueryParams) => [...adminKeys.all, 'users', params] as const,
  sales: (params: SalesParams) => [...adminKeys.all, 'reports', 'sales', params] as const,
  occupancy: (params: OccupancyParams) => [...adminKeys.all, 'reports', 'occupancy', params] as const,
  settings: () => [...adminKeys.all, 'settings'] as const,
  audit: (params: QueryParams) => [...adminKeys.all, 'audit', params] as const,
  invoices: (params: InvoiceFilters) => [...adminKeys.all, 'invoices', params] as const,
  invoiceSummary: (params: Omit<InvoiceFilters, 'page' | 'size'>) => [...adminKeys.all, 'invoices', 'summary', params] as const,
  invoice: (number: string) => [...adminKeys.all, 'invoice', number] as const,
};

export const adminApi = {
  lookups: () => api.get<AdminLookups>(`${A}/lookups`),
  dashboard: (cinemaId: number | '') => api.get<AdminDashboard>(`${A}/dashboard`, { cinemaId }),

  movies: (params: { q?: string; status?: string } & PageParams) => api.get<Page<AdminMovie>>(`${A}/movies`, { ...params }),
  movie: (id: number) => api.get<AdminMovie>(`${A}/movies/${id}`),
  createMovie: (body: MovieInput) => api.post<AdminMovie>(`${A}/movies`, body),
  updateMovie: (id: number, body: MovieInput) => api.put<AdminMovie>(`${A}/movies/${id}`, body),
  setMovieStatus: (id: number, status: string) => api.post<AdminMovie>(`${A}/movies/${id}/status`, { status }),
  deleteMovie: (id: number) => api.delete<void>(`${A}/movies/${id}`),
  tmdbSearch: (q: string) => api.get<TmdbResult[]>(`${A}/tmdb/search`, { q }),
  tmdbImport: (tmdbId: number) => api.post<AdminMovie>(`${A}/tmdb/import`, { tmdbId }),

  cities: () => api.get<AdminCity[]>(`${A}/cities`),
  createCity: (body: Omit<AdminCity, 'id' | 'slug'> & { slug?: string }) => api.post<AdminCity>(`${A}/cities`, body),
  updateCity: (id: number, body: Omit<AdminCity, 'id' | 'slug'> & { slug?: string }) => api.put<AdminCity>(`${A}/cities/${id}`, body),

  cinemas: () => api.get<AdminCinema[]>(`${A}/cinemas`),
  cinema: (id: number) => api.get<AdminCinemaDetail>(`${A}/cinemas/${id}`),
  createCinema: (body: CinemaInput) => api.post<AdminCinema>(`${A}/cinemas`, body),
  updateCinema: (id: number, body: CinemaInput) => api.put<AdminCinema>(`${A}/cinemas/${id}`, body),
  createAuditorium: (cinemaId: number, body: { name: string; formats: string[]; gridRows: number; gridCols: number }) =>
    api.post<unknown>(`${A}/cinemas/${cinemaId}/auditoriums`, body),
  updateAuditorium: (id: number, body: { name: string; formats: string[]; isActive: boolean }) =>
    api.put<unknown>(`${A}/auditoriums/${id}`, body),
  layout: (auditoriumId: number) => api.get<SeatLayoutResponse>(`${A}/auditoriums/${auditoriumId}/layout`),
  saveLayout: (auditoriumId: number, body: SeatLayout) => api.put<SeatLayoutResponse>(`${A}/auditoriums/${auditoriumId}/layout`, body),

  showtimes: (params: ShowtimeFilters) => api.get<Page<AdminShowtime>>(`${A}/showtimes`, { ...params }),
  createShowtime: (body: ShowtimeInput) => api.post<AdminShowtime>(`${A}/showtimes`, body),
  bulkShowtimes: (body: BulkShowtimeInput) => api.post<BulkShowtimeResult>(`${A}/showtimes/bulk`, body),
  updateShowtime: (id: number, body: ShowtimeInput) => api.put<AdminShowtime>(`${A}/showtimes/${id}`, body),
  setShowtimeSales: (id: number, salesOpen: boolean) => api.post<AdminShowtime>(`${A}/showtimes/${id}/sales`, { salesOpen }),
  cancelShowtime: (id: number, reason: string) => api.post<unknown>(`${A}/showtimes/${id}/cancel`, { reason }),

  bookings: (params: BookingFilters) => api.get<Page<AdminBookingRow>>(`${A}/bookings`, { ...params }),
  booking: (ref: string) => api.get<AdminBooking>(`${A}/bookings/${enc(ref)}`),
  cancelBooking: (ref: string, reason: string, refundPercent: number) =>
    api.post<AdminBooking>(`${A}/bookings/${enc(ref)}/cancel`, { reason, refundPercent }),
  resendBooking: (ref: string) => api.post<void>(`${A}/bookings/${enc(ref)}/resend`),

  payments: (params: { status?: string; provider?: string; q?: string } & PageParams) =>
    api.get<Page<AdminPayment>>(`${A}/payments`, { ...params }),
  payment: (id: number) => api.get<AdminPaymentDetail>(`${A}/payments/${id}`),
  reconcilePayment: (id: number) => api.post<unknown>(`${A}/payments/${id}/reconcile`),

  refunds: (params: { status?: string } & PageParams) => api.get<Page<AdminRefund>>(`${A}/refunds`, { ...params }),
  processRefund: (id: number, providerRef: string, notes: string) =>
    api.post<AdminRefund>(`${A}/refunds/${id}/process`, { providerRef, notes }),
  rejectRefund: (id: number, notes: string) => api.post<AdminRefund>(`${A}/refunds/${id}/reject`, { notes }),

  coupons: (params: PageParams) => api.get<Page<AdminCoupon>>(`${A}/coupons`, { ...params }),
  createCoupon: (body: CouponInput) => api.post<AdminCoupon>(`${A}/coupons`, body),
  updateCoupon: (id: number, body: CouponInput) => api.put<AdminCoupon>(`${A}/coupons/${id}`, body),

  promotions: () => api.get<AdminPromotion[]>(`${A}/promotions`),
  createPromotion: (body: PromotionInput) => api.post<AdminPromotion>(`${A}/promotions`, body),
  updatePromotion: (id: number, body: PromotionInput) => api.put<AdminPromotion>(`${A}/promotions/${id}`, body),
  deletePromotion: (id: number) => api.delete<void>(`${A}/promotions/${id}`),

  users: (params: { q?: string; role?: string } & PageParams) => api.get<Page<AdminUser>>(`${A}/users`, { ...params }),
  updateUser: (id: number, body: { role: Role; status: string; managedCinemaIds: number[] }) =>
    api.put<AdminUser>(`${A}/users/${id}`, body),

  sales: (params: SalesParams) => api.get<SalesReport>(`${A}/reports/sales`, { ...params }),
  salesCsv: (params: SalesParams) => downloadFile(`${A}/reports/sales.csv`, { ...params }, `sales-${params.from}-to-${params.to}.csv`),
  occupancy: (params: OccupancyParams) => api.get<OccupancyReport>(`${A}/reports/occupancy`, { ...params }),
  occupancyCsv: (params: OccupancyParams) =>
    downloadFile(`${A}/reports/occupancy.csv`, { ...params }, `occupancy-${params.from}-to-${params.to}.csv`),

  settings: () => api.get<AdminSetting[]>(`${A}/settings`),
  saveSettings: (values: Record<string, string | number | boolean | null>) => api.put<AdminSetting[] | undefined>(`${A}/settings`, values),

  checkinLookup: (code: string) => api.post<CheckinResult>(`${A}/checkin/lookup`, { code }),
  checkinConfirm: (code: string) => api.post<CheckinResult>(`${A}/checkin/confirm`, { code }),

  audit: (params: { entityType?: string } & PageParams) => api.get<Page<AuditEntry>>(`${A}/audit`, { ...params }),

  invoices: (params: InvoiceFilters) => api.get<Page<Invoice>>(`${A}/invoices`, { ...params }),
  invoiceSummary: (params: Omit<InvoiceFilters, 'page' | 'size'>) => api.get<InvoiceLedgerSummary>(`${A}/invoices/summary`, { ...params }),
  invoice: (number: string) => api.get<Invoice>(`${A}/invoices/${enc(number)}`),
  invoicesCsv: (params: Omit<InvoiceFilters, 'page' | 'size'>) =>
    downloadFile(`${A}/invoices.csv`, { ...params }, `invoices${params.from ? `-${params.from}` : ''}${params.to ? `-to-${params.to}` : ''}.csv`),
};

/** Shared lookups (cities, cinemas with auditoriums + categories, movies) for admin forms and filters. */
export const useAdminLookups = () =>
  useQuery({ queryKey: adminKeys.lookups(), queryFn: adminApi.lookups, staleTime: 60_000 });

export const usePaged = keepPreviousData;
