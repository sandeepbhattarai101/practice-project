import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useCurrentUser, useRegister } from '../api';
import { emailField, newPasswordField } from '../schemas';
import { AuthCard, applyServerFieldErrors } from '../components/AuthCard';
import { PASSWORD_HINT, PasswordInput } from '../components/PasswordInput';
import { safeNext } from '@/app/guards';
import { errorMessage, isApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, Field, FormError, Input } from '@/components/ui';

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(120, 'That name is too long.'),
    email: emailField,
    phone: z.string().trim().max(20, 'That phone number is too long.').refine((v) => v === '' || /^[+\d][\d\s-]{6,}$/.test(v), 'Enter a valid phone number.'),
    password: newPasswordField,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The passwords do not match.' });
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const user = useCurrentUser();
  const register = useRegister();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { fullName: '', email: '', phone: '', password: '', confirm: '' } });
  useDocumentTitle('Create an account');

  if (user && !register.isPending && !register.isSuccess) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(({ confirm: _confirm, phone, ...rest }) =>
    register.mutate(
      { ...rest, ...(phone ? { phone } : {}) },
      {
        onSuccess: ({ user: u }) => {
          toast.success(`Welcome, ${u.fullName.split(' ')[0]}. Check your inbox to verify your email.`);
          navigate(next === '/' ? '/account' : next, { replace: true });
        },
        onError: (e) => applyServerFieldErrors(e, form.setError, ['fullName', 'email', 'phone', 'password']),
      },
    ),
  );

  const err = register.error;
  const message = !err || (isApiError(err) && err.code === 'VALIDATION_FAILED' && err.fieldErrors.length > 0) ? null : errorMessage(err);

  return (
    <AuthCard
      title="Create an account"
      subtitle="Faster checkout and every ticket in one place."
      footer={<>Already a member? <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent hover:underline">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={message} />
        <Field label="Full name" required error={form.formState.errors.fullName?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} autoComplete="name" autoFocus aria-describedby={describedBy} aria-invalid={invalid} {...form.register('fullName')} />}
        </Field>
        <Field label="Email" required error={form.formState.errors.email?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('email')} />}
        </Field>
        <Field label="Phone" hint="Optional" error={form.formState.errors.phone?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="tel" autoComplete="tel" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('phone')} />}
        </Field>
        <Field label="Password" required hint={PASSWORD_HINT} error={form.formState.errors.password?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('password')} />}
        </Field>
        <Field label="Confirm password" required error={form.formState.errors.confirm?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('confirm')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={register.isPending}>Create account</Button>
      </form>
    </AuthCard>
  );
}
