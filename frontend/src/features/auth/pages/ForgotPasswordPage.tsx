import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { authApi } from '../api';
import { emailField } from '../schemas';
import { AuthCard } from '../components/AuthCard';
import { errorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, Field, FormError, Input } from '@/components/ui';

const schema = z.object({ email: emailField });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const send = useMutation({ mutationFn: (v: Values) => authApi.forgotPassword(v.email) });
  useDocumentTitle('Reset your password');

  if (send.isSuccess) {
    return (
      <AuthCard title="Check your inbox" footer={<Link to="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>}>
        <div className="text-center" role="status">
          <MailCheck className="mx-auto mb-4 size-8 text-accent" aria-hidden />
          <p className="text-muted">
            If an account exists for <strong className="text-fg">{send.variables.email}</strong>, we've sent a link to reset your password. It may take a minute to arrive.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgotten password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={<>Remembered it? <Link to="/login" className="font-semibold text-accent hover:underline">Sign in</Link></>}
    >
      <form onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate className="space-y-5">
        <FormError message={send.error ? errorMessage(send.error) : null} />
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" autoFocus aria-describedby={describedBy} aria-invalid={invalid} {...form.register('email')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={send.isPending}>Send reset link</Button>
      </form>
    </AuthCard>
  );
}
