import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleSlash, QrCode, ScanLine, UserCheck, XCircle } from 'lucide-react';
import { Button, FormError, useConfirm } from '@/components/ui';
import { adminApi } from '@/features/admin/api';
import { AdminPageHeader, DetailList } from '@/features/admin/components/AdminUi';
import { Mono } from '@/features/admin/ops/shared';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import type { CheckinResult, CheckinResultCode } from '@/types/api';

const RESULT_UI: Record<CheckinResultCode, { title: string; detail: string; tone: 'success' | 'warning' | 'danger'; icon: typeof CheckCircle2 }> = {
  VALID: { title: 'Valid ticket', detail: 'Check the seats with the guest, then admit them.', tone: 'success', icon: CheckCircle2 },
  ALREADY_CHECKED_IN: { title: 'Already checked in', detail: 'This ticket has been used. Do not admit again without checking with a manager.', tone: 'warning', icon: AlertTriangle },
  NOT_CONFIRMED: { title: 'Booking not confirmed', detail: 'Payment was not completed or the booking was cancelled. Do not admit.', tone: 'danger', icon: CircleSlash },
  WRONG_DAY: { title: 'Wrong day', detail: 'This ticket is for a different date. Do not admit.', tone: 'danger', icon: XCircle },
  INVALID: { title: 'Invalid code', detail: 'We could not find a ticket for this code. Ask for the booking reference and search Bookings.', tone: 'danger', icon: XCircle },
};

const TONE_CLASSES = {
  success: 'border-success/40 bg-success/10 [--tone:var(--color-success)]',
  warning: 'border-warning/40 bg-warning/10 [--tone:var(--color-warning)]',
  danger: 'border-danger/40 bg-danger/10 [--tone:var(--color-danger)]',
};

export default function CheckinPage() {
  useDocumentTitle('Check-in');
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ code: string; data: CheckinResult; admitted: boolean } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const refocus = () => requestAnimationFrame(() => inputRef.current?.focus());

  const lookup = useMutation({
    mutationFn: (value: string) => adminApi.checkinLookup(value),
    onSuccess: (data, value) => {
      setResult({ code: value, data, admitted: false });
      if (data.result !== 'VALID') {
        setCode('');
        refocus();
      }
    },
    onSettled: () => refocus(),
  });

  const admit = useMutation({
    mutationFn: (value: string) => adminApi.checkinConfirm(value),
    onSuccess: (data, value) => {
      setResult({ code: value, data, admitted: data.result === 'VALID' || Boolean(data.booking?.checkedInAt) });
      setCode('');
      refocus();
    },
    onError: () => refocus(),
  });

  const submit = () => {
    const value = code.trim();
    if (!value || lookup.isPending) return;
    admit.reset();
    lookup.mutate(value);
  };

  const onAdmit = async () => {
    if (!result || result.data.result !== 'VALID') return;
    const b = result.data.booking;
    const ok = await confirm({
      title: 'Admit this guest?',
      description: b ? `${b.items.length} ${b.items.length === 1 ? 'seat' : 'seats'} (${b.items.map((i) => i.seatLabel).join(', ')}) for ${b.showtime.movie.title}.` : undefined,
      confirmLabel: 'Admit',
    });
    if (ok) admit.mutate(result.code);
    else refocus();
  };

  const error = lookup.error ?? admit.error;

  return (
    <>
      <AdminPageHeader title="Check-in" description="Scan the ticket QR code, or type the ticket code, and press Enter." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="checkin-code" className="text-[13px] font-medium text-muted">
            Ticket code or QR payload
          </label>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-accent" aria-hidden />
            <input
              ref={inputRef}
              id="checkin-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="Scan or paste…"
              className="h-16 w-full rounded-lg border border-line-strong bg-surface pl-14 pr-4 font-mono text-xl tracking-wide text-fg placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-subtle transition-colors duration-150 focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="lg" loading={lookup.isPending} disabled={!code.trim()} leftIcon={<QrCode className="size-4" aria-hidden />}>
              Look up
            </Button>
            {result && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setResult(null);
                  setCode('');
                  lookup.reset();
                  admit.reset();
                  refocus();
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <FormError message={error ? errorMessage(error) : null} />
          <p className="text-xs text-subtle">Most scanners type the code and press Enter for you. Keep this field focused between guests.</p>
        </form>

        <div aria-live="polite" aria-atomic="true">
          {result ? (
            <ResultCard result={result.data} admitted={result.admitted} onAdmit={onAdmit} admitting={admit.isPending} />
          ) : (
            <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-line p-8 text-center text-sm text-subtle">
              <div>
                <QrCode className="mx-auto mb-3 size-8 text-line-strong" aria-hidden />
                Waiting for a ticket
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ResultCard({ result, admitted, onAdmit, admitting }: { result: CheckinResult; admitted: boolean; onAdmit: () => void; admitting: boolean }) {
  const ui = admitted
    ? { title: 'Admitted', detail: 'Enjoy the show. Ready for the next guest.', tone: 'success' as const, icon: UserCheck }
    : RESULT_UI[result.result];
  const Icon = ui.icon;
  const b = result.booking;
  const tz = b?.showtime.timezone;

  return (
    <section className={cn('animate-pop-in overflow-hidden rounded-lg border', TONE_CLASSES[ui.tone])} aria-label="Check-in result">
      <div className="flex items-start gap-3 p-5">
        <Icon className="mt-0.5 size-8 shrink-0 text-[var(--tone)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl text-[var(--tone)]">{ui.title}</h2>
          <p className="mt-1 text-sm text-fg">{ui.detail}</p>
        </div>
        {result.result === 'VALID' && !admitted && (
          <Button size="lg" onClick={onAdmit} loading={admitting} leftIcon={<UserCheck className="size-4" aria-hidden />}>
            Admit
          </Button>
        )}
      </div>
      {b && (
        <div className="border-t border-line bg-surface p-5">
          <p className="font-display text-xl text-fg">{b.showtime.movie.title}</p>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Seats">
            {b.items.map((i) => (
              <span key={i.seatId} className="rounded-sm border border-line-strong bg-raised px-2 py-1 text-sm font-semibold tabular-nums text-fg">
                {i.seatLabel}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <DetailList
              items={[
                { label: 'Time', value: formatDateTime(b.showtime.startsAt, tz) },
                { label: 'Cinema', value: `${b.showtime.cinema.name} · ${b.showtime.auditorium.name}` },
                { label: 'Customer', value: b.customer.name ?? b.customer.email ?? 'Guest' },
                { label: 'Reference', value: <Mono>{b.reference}</Mono> },
                { label: 'Format', value: `${b.showtime.format} · ${b.showtime.language}` },
                { label: 'Checked in', value: b.checkedInAt ? formatDateTime(b.checkedInAt, tz) : 'Not yet' },
              ]}
            />
          </div>
        </div>
      )}
    </section>
  );
}
