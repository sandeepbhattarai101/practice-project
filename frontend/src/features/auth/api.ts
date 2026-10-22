import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureCsrf } from '@/lib/api';
import type { User } from '@/types/api';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}
export interface ProfileInput {
  fullName: string;
  phone: string | null;
  preferredCitySlug: string | null;
  marketingOptIn: boolean;
}

export const authApi = {
  me: () => api.get<{ user: User | null }>('/api/auth/me'),
  login: (body: LoginInput) => api.post<{ user: User }>('/api/auth/login', body),
  register: (body: RegisterInput) => api.post<{ user: User }>('/api/auth/register', body),
  logout: () => api.post<void>('/api/auth/logout'),
  verifyEmail: (token: string) => api.post<void>('/api/auth/verify-email', { token }),
  resendVerification: () => api.post<void>('/api/auth/resend-verification'),
  forgotPassword: (email: string) => api.post<void>('/api/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post<void>('/api/auth/reset-password', { token, password }),
  updateProfile: (body: ProfileInput) => api.put<{ user: User }>('/api/me/profile', body),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.put<void>('/api/me/password', { currentPassword, newPassword }),
};

export const meQuery = {
  queryKey: authKeys.me,
  queryFn: authApi.me,
  staleTime: Infinity,
} as const;

/** The signed-in user, or null for guests. Loaded at boot. */
export function useCurrentUser(): User | null {
  const { data } = useQuery(meQuery);
  return data?.user ?? null;
}

/** Password rule from the contract: 10–128 characters, including a letter and a digit. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 128) return 'Use no more than 128 characters.';
  if (!/[A-Za-z]/.test(password)) return 'Include at least one letter.';
  if (!/\d/.test(password)) return 'Include at least one number.';
  return null;
}

function useSetUser() {
  const qc = useQueryClient();
  return (user: User | null) => qc.setQueryData(authKeys.me, { user });
}

export function useLogin() {
  const setUser = useSetUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: async ({ user }) => {
      // Spring Security typically rotates the CSRF token on authentication.
      await ensureCsrf(true);
      setUser(user);
      await qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

export function useRegister() {
  const setUser = useSetUser();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: async ({ user }) => {
      await ensureCsrf(true);
      setUser(user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await ensureCsrf(true);
      qc.setQueryData(authKeys.me, { user: null });
      qc.removeQueries({ queryKey: ['account'] });
      qc.removeQueries({ queryKey: ['admin'] });
      qc.removeQueries({ queryKey: ['booking'] });
    },
  });
}

export function useUpdateProfile() {
  const setUser = useSetUser();
  return useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: ({ user }) => setUser(user),
  });
}
