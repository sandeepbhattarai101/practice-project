import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { authApi, authKeys, useCurrentUser } from '../api';
import { AuthCard } from '../components/AuthCard';
import { errorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, ButtonLink, Spinner } from '@/components/ui';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const user = useCurrentUser();
  const qc = useQueryClient();
  const started = useRef(false);
  useDocumentTitle('Verify your email');

  const verify = useMutation({
    mutationFn: () => authApi.verifyEmail(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.me }),
  });
  const resend = useMutation({ mutationFn: authApi.resendVerification });

  const { mutate } = verify;
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      mutate();
    }
  }, [token, mutate]);

  if (!token || verify.isError) {
    return (
      <AuthCard title="We couldn't verify your email">
        <div className="text-center">
          <XCircle className="mx-auto mb-4 size-8 text-danger" aria-hidden />
          <p className="text-muted">{token ? errorMessage(verify.error) : 'This link is missing its verification token.'} The link may have expired or already been used.</p>
          {user ? (
            resend.isSuccess ? (
              <p className="mt-6 text-sm text-success" role="status">A new verification email is on its way to {user.email}.</p>
            ) : (
              <>
                <Button className="mt-6 w-full" onClick={() => resend.mutate()} loading={resend.isPending}>Send a new link</Button>
                {resend.error && <p className="mt-3 text-sm text-danger">{errorMessage(resend.error)}</p>}
              </>
            )
          ) : (
            <ButtonLink to="/login?next=%2Faccount" className="mt-6 w-full">Sign in to request a new link</ButtonLink>
          )}
        </div>
      </AuthCard>
    );
  }

  if (verify.isSuccess) {
    return (
      <AuthCard title="Email verified">
        <div className="text-center" role="status">
          <CheckCircle2 className="mx-auto mb-4 size-8 text-success" aria-hidden />
          <p className="text-muted">Thanks — your email address is confirmed.</p>
          <ButtonLink to={user ? '/account' : '/login'} className="mt-6 w-full">{user ? 'Go to my account' : 'Sign in'}</ButtonLink>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verifying your email">
      <div className="flex items-center justify-center gap-3 py-4" role="status">
        <Spinner /> <span className="text-muted">One moment…</span>
      </div>
    </AuthCard>
  );
}
