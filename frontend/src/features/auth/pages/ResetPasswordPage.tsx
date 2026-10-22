import { Link, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { authApi } from '../api';
import { newPasswordField } from '../schemas';
import { AuthCard, applyServerFieldErrors } from '../components/AuthCard';
import { PASSWORD_HINT, PasswordInput } from '../components/PasswordInput';
import { errorMessage, isApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, ButtonLink, Field, FormError } from '@/components/ui';

const schema = z
  .object({ password: newPasswordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The passwords do not match.' });
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const reset = useMutation({
    mutationFn: (v: Values) => authApi.resetPassword(token, v.password),
    onError: (e) => applyServerFieldErrors(e, form.setError, ['password']),
  });
  useDocumentTitle('Choose a new password');

  if (!token) {
    return (
      <AuthCard title="Link not valid" footer={<Link to="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>}>
        <p className="text-center text-muted">This reset link is missing its token. Request a new link and use it within the time shown in the email.</p>
        <ButtonLink to="/forgot-password" className="mt-6 w-full">Request a new link</ButtonLink>
      </AuthCard>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthCard title="Password updated">
        <div className="text-center" role="status">
          <CheckCircle2 className="mx-auto mb-4 size-8 text-success" aria-hidden />
          <p className="text-muted">Your password has been changed. You can now sign in with your new password.</p>
          <ButtonLink to="/login" className="mt-6 w-full">Sign in</ButtonLink>
        </div>
      </AuthCard>
    );
  }

  const err = reset.error;
  const message = !err || (isApiError(err) && err.fieldErrors.length > 0) ? null : errorMessage(err);

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={form.handleSubmit((v) => reset.mutate(v))} noValidate className="space-y-5">
        <FormError message={message} />
        {message && (
          <p className="text-sm text-muted">
            If your link has expired, <Link to="/forgot-password" className="font-semibold text-accent hover:underline">request a new one</Link>.
          </p>
        )}
        <Field label="New password" required hint={PASSWORD_HINT} error={form.formState.errors.password?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" autoFocus aria-describedby={describedBy} aria-invalid={invalid} {...form.register('password')} />}
        </Field>
        <Field label="Confirm new password" required error={form.formState.errors.confirm?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('confirm')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={reset.isPending}>Update password</Button>
      </form>
    </AuthCard>
  );
}
