import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingApi, bookingKeys } from '../api';
import { LookupForm } from '../components/LookupForm';
import { errorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { FormError, Spinner } from '@/components/ui';

export default function FindBookingPage() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const token = params.get('token');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const started = useRef(false);
  useDocumentTitle('Find a booking');

  const byToken = useMutation({
    mutationFn: () => bookingApi.lookup({ reference: ref, token: token as string }),
    onSuccess: (booking) => {
      qc.setQueryData(bookingKeys.booking(booking.reference), booking);
      navigate(`/bookings/${booking.reference}`, { replace: true });
    },
  });

  // Links in our emails carry ?ref=&token= — use them straight away.
  const { mutate } = byToken;
  useEffect(() => {
    if (ref && token && !started.current) {
      started.current = true;
      mutate();
    }
  }, [ref, token, mutate]);

  const auto = Boolean(ref && token);

  return (
    <main id="main" className="container-page grid min-h-[60vh] place-items-center py-14">
      <div className="w-full max-w-md">
        <p className="eyebrow mb-2">Guest bookings</p>
        <h1 className="font-display text-4xl text-fg">Find your booking</h1>
        <p className="mt-2 text-muted">Enter the reference from your confirmation email and the email address you booked with.</p>
        <div className="mt-8 rounded-lg border border-line bg-surface p-6">
          {auto && (byToken.isPending || byToken.isIdle || byToken.isSuccess) ? (
            <div className="flex items-center gap-3 py-6" role="status">
              <Spinner /> <span className="text-muted">Opening booking {ref}…</span>
            </div>
          ) : (
            <LookupForm
              defaultReference={ref}
              intro={byToken.isError ? <FormError message={`That link could not be used (${errorMessage(byToken.error)}). Enter your details instead.`} /> : undefined}
            />
          )}
        </div>
        <p className="mt-6 text-center text-sm text-subtle">
          Booked while signed in? <Link to="/account/bookings" className="font-semibold text-accent hover:underline">See my bookings</Link>
        </p>
      </div>
    </main>
  );
}
