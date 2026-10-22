import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useCurrentUser, useLogin } from '../api';
import { emailField } from '../schemas';
import { AuthCard, applyServerFieldErrors } from '../components/AuthCard';
import { PasswordInput } from '../components/PasswordInput';
import { safeNext } from '@/app/guards';
import { errorMessage, isApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, Field, FormError, Input } from '@/components/ui';

const schema = z.object({ email: emailField, password: z.string().min(1, 'Enter your password.') });
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const user = useCurrentUser();
  const login = useLogin();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  useDocumentTitle('Sign in');

  if (user && !login.isPending && !login.isSuccess) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: ({ user: u }) => {
        toast.success(`Welcome back, ${u.fullName.split(' ')[0]}.`);
        navigate(next, { replace: true });
      },
      onError: (e) => applyServerFieldErrors(e, form.setError, ['email', 'password']),
    }),
  );

  const err = login.error;
  const message = !err
    ? null
    : isApiError(err) && err.code === 'INVALID_CREDENTIALS'
      ? 'That email and password combination is not right. Please try again.'
      : isApiError(err) && err.code === 'ACCOUNT_LOCKED'
        ? `${err.message || 'Your account is temporarily locked after too many attempts.'} You can reset your password to regain access.`
        : isApiError(err) && err.code === 'VALIDATION_FAILED'
          ? null
          : errorMessage(err);

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Your seats are waiting."
      footer={<>New to Practice Project? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent hover:underline">Create an account</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={message} />
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" autoFocus aria-describedby={describedBy} aria-invalid={invalid} {...form.register('email')} />}
        </Field>
        <Field label="Password" required error={form.formState.errors.password?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="current-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted hover:text-accent">Forgotten your password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>Sign in</Button>
        <p className="text-center text-xs text-subtle">
          Just booking once? <Link to="/movies" className="text-muted hover:text-fg">You can check out as a guest.</Link>
        </p>
      </form>
    </AuthCard>
  );
}
