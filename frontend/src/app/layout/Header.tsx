import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { ChevronDown, LayoutDashboard, LogOut, MapPin, Menu, Ticket, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useCity } from '@/app/city';
import { useCurrentUser, useLogout } from '@/features/auth/api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, ButtonLink, Dialog } from '@/components/ui';
import { Logo } from '../Logo';
import { SearchBox } from './SearchBox';

export const NAV_LINKS = [
  { to: '/movies', label: 'Movies' },
  { to: '/cinemas', label: 'Cinemas' },
  { to: '/offers', label: 'Offers' },
] as const;

export function CitySelect({ className, id }: { className?: string; id?: string }) {
  const { city, cities, setCity } = useCity();
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cn('relative flex items-center', className)}>
      <label htmlFor={selectId} className="sr-only">
        City
      </label>
      <MapPin className="pointer-events-none absolute left-2.5 size-4 text-accent" aria-hidden />
      <select
        id={selectId}
        value={city.slug}
        onChange={(e) => setCity(e.target.value)}
        className="h-10 w-full appearance-none rounded-md border border-transparent bg-transparent pl-8 pr-7 text-sm font-semibold text-fg transition-colors hover:border-line focus:border-accent focus:outline-none"
      >
        {cities.map((c) => (
          <option key={c.slug} value={c.slug} className="bg-surface">
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-subtle" aria-hidden />
    </div>
  );
}

function AccountMenu() {
  const user = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return (
      <ButtonLink to={`/login?next=${next}`} variant="outline" size="sm" className="h-9">
        Sign in
      </ButtonLink>
    );
  }

  const isStaff = user.role === 'ADMIN' || user.role === 'CINEMA_MANAGER';
  const initials = user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted hover:bg-raised hover:text-fg focus:bg-raised focus:text-fg focus:outline-none';

  return (
    <div className="relative" ref={ref} onKeyDown={onMenuKey}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-md pl-1 pr-2 transition-colors hover:bg-elevated"
      >
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent" aria-hidden>
          {initials || <UserIcon className="size-3.5" />}
        </span>
        <span className="hidden max-w-[9rem] truncate text-sm font-semibold text-fg lg:block">{user.fullName.split(' ')[0]}</span>
        <span className="sr-only">Account menu for {user.fullName}</span>
        <ChevronDown className="size-3.5 text-subtle" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-60 animate-pop-in overflow-hidden rounded-lg border border-line-strong bg-elevated py-1 shadow-pop"
        >
          <div className="border-b border-line px-3 pb-2.5 pt-1.5" role="none">
            <p className="truncate text-sm font-semibold text-fg">{user.fullName}</p>
            <p className="truncate text-xs text-subtle">{user.email}</p>
          </div>
          <Link role="menuitem" to="/account" className={item} onClick={() => setOpen(false)}>
            <UserIcon className="size-4" aria-hidden /> My account
          </Link>
          <Link role="menuitem" to="/account/bookings" className={item} onClick={() => setOpen(false)}>
            <Ticket className="size-4" aria-hidden /> My bookings
          </Link>
          {isStaff && (
            <Link role="menuitem" to="/admin" className={item} onClick={() => setOpen(false)}>
              <LayoutDashboard className="size-4" aria-hidden /> Admin
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            className={cn(item, 'border-t border-line')}
            onClick={() => {
              setOpen(false);
              logout.mutate(undefined, {
                onSuccess: () => {
                  toast.success('You have signed out.');
                  navigate('/');
                },
                onError: (e) => toast.error(errorMessage(e)),
              });
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const user = useCurrentUser();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setDrawer(false), [location.pathname]);

  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative px-1 py-2 text-sm font-semibold transition-colors',
      isActive ? 'text-fg after:absolute after:inset-x-1 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent' : 'text-muted hover:text-fg',
    );

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-[background-color,border-color] duration-200',
        scrolled ? 'border-line bg-canvas/85 backdrop-blur-md' : 'border-transparent bg-canvas/60 backdrop-blur-sm',
      )}
    >
      <div className="container-page flex h-16 items-center gap-3 lg:gap-6">
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </Button>
        <Link to="/" className="shrink-0 rounded-sm" aria-label="Practice Project home">
          <Logo className="hidden sm:inline-flex" />
          <Logo compact className="sm:hidden" />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-5 lg:flex">
          {NAV_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={navCls}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <SearchBox className="ml-auto w-full max-w-xs flex-1 sm:max-w-sm" />
        <CitySelect className="hidden w-36 md:flex" />
        <div className="hidden sm:block">
          <AccountMenu />
        </div>
      </div>

      <Dialog open={drawer} onClose={() => setDrawer(false)} title="Menu" variant="drawer-left" size="md">
        <div className="flex flex-col gap-6">
          <nav aria-label="Mobile">
            <ul className="flex flex-col">
              {[{ to: '/', label: 'Home' }, ...NAV_LINKS, { to: '/bookings/find', label: 'Find a booking' }].map((l) => (
                <li key={l.to}>
                  <NavLink
                    to={l.to}
                    end={l.to === '/'}
                    className={({ isActive }) =>
                      cn('block rounded-md px-3 py-3 font-display text-xl', isActive ? 'bg-elevated text-accent' : 'text-fg hover:bg-elevated')
                    }
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="eyebrow mb-2 px-1">Your city</p>
            <CitySelect className="rounded-md border border-line" id="drawer-city" />
          </div>
          <div className="border-t border-line pt-5">
            {user ? (
              <div className="flex flex-col gap-1">
                <p className="px-3 pb-2 text-sm text-subtle">Signed in as {user.email}</p>
                <NavLink to="/account" className="rounded-md px-3 py-2.5 text-fg hover:bg-elevated">
                  My account
                </NavLink>
                <NavLink to="/account/bookings" className="rounded-md px-3 py-2.5 text-fg hover:bg-elevated">
                  My bookings
                </NavLink>
                {(user.role === 'ADMIN' || user.role === 'CINEMA_MANAGER') && (
                  <NavLink to="/admin" className="rounded-md px-3 py-2.5 text-fg hover:bg-elevated">
                    Admin
                  </NavLink>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <ButtonLink to="/login" className="flex-1">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/register" variant="secondary" className="flex-1">
                  Create account
                </ButtonLink>
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </header>
  );
}
