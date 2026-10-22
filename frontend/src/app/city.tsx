import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { catalogApi, catalogKeys } from '@/features/catalog/api';
import { useCurrentUser, useUpdateProfile } from '@/features/auth/api';
import { errorMessage } from '@/lib/api';
import { getStored, setStored, STORAGE_KEYS } from '@/lib/storage';
import type { City } from '@/types/api';

interface CityContextValue {
  city: City;
  cities: City[];
  setCity: (slug: string) => void;
}

const CityContext = createContext<CityContextValue | null>(null);

/**
 * The selected city. Order of preference: the signed-in user's `preferredCitySlug`, then the
 * browser's remembered choice (a convenience only), then the default city from the API.
 */
export function CityProvider({ children }: { children: ReactNode }) {
  const { data: cities = [] } = useQuery({ queryKey: catalogKeys.cities(), queryFn: catalogApi.cities, staleTime: Infinity });
  const user = useCurrentUser();
  const updateProfile = useUpdateProfile();
  const [localSlug, setLocalSlug] = useState<string | null>(() => getStored(STORAGE_KEYS.city));

  const city = useMemo(() => {
    const bySlug = (slug: string | null | undefined) => (slug ? cities.find((c) => c.slug === slug) : undefined);
    return bySlug(user?.preferredCitySlug) ?? bySlug(localSlug) ?? cities.find((c) => c.isDefault) ?? cities[0];
  }, [cities, user?.preferredCitySlug, localSlug]);

  const { mutate } = updateProfile;
  const setCity = useCallback(
    (slug: string) => {
      setLocalSlug(slug);
      setStored(STORAGE_KEYS.city, slug);
      if (user && user.preferredCitySlug !== slug) {
        mutate(
          { fullName: user.fullName, phone: user.phone, preferredCitySlug: slug, marketingOptIn: user.marketingOptIn },
          { onError: (e) => toast.error(`Could not save your preferred city: ${errorMessage(e)}`) },
        );
      }
    },
    [user, mutate],
  );

  const value = useMemo(() => (city ? { city, cities, setCity } : null), [city, cities, setCity]);

  if (!value) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center text-muted">
        <p>No cities are configured yet. Please check back soon.</p>
      </div>
    );
  }
  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity(): CityContextValue {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error('useCity must be used inside <CityProvider>');
  return ctx;
}
