import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Clock, Minus, Plus, Radio, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { bookingApi, bookingKeys, useSeatMap, useShowtime } from '../api';
import { useSeatStream } from '../useSeatStream';
import { SeatLegend, SeatMap, isSelectable } from '../components/SeatMap';
import { ShowSummary } from '../components/ShowSummary';
import { useConfig } from '@/features/config/api';
import { ApiError, errorMessage, isApiError } from '@/lib/api';
import { estimateTotal, formatMoney, formatBasisPoints } from '@/lib/money';
import { formatCountdown, formatTime } from '@/lib/dates';
import { useDocumentTitle, useNow } from '@/lib/hooks';
import { Button, ButtonLink, ErrorState, FormError, Skeleton } from '@/components/ui';
import { NotFoundPage } from '@/app/RouteError';
import { cn } from '@/lib/cn';
import type { Seat, SeatMap as SeatMapData } from '@/types/api';

function ScreenIndicator() {
  return (
    <div className="mx-auto mb-8 w-full max-w-xl px-6" aria-hidden>
      <svg viewBox="0 0 400 40" className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="screen-glow" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M10 30 Q200 -6 390 30 L390 40 Q200 6 10 40 Z" fill="url(#screen-glow)" />
        <path d="M10 30 Q200 -6 390 30" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <p className="mt-1 text-center text-[10px] font-bold tracking-[0.5em] text-subtle">SCREEN</p>
    </div>
  );
}

function ExistingHold({ reference, expiresAt }: { reference: string; expiresAt: string | null }) {
  const now = useNow(1000, Boolean(expiresAt));
  const left = expiresAt ? new Date(expiresAt).getTime() - now : null;
  if (left !== null && left <= 0) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent-soft p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div>
          <p className="font-semibold text-fg">You already have seats on hold for this show</p>
          <p className="text-sm text-muted">
            {left !== null ? `Your hold expires in ${formatCountdown(left)}. ` : ''}Resume to keep them, or choose different seats below — a new
            selection replaces your current hold.
          </p>
        </div>
      </div>
      <ButtonLink to={`/checkout/${reference}`} size="sm" className="shrink-0">
        Resume booking <ArrowRight className="size-4" aria-hidden />
      </ButtonLink>
    </div>
  );
}

interface Line {
  categoryId: number;
  name: string;
  priceMinor: number;
  seats: Seat[];
}

function useSelectionLines(map: SeatMapData | undefined, selected: number[]): Line[] {
  return useMemo(() => {
    if (!map) return [];
    const seats = new Map(map.seats.map((s) => [s.id, s]));
    const lines = new Map<number, Line>();
    for (const id of selected) {
      const seat = seats.get(id);
      if (!seat) continue;
      const cat = map.categories.find((c) => c.id === seat.categoryId);
      const line = lines.get(seat.categoryId) ?? { categoryId: seat.categoryId, name: cat?.name ?? 'Seat', priceMinor: cat?.priceMinor ?? 0, seats: [] };
      line.seats.push(seat);
      lines.set(seat.categoryId, line);
    }
    return [...lines.values()].map((l) => ({ ...l, seats: l.seats.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })) }));
  }, [map, selected]);
}

export default function SeatSelectionPage() {
  const { showtimeId: rawId = '' } = useParams();
  const showtimeId = Number(rawId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useConfig();
  const showtime = useShowtime(showtimeId);
  const seats = useSeatMap(showtimeId);
  const streamStatus = useSeatStream(showtimeId, Boolean(showtime.data));
  const [selected, setSelected] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [seatSize, setSeatSize] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 26 : 30));
  const initialised = useRef(false);
  useDocumentTitle(showtime.data ? `Seats · ${showtime.data.movie.title}` : 'Choose seats');

  // Without a live stream, poll so the map does not go stale.
  const hasSeats = Boolean(seats.data);
  const refetchSeats = seats.refetch;
  useEffect(() => {
    if (streamStatus === 'live' || !hasSeats) return;
    const id = setInterval(() => void refetchSeats(), 15_000);
    return () => clearInterval(id);
  }, [streamStatus, hasSeats, refetchSeats]);

  // Start from the seats already in this browser's hold (state MINE).
  useEffect(() => {
    if (!seats.data || initialised.current) return;
    initialised.current = true;
    setSelected(seats.data.seats.filter((s) => s.state === 'MINE').map((s) => s.id));
  }, [seats.data]);

  // If a selected seat is taken by someone else, drop it and say so.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (!seats.data) return;
    const byId = new Map(seats.data.seats.map((s) => [s.id, s]));
    const current = selectedRef.current;
    const lost = current.filter((id) => {
      const s = byId.get(id);
      return !s || !isSelectable(s);
    });
    if (lost.length === 0) return;
    const labels = lost.map((id) => byId.get(id)?.label ?? `#${id}`).join(', ');
    setSelected(current.filter((id) => !lost.includes(id)));
    toast.warning(`${lost.length === 1 ? `Seat ${labels} was` : `Seats ${labels} were`} just taken by someone else and removed from your selection.`);
  }, [seats.data]);

  const lines = useSelectionLines(seats.data, selected);
  const subtotal = lines.reduce((sum, l) => sum + l.priceMinor * l.seats.length, 0);
  const estimate = estimateTotal(subtotal, config.serviceFeeMinor, config.taxRateBasisPoints, selected.length);
  const selectedLabels = lines.flatMap((l) => l.seats.map((s) => s.label));

  const create = useMutation({
    mutationFn: () => bookingApi.create(showtimeId, selected),
    onSuccess: (booking) => {
      qc.setQueryData(bookingKeys.booking(booking.reference), booking);
      navigate(`/checkout/${booking.reference}`);
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'SEATS_UNAVAILABLE') {
        const raw = error.details.seatIds;
        const taken = Array.isArray(raw) ? raw.filter((v): v is number => typeof v === 'number') : [];
        const labels = seats.data?.seats.filter((s) => taken.includes(s.id)).map((s) => s.label) ?? [];
        setSelected((cur) => cur.filter((id) => !taken.includes(id)));
        setProblem(
          labels.length
            ? `Sorry — ${labels.join(', ')} ${labels.length === 1 ? 'was' : 'were'} taken moments ago. We've removed ${labels.length === 1 ? 'it' : 'them'}; please choose again.`
            : 'Some of your seats were taken moments ago. Please check the map and choose again.',
        );
        void qc.invalidateQueries({ queryKey: bookingKeys.seats(showtimeId) });
      } else if (isApiError(error) && error.code === 'SALES_CLOSED') {
        setProblem('Online sales for this show have just closed.');
        void qc.invalidateQueries({ queryKey: bookingKeys.showtime(showtimeId) });
      } else {
        setProblem(errorMessage(error));
      }
    },
  });

  if (!Number.isFinite(showtimeId)) return <NotFoundPage />;
  const loadError = showtime.error ?? seats.error;
  if (loadError) {
    if (loadError instanceof ApiError && loadError.status === 404) return <NotFoundPage />;
    return (
      <main id="main" className="container-page py-16">
        <ErrorState error={loadError} onRetry={() => { void showtime.refetch(); void seats.refetch(); }} />
      </main>
    );
  }

  const st = showtime.data;
  const map = seats.data;
  const salesClosed = st ? !st.salesOpen || st.status === 'CANCELLED' : false;
  const canContinue = selected.length > 0 && !salesClosed && !create.isPending;

  const summaryBody = (
    <>
      {selected.length === 0 ? (
        <p className="text-sm text-subtle">Select up to {config.maxSeatsPerBooking} seats on the map.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          {lines.map((l) => (
            <div key={l.categoryId} className="flex justify-between gap-3">
              <dt className="text-muted">
                {l.seats.length} × {l.name}
                <span className="block text-xs text-subtle">{l.seats.map((s) => s.label).join(', ')}</span>
              </dt>
              <dd className="tabular-nums text-fg">{formatMoney(l.priceMinor * l.seats.length)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-muted">Service fee (est.)</dt>
            <dd className="tabular-nums text-fg">{formatMoney(estimate.feeMinor)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{config.taxLabel} {formatBasisPoints(config.taxRateBasisPoints)} (est.)</dt>
            <dd className="tabular-nums text-fg">{formatMoney(estimate.taxMinor)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <dt className="font-semibold text-fg">Estimated total</dt>
            <dd className="font-display text-2xl tabular-nums text-fg">{formatMoney(estimate.totalMinor)}</dd>
          </div>
          <p className="text-xs text-subtle">An estimate. Your final price, including any offers, is confirmed at checkout.</p>
        </dl>
      )}
    </>
  );

  return (
    <main id="main" className="container-page pb-40 pt-8 lg:pb-16">
      {st ? (
        <ShowSummary
          className="mb-6"
          show={{
            movie: st.movie,
            cinemaName: st.cinema.name,
            cinemaSlug: st.cinema.slug,
            auditoriumName: st.auditorium.name,
            startsAt: st.startsAt,
            timezone: st.timezone,
            format: st.format,
            language: st.language,
            isSampleData: st.movie.isSampleData,
          }}
        />
      ) : (
        <div className="mb-6 flex gap-4"><Skeleton className="h-28 w-20" /><div className="flex-1 space-y-2"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-4 w-2/3" /></div></div>
      )}

      {map?.myBookingReference && <ExistingHold reference={map.myBookingReference} expiresAt={map.myHoldExpiresAt} />}

      {st && salesClosed && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-semibold text-fg">{st.status === 'CANCELLED' ? 'This show has been cancelled' : 'Online sales have closed for this show'}</p>
            <p className="text-sm text-muted">
              {st.status === 'CANCELLED' ? 'Choose another showtime for this film.' : `Sales closed at ${formatTime(st.salesCloseAt, st.timezone)}. Choose another showtime.`}{' '}
              <Link to={`/movies/${st.movie.slug}`} className="font-semibold text-accent hover:underline">See other times</Link>
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="seatmap-heading" className="min-w-0 rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="seatmap-heading" className="text-sm font-semibold text-fg">Choose your seats</h2>
            <div className="flex items-center gap-3">
              <span className={cn('inline-flex items-center gap-1.5 text-xs', streamStatus === 'live' ? 'text-success' : 'text-subtle')}>
                <Radio className="size-3.5" aria-hidden />
                {streamStatus === 'live' ? 'Live availability' : streamStatus === 'reconnecting' ? 'Reconnecting…' : 'Auto-refreshing'}
              </span>
              <div className="flex items-center rounded-md border border-line" role="group" aria-label="Zoom seat map">
                <Button variant="ghost" size="icon-sm" onClick={() => setSeatSize((s) => Math.max(20, s - 4))} disabled={seatSize <= 20} aria-label="Zoom out">
                  <Minus className="size-3.5" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setSeatSize((s) => Math.min(42, s + 4))} disabled={seatSize >= 42} aria-label="Zoom in">
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto px-4 py-8">
            <div className="mx-auto w-max min-w-full text-center">
              <ScreenIndicator />
              {map ? (
                <SeatMap
                  map={map}
                  selected={selected}
                  onChange={(next) => {
                    setProblem(null);
                    setSelected(next);
                  }}
                  maxSeats={config.maxSeatsPerBooking}
                  onLimitReached={(max) => toast.info(`You can book up to ${max} seats at a time.`)}
                  disabled={salesClosed}
                  seatSize={seatSize}
                />
              ) : (
                <div className="mx-auto grid w-max gap-1.5" aria-hidden>
                  {Array.from({ length: 8 }, (_, r) => (
                    <div key={r} className="flex gap-1.5">
                      {Array.from({ length: 14 }, (_, c) => <Skeleton key={c} className="size-7" />)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {map && (
            <div className="border-t border-line px-4 py-4">
              <SeatLegend categories={map.categories} />
            </div>
          )}
        </section>

        <aside className="hidden lg:block" aria-labelledby="summary-heading">
          <div className="sticky top-24 rounded-lg border border-line bg-surface p-5">
            <h2 id="summary-heading" className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
              <Ticket className="size-4 text-accent" aria-hidden /> Your selection
            </h2>
            {summaryBody}
            <div className="mt-4 space-y-3">
              <FormError message={problem} />
              <Button size="lg" className="w-full" disabled={!canContinue} loading={create.isPending} onClick={() => create.mutate()}>
                Continue <ArrowRight className="size-4" aria-hidden />
              </Button>
              {st?.movie.isSampleData && (
                <p className="text-center text-xs text-subtle">This is a development showtime — no real tickets are issued.</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      <p className="sr-only" aria-live="polite">
        {selected.length === 0 ? 'No seats selected.' : `${selected.length} ${selected.length === 1 ? 'seat' : 'seats'} selected: ${selectedLabels.join(', ')}. Estimated total ${formatMoney(estimate.totalMinor)}.`}
      </p>

      {/* Mobile: sticky bottom summary */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 backdrop-blur-md lg:hidden">
        <div className="container-page pb-safe pt-3">
          {problem && <div className="mb-2"><FormError message={problem} /></div>}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">
                {selected.length === 0 ? 'No seats selected' : `${selected.length} ${selected.length === 1 ? 'seat' : 'seats'} · ${selectedLabels.join(', ')}`}
              </p>
              <p className="text-xs text-subtle">
                {selected.length > 0 ? `Est. ${formatMoney(estimate.totalMinor)} incl. fees` : `Up to ${config.maxSeatsPerBooking} seats`}
              </p>
            </div>
            <Button disabled={!canContinue} loading={create.isPending} onClick={() => create.mutate()}>
              Continue <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
