/**
 * Types mirroring docs/API.md. Keep these in step with the contract —
 * do not add fields here that the contract does not define.
 */

export type Role = 'CUSTOMER' | 'CINEMA_MANAGER' | 'ADMIN';

export interface User {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  emailVerified: boolean;
  preferredCitySlug: string | null;
  marketingOptIn: boolean;
  managedCinemaIds: number[];
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fieldErrors?: FieldError[];
    details?: Record<string, unknown>;
  };
  requestId?: string;
}

export interface City {
  id: number;
  name: string;
  slug: string;
  isDefault: boolean;
}

export type ShowingStatus = 'NOW_SHOWING' | 'UPCOMING' | 'NOT_SCHEDULED';

export interface MovieCard {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  posterUrl: string;
  backdropUrl: string;
  trailerUrl: string | null;
  runtimeMinutes: number;
  releaseDate: string;
  certification: string;
  languages: string[];
  genres: string[];
  formats: string[];
  showingStatus: ShowingStatus;
  isSampleData: boolean;
}

export interface CastMember {
  name: string;
  character: string | null;
}

export interface MovieDetail extends MovieCard {
  synopsis: string;
  director: string | null;
  cast: CastMember[];
}

export interface CinemaCard {
  id: number;
  slug: string;
  name: string;
  address: string;
  cityName: string;
  citySlug: string;
  imageUrl: string;
  facilities: string[];
  formats: string[];
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  directionsUrl: string;
  timezone: string;
}

export interface CinemaDetail extends CinemaCard {
  description: string | null;
  auditoriums: { id: number; name: string; formats: string[]; seatCount: number }[];
}

export type Availability = 'AVAILABLE' | 'FILLING_FAST' | 'SOLD_OUT';

export interface ShowtimeChip {
  id: number;
  startsAt: string;
  format: string;
  language: string;
  cinemaSlug: string;
  cinemaName: string;
  auditoriumName: string;
  timezone: string;
  seatsAvailable: number;
  seatsTotal: number;
  availability: Availability;
  minPriceMinor: number;
  maxPriceMinor: number;
  salesOpen: boolean;
}

export interface Promotion {
  id: number;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  couponCode: string | null;
}

export type BookingStatus = 'HELD' | 'PAYMENT_PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
export type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type ProviderCode = 'ESEWA' | 'KHALTI' | 'DEV_SANDBOX';
export type RefundStatus = 'PENDING' | 'PROCESSED' | 'REJECTED';

export interface BookingPayment {
  id: number;
  provider: ProviderCode;
  status: PaymentStatus;
  amountMinor: number;
  createdAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

export interface BookingPricing {
  subtotalMinor: number;
  discountMinor: number;
  feeMinor: number;
  taxMinor: number;
  taxLabel: string;
  taxRateBasisPoints: number;
  totalMinor: number;
  currency: string;
}

export interface Booking {
  reference: string;
  status: BookingStatus;
  showtime: {
    id: number;
    startsAt: string;
    endsAt: string;
    format: string;
    language: string;
    timezone: string;
    movie: { slug: string; title: string; posterUrl: string; certification: string; runtimeMinutes: number };
    cinema: { slug: string; name: string; address: string };
    auditorium: { name: string };
  };
  items: { seatId: number; seatLabel: string; categoryName: string; priceMinor: number }[];
  pricing: BookingPricing;
  coupon: { code: string; description: string } | null;
  customer: { name: string | null; email: string | null; phone: string | null };
  holdExpiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  ticket: { code: string; qrPayload: string; qrUrl: string } | null;
  checkedInAt: string | null;
  payments: BookingPayment[];
  refund: { amountMinor: number; status: RefundStatus; createdAt: string; processedAt: string | null } | null;
  cancellable: boolean;
  cancellationRefundMinor: number;
  createdAt: string;
  /** Added with billing. Treated as optional so an older backend that omits it still renders. */
  invoices?: InvoiceSummary[];
}

export interface BookingSummary {
  reference: string;
  status: BookingStatus;
  movieTitle: string;
  posterUrl: string;
  cinemaName: string;
  startsAt: string;
  timezone: string;
  seatLabels: string[];
  totalMinor: number;
  createdAt: string;
}

/* ---------- Config & auth ---------- */

export type ProviderMode = 'TEST' | 'LIVE' | 'SIMULATOR';

export interface AppConfig {
  currency: string;
  currencySymbol: string;
  holdMinutes: number;
  maxSeatsPerBooking: number;
  serviceFeeMinor: number;
  taxRateBasisPoints: number;
  taxLabel: string;
  cancellation: { cutoffHours: number; refundPercent: number };
  paymentProviders: { code: ProviderCode; name: string; mode: ProviderMode }[];
  supportEmail: string;
  tmdbEnabled: boolean;
}

/* ---------- Catalogue ---------- */

export interface HomeResponse {
  city: City;
  featured: MovieCard[];
  nowShowing: MovieCard[];
  upcoming: MovieCard[];
  cinemas: CinemaCard[];
  promotions: Promotion[];
  todayShowtimes: { movie: MovieCard; showtimes: ShowtimeChip[] }[];
}

export interface MovieSuggestion {
  slug: string;
  title: string;
  posterUrl: string;
  releaseDate: string;
  genres: string[];
}

export interface MovieFilters {
  genres: string[];
  languages: string[];
  formats: string[];
  cinemas: { slug: string; name: string }[];
}

export type MovieWhen = 'now' | 'upcoming' | 'all';
export type MovieSort = 'popular' | 'release' | 'title';

export interface CinemaShowtimes {
  cinema: CinemaCard;
  showtimes: ShowtimeChip[];
}

export interface MovieShowtimes {
  movie: MovieCard;
  showtimes: ShowtimeChip[];
}

/* ---------- Showtimes & seats ---------- */

export interface SeatPrice {
  categoryId: number;
  code: string;
  name: string;
  color: string;
  priceMinor: number;
}

export interface ShowtimeDetail {
  id: number;
  startsAt: string;
  endsAt: string;
  format: string;
  language: string;
  status: string;
  salesOpen: boolean;
  salesCloseAt: string;
  timezone: string;
  movie: MovieCard;
  cinema: CinemaCard;
  auditorium: { id: number; name: string };
  prices: SeatPrice[];
}

export type SeatType = 'STANDARD' | 'WHEELCHAIR' | 'COMPANION' | 'COUPLE';
export type SeatState = 'AVAILABLE' | 'HELD' | 'SOLD' | 'MINE' | 'UNAVAILABLE';

export interface Seat {
  id: number;
  label: string;
  rowLabel: string;
  number: number;
  gridRow: number;
  gridCol: number;
  categoryId: number;
  type: SeatType;
  state: SeatState;
}

export interface SeatCategory {
  id: number;
  code: string;
  name: string;
  color: string;
  priceMinor: number;
}

export interface SeatMap {
  showtimeId: number;
  gridRows: number;
  gridCols: number;
  categories: SeatCategory[];
  seats: Seat[];
  myBookingReference: string | null;
  myHoldExpiresAt: string | null;
}

export interface PaymentRedirect {
  paymentId: number;
  provider: ProviderCode;
  redirect: { method: 'GET' | 'POST'; url: string; fields: Record<string, string> };
}

/* ---------- Admin ---------- */

export interface AdminLookups {
  cities: City[];
  cinemas: {
    id: number;
    name: string;
    citySlug: string;
    auditoriums: { id: number; name: string; formats: string[]; categories: { id: number; code: string; name: string }[] }[];
  }[];
  movies: { id: number; title: string; languages: string[]; runtimeMinutes: number; status: string }[];
}

export interface DashboardTotals {
  bookings: number;
  tickets: number;
  revenueMinor: number;
}

export interface AdminDashboard {
  today: DashboardTotals;
  last30Days: DashboardTotals;
  activeHolds: number;
  upcomingShowtimes: number;
  pendingRefunds: number;
  salesByDay: { date: string; revenueMinor: number; tickets: number }[];
  topMovies: { title: string; revenueMinor: number; tickets: number }[];
  nextShowtimes: {
    showtimeId: number;
    movieTitle: string;
    cinemaName: string;
    auditoriumName: string;
    startsAt: string;
    sold: number;
    capacity: number;
  }[];
}

/** Movie status values are not enumerated by the contract; these are the ones the UI offers. */
export type MovieStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface MovieInput {
  title: string;
  slug?: string;
  tagline: string;
  synopsis: string;
  runtimeMinutes: number;
  releaseDate: string;
  certification: string;
  languages: string[];
  genres: string[];
  director: string;
  cast: { name: string; character: string }[];
  trailerUrl: string;
  posterUrl: string;
  backdropUrl: string;
  status: string;
  isFeatured: boolean;
}

export interface AdminMovie extends MovieDetail {
  status: string;
  isFeatured: boolean;
  tmdbId: number | null;
  createdAt: string;
  updatedAt: string;
  showtimeCount: number;
}

export interface TmdbResult {
  tmdbId: number;
  title: string;
  releaseDate: string;
  posterUrl: string;
  overview: string;
}

export interface AdminCity {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  isDefault: boolean;
}

export interface CinemaInput {
  cityId: number;
  name: string;
  slug?: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  description: string;
  facilities: string[];
  imageUrl: string;
  status: string;
}

/**
 * The contract says GET /admin/cinemas "includes auditoriumCount, status" and GET /admin/cinemas/{id}
 * "includes auditoriums". The base shape is assumed to be the CinemaInput fields plus id.
 */
export interface AdminCinema extends CinemaInput {
  id: number;
  slug: string;
  auditoriumCount: number;
  status: string;
}

export interface AdminAuditorium {
  id: number;
  name: string;
  formats: string[];
  gridRows?: number;
  gridCols?: number;
  isActive?: boolean;
  seatCount?: number;
}

export interface AdminCinemaDetail extends AdminCinema {
  auditoriums: AdminAuditorium[];
}

export type LayoutSeatType = SeatType;

export interface LayoutCategory {
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface LayoutSeat {
  rowLabel: string;
  seatNumber: number;
  gridRow: number;
  gridCol: number;
  categoryCode: string;
  seatType: LayoutSeatType;
  isActive: boolean;
}

export interface SeatLayout {
  gridRows: number;
  gridCols: number;
  categories: LayoutCategory[];
  seats: LayoutSeat[];
}

export interface SeatLayoutResponse extends SeatLayout {
  auditorium: { id: number; name: string } & Record<string, unknown>;
  locked: boolean;
}

export interface AdminShowtime {
  id: number;
  startsAt: string;
  endsAt: string;
  format: string;
  language: string;
  status: string;
  salesOpen: boolean;
  movie: { id: number; title: string };
  cinema: { id: number; name: string };
  auditorium: { id: number; name: string };
  sold: number;
  held: number;
  capacity: number;
  prices: { categoryId: number; name: string; priceMinor: number }[];
}

export interface ShowtimeInput {
  movieId: number;
  auditoriumId: number;
  startsAt: string;
  format: string;
  language: string;
  bufferMinutes?: number;
  prices: { categoryId: number; priceMinor: number }[];
}

export interface BulkShowtimeInput extends Omit<ShowtimeInput, 'startsAt'> {
  dates: string[];
  times: string[];
}

export interface BulkShowtimeResult {
  created: number;
  conflicts: { startsAt: string; message: string }[];
}

export interface AdminBookingRow {
  reference: string;
  status: BookingStatus;
  customerName: string | null;
  customerEmail: string | null;
  movieTitle: string;
  cinemaName: string;
  startsAt: string;
  timezone: string;
  seatLabels: string[];
  totalMinor: number;
  createdAt: string;
}

export interface AdminBooking extends Booking {
  userId: number | null;
  userEmail: string | null;
}

/**
 * The contract lists the payments endpoints but not the row shape. The fields below are the
 * subset this UI reads; everything is treated defensively.
 */
export interface AdminPayment {
  id: number;
  bookingReference?: string;
  provider: ProviderCode;
  status: PaymentStatus;
  amountMinor: number;
  providerRef?: string | null;
  failureReason?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface AdminPaymentDetail extends AdminPayment {
  events: { eventType: string; payload: unknown; createdAt: string }[];
}

export interface AdminRefund {
  id: number;
  bookingReference: string;
  amountMinor: number;
  status: RefundStatus;
  reason: string | null;
  provider: ProviderCode | null;
  providerRef: string | null;
  notes: string | null;
  createdAt: string;
  processedAt: string | null;
}

export type DiscountType = 'PERCENT' | 'FIXED';

export interface CouponInput {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountMinor: number | null;
  minSubtotalMinor: number | null;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  movieId: number | null;
  cinemaId: number | null;
  isActive: boolean;
}

export interface AdminCoupon extends CouponInput {
  id: number;
  usedCount: number;
}

export interface PromotionInput {
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  couponCode: string | null;
  /** Not defined by the contract's Promotion shape; sent only if the backend returned it. */
  [extra: string]: unknown;
}

export type AdminPromotion = Promotion & Record<string, unknown>;

export interface AdminUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  bookingCount: number;
  managedCinemaIds: number[];
}

export interface SalesRow {
  key: string;
  label: string;
  bookings: number;
  tickets: number;
  grossMinor: number;
  discountMinor: number;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface SalesReport {
  rows: SalesRow[];
  totals: Omit<SalesRow, 'key' | 'label'> & Partial<Pick<SalesRow, 'key' | 'label'>>;
}

export interface OccupancyReport {
  rows: {
    showtimeId: number;
    movieTitle: string;
    cinemaName: string;
    auditoriumName: string;
    startsAt: string;
    capacity: number;
    sold: number;
    occupancyPercent: number;
  }[];
}

export interface AdminSetting {
  key: string;
  value: string | number | boolean | null;
  description: string | null;
  updatedAt: string;
}

export type CheckinResultCode = 'VALID' | 'ALREADY_CHECKED_IN' | 'NOT_CONFIRMED' | 'WRONG_DAY' | 'INVALID';

export interface CheckinResult {
  result: CheckinResultCode;
  booking: Booking | null;
}

export interface AuditEntry {
  id: number;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | number | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
}

/* ---------- Billing ---------- */

export type InvoiceKind = 'INVOICE' | 'CREDIT_NOTE';

export interface InvoiceSummary {
  number: string;
  kind: InvoiceKind;
  issuedAt: string;
  totalMinor: number;
}

export interface Invoice {
  number: string;
  kind: InvoiceKind;
  issuedAt: string;
  fiscalYear: string;
  bookingReference: string;
  originalInvoiceNumber: string | null;
  seller: { name: string; address: string; taxId: string | null };
  customer: { name: string; email: string | null; phone: string | null };
  currency: string;
  lines: { description: string; quantity: number; unitPriceMinor: number; amountMinor: number }[];
  subtotalMinor: number;
  discountMinor: number;
  feeMinor: number;
  taxMinor: number;
  taxRateBasisPoints: number;
  taxLabel: string;
  totalMinor: number;
  payment: { provider: ProviderCode; providerTxnId: string | null } | null;
  timezone: string;
}

export interface InvoiceLedgerSummary {
  invoicedMinor: number;
  creditedMinor: number;
  netMinor: number;
  netTaxMinor: number;
  invoiceCount: number;
  creditNoteCount: number;
}
