import { useEffect } from 'react';
import { NavLink } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailWarning, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { authApi, useCurrentUser, useUpdateProfile } from '@/features/auth/api';
import { newPasswordField } from '@/features/auth/schemas';
import { applyServerFieldErrors } from '@/features/auth/components/AuthCard';
import { PASSWORD_HINT, PasswordInput } from '@/features/auth/components/PasswordInput';
import { useCity } from '@/app/city';
import { errorMessage, isApiError } from '@/lib/api';
import { setStored, STORAGE_KEYS } from '@/lib/storage';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, ButtonLink, Checkbox, Field, FormError, Input, Select } from '@/components/ui';
import type { User } from '@/types/api';

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120, 'That name is too long.'),
  phone: z.string().trim().max(20, 'That phone number is too long.').refine((v) => v === '' || /^[+\d][\d\s-]{6,}$/.test(v), 'Enter a valid phone number.'),
  preferredCitySlug: z.string(),
  marketingOptIn: z.boolean(),
});
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: newPasswordField, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'The passwords do not match.' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password you have not used here before.' });
type PasswordValues = z.infer<typeof passwordSchema>;

function VerificationBanner({ user }: { user: User }) {
  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => toast.success(`Verification email sent to ${user.email}.`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (user.emailVerified) return null;
  return (
    <div className="mb-8 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div>
          <p className="font-semibold text-fg">Please verify your email address</p>
          <p className="text-sm text-muted">We sent a link to {user.email}. Verifying makes sure your tickets and receipts reach you.</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={() => resend.mutate()} loading={resend.isPending} disabled={resend.isSuccess}>
        {resend.isSuccess ? 'Email sent' : 'Resend email'}
      </Button>
    </div>
  );
}

function ProfileForm({ user }: { user: User }) {
  const { cities } = useCity();
  const update = useUpdateProfile();
  const toValues = (u: User): ProfileValues => ({
    fullName: u.fullName,
    phone: u.phone ?? '',
    preferredCitySlug: u.preferredCitySlug ?? '',
    marketingOptIn: u.marketingOptIn,
  });
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: toValues(user) });
  const { reset } = form;
  useEffect(() => reset(toValues(user)), [user, reset]);

  const onSubmit = form.handleSubmit((v) =>
    update.mutate(
      { fullName: v.fullName, phone: v.phone || null, preferredCitySlug: v.preferredCitySlug || null, marketingOptIn: v.marketingOptIn },
      {
        onSuccess: ({ user: u }) => {
          if (u.preferredCitySlug) setStored(STORAGE_KEYS.city, u.preferredCitySlug);
          toast.success('Your profile has been saved.');
        },
        onError: (e) => applyServerFieldErrors(e, form.setError, ['fullName', 'phone', 'preferredCitySlug', 'marketingOptIn']),
      },
    ),
  );
  const err = update.error;
  const message = !err || (isApiError(err) && err.fieldErrors.length > 0) ? null : errorMessage(err);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <FormError message={message} />
      <Field label="Email">
        {({ id }) => <Input id={id} value={user.email} readOnly disabled />}
      </Field>
      <Field label="Full name" required error={form.formState.errors.fullName?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} autoComplete="name" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('fullName')} />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone" error={form.formState.errors.phone?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="tel" autoComplete="tel" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('phone')} />}
        </Field>
        <Field label="Preferred city">
          {({ id }) => (
            <Select id={id} {...form.register('preferredCitySlug')}>
              <option value="">No preference</option>
              {cities.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <Checkbox label="Email me about new releases, screenings and member offers." {...form.register('marketingOptIn')} />
      <div className="flex justify-end">
        <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>Save changes</Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const change = useMutation({
    mutationFn: (v: PasswordValues) => authApi.changePassword(v.currentPassword, v.newPassword),
    onSuccess: () => {
      form.reset();
      toast.success('Your password has been changed.');
    },
    onError: (e) => applyServerFieldErrors(e, form.setError, ['currentPassword', 'newPassword']),
  });
  const err = change.error;
  const message = !err || (isApiError(err) && err.fieldErrors.length > 0) ? null : errorMessage(err);
  return (
    <form onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate className="space-y-5">
      <FormError message={message} />
      <Field label="Current password" required error={form.formState.errors.currentPassword?.message}>
        {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="current-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('currentPassword')} />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="New password" required hint={PASSWORD_HINT} error={form.formState.errors.newPassword?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('newPassword')} />}
        </Field>
        <Field label="Confirm new password" required error={form.formState.errors.confirm?.message}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...form.register('confirm')} />}
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" loading={change.isPending}>Change password</Button>
      </div>
    </form>
  );
}

export function AccountNav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`;
  return (
    <nav aria-label="Account" className="mb-8 flex gap-2">
      <NavLink to="/account" end className={cls}>
        Profile
      </NavLink>
      <NavLink to="/account/bookings" end className={cls}>
        My bookings
      </NavLink>
    </nav>
  );
}

export default function AccountPage() {
  const user = useCurrentUser();
  useDocumentTitle('My account');
  if (!user) return null; // RequireAuth redirects guests before this renders.
  return (
    <main id="main" className="container-page max-w-3xl pt-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Account</p>
          <h1 className="font-display text-4xl text-fg">Hello, {user.fullName.split(' ')[0]}</h1>
        </div>
        <ButtonLink to="/account/bookings" variant="secondary"><Ticket className="size-4" aria-hidden /> My bookings</ButtonLink>
      </header>
      <AccountNav />
      <VerificationBanner user={user} />
      <section aria-labelledby="profile-heading" className="rounded-lg border border-line bg-surface p-6">
        <h2 id="profile-heading" className="mb-5 font-display text-xl text-fg">Profile</h2>
        <ProfileForm user={user} />
      </section>
      <section aria-labelledby="password-heading" className="mt-6 rounded-lg border border-line bg-surface p-6">
        <h2 id="password-heading" className="mb-5 font-display text-xl text-fg">Password</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
