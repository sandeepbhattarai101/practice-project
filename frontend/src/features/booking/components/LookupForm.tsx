import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search } from 'lucide-react';
import { bookingApi, bookingKeys } from '../api';
import { errorMessage, isApiError } from '@/lib/api';
import { Button, Field, FormError, Input } from '@/components/ui';

const schema = z.object({
  reference: z.string().trim().min(4, 'Enter your booking reference.').max(40),
  email: z.string().trim().min(1, 'Enter the email used for the booking.').email('Enter a valid email address.'),
});
type Values = z.infer<typeof schema>;

/** Guest booking lookup (reference + email). Grants this session access, then opens the booking. */
export function LookupForm({ defaultReference = '', intro }: { defaultReference?: string; intro?: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reference: defaultReference, email: '' } });
  const lookup = useMutation({
    mutationFn: (v: Values) => bookingApi.lookup({ reference: v.reference.toUpperCase(), email: v.email }),
    onSuccess: (booking) => {
      qc.setQueryData(bookingKeys.booking(booking.reference), booking);
      navigate(`/bookings/${booking.reference}`, { replace: true });
    },
    onError: (e) => {
      if (isApiError(e)) {
        for (const f of e.fieldErrors) if (f.field === 'reference' || f.field === 'email') form.setError(f.field, { message: f.message });
      }
    },
  });
  const message =
    lookup.error && isApiError(lookup.error) && (lookup.error.status === 404 || lookup.error.status === 403)
      ? 'We could not find a booking with that reference and email. Check both and try again.'
      : lookup.error
        ? errorMessage(lookup.error)
        : null;

  return (
    <form onSubmit={form.handleSubmit((v) => lookup.mutate(v))} noValidate className="space-y-4">
      {intro}
      <FormError message={message} />
      <Field label="Booking reference" required error={form.formState.errors.reference?.message}>
        {({ id, describedBy, invalid }) => (
          <Input id={id} autoComplete="off" className="font-mono uppercase tracking-wider" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('reference')} />
        )}
      </Field>
      <Field label="Email address" required error={form.formState.errors.email?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('email')} />}
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={lookup.isPending}>
        <Search className="size-4" aria-hidden /> Find my booking
      </Button>
    </form>
  );
}
