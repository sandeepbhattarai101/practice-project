import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Button, Dialog, Field, FormError, Textarea, toast } from '@/components/ui';
import { adminApi, adminKeys } from '@/features/admin/api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import type { AdminShowtime } from '@/types/api';

export function CancelShowtimeDialog({ showtime, onClose, timeZone }: { showtime: AdminShowtime | null; onClose: () => void; timeZone: string }) {
  if (!showtime) return null;
  return <CancelShowtimeForm key={showtime.id} showtime={showtime} onClose={onClose} timeZone={timeZone} />;
}

function CancelShowtimeForm({ showtime, onClose, timeZone }: { showtime: AdminShowtime; onClose: () => void; timeZone: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const cancel = useMutation({
    mutationFn: () => adminApi.cancelShowtime(showtime.id, reason.trim()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'showtimes'] }),
        queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'bookings'] }),
        queryClient.invalidateQueries({ queryKey: [...adminKeys.all, 'refunds'] }),
      ]);
      toast.success('Showtime cancelled. Every booking is being refunded in full.');
      onClose();
    },
  });
  const reasonError = touched && reason.trim().length < 5 ? 'Give a reason of at least 5 characters. Customers may see it.' : undefined;
  const affected = showtime.sold + showtime.held;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!cancel.isPending}
      role="alertdialog"
      title="Cancel this showtime?"
      description={`${showtime.movie.title} · ${showtime.cinema.name}, ${showtime.auditorium.name} · ${formatDateTime(showtime.startsAt, timeZone)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            Keep showtime
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            onClick={() => {
              setTouched(true);
              if (reason.trim().length >= 5) cancel.mutate();
            }}
          >
            Cancel showtime and refund all
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p>
            <strong className="font-semibold">All bookings for this show will be cancelled and refunded in full.</strong>{' '}
            {affected > 0
              ? `${showtime.sold} sold and ${showtime.held} held ${affected === 1 ? 'seat is' : 'seats are'} affected.`
              : 'No seats are sold or held yet.'}{' '}
            This cannot be undone.
          </p>
        </div>
        <FormError message={cancel.error ? errorMessage(cancel.error) : null} />
        <Field label="Reason" required error={reasonError}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              placeholder="e.g. Projector failure in Audi 2"
              maxLength={500}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
