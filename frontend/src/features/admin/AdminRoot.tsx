import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  CreditCard,
  ExternalLink,
  FileText,
  Film,
  LayoutDashboard,
  Map,
  Megaphone,
  Menu,
  QrCode,
  ReceiptText,
  Settings,
  ShieldAlert,
  TicketPercent,
  Undo2,
  Users,
} from 'lucide-react';
import { useCurrentUser } from '@/features/auth/api';
import { Logo } from '@/app/Logo';
import { NotFoundPage } from '@/app/RouteError';
import { Button, ButtonLink, Dialog, PageLoader } from '@/components/ui';
import { useDocumentTitle } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import type { User } from '@/types/api';

type PageModule = { default: ComponentType };

interface AdminRouteDef {
  path: string;
  load: () => Promise<PageModule>;
  /** true: ADMIN and CINEMA_MANAGER. false: ADMIN only. */
  managers: boolean;
}

const routes: AdminRouteDef[] = [
  { path: '', load: () => import('./pages/DashboardPage'), managers: true },
  { path: 'movies', load: () => import('./pages/MoviesPage'), managers: false },
  { path: 'movies/new', load: () => import('./pages/MovieEditPage'), managers: false },
  { path: 'movies/:id', load: () => import('./pages/MovieEditPage'), managers: false },
  { path: 'cities', load: () => import('./pages/CitiesPage'), managers: false },
  { path: 'cinemas', load: () => import('./pages/CinemasPage'), managers: false },
  { path: 'cinemas/new', load: () => import('./pages/CinemaEditPage'), managers: false },
  { path: 'cinemas/:id', load: () => import('./pages/CinemaDetailPage'), managers: false },
  { path: 'cinemas/:id/edit', load: () => import('./pages/CinemaEditPage'), managers: false },
  { path: 'auditoriums/:id/layout', load: () => import('./pages/LayoutEditorPage'), managers: false },
  { path: 'showtimes', load: () => import('./pages/ShowtimesPage'), managers: true },
  { path: 'bookings', load: () => import('./pages/BookingsPage'), managers: true },
  { path: 'bookings/:reference', load: () => import('./pages/BookingDetailPage'), managers: true },
  { path: 'payments', load: () => import('./pages/PaymentsPage'), managers: false },
  { path: 'payments/:id', load: () => import('./pages/PaymentDetailPage'), managers: false },
  { path: 'refunds', load: () => import('./pages/RefundsPage'), managers: false },
  { path: 'billing', load: () => import('./pages/BillingPage'), managers: false },
  { path: 'billing/:number', load: () => import('./pages/BillingInvoicePage'), managers: false },
  { path: 'coupons', load: () => import('./pages/CouponsPage'), managers: false },
  { path: 'promotions', load: () => import('./pages/PromotionsPage'), managers: false },
  { path: 'users', load: () => import('./pages/UsersPage'), managers: false },
  { path: 'reports', load: () => import('./pages/ReportsPage'), managers: true },
  { path: 'settings', load: () => import('./pages/SettingsPage'), managers: false },
  { path: 'checkin', load: () => import('./pages/CheckinPage'), managers: true },
  { path: 'audit', load: () => import('./pages/AuditPage'), managers: false },
];

const lazyPages = new globalThis.Map<string, ComponentType>(routes.map((r) => [r.path, lazy(r.load)]));

const nav: { to: string; label: string; icon: typeof Film; managers: boolean; group: string }[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, managers: true, group: 'Overview' },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, managers: true, group: 'Overview' },
  { to: '/admin/showtimes', label: 'Showtimes', icon: CalendarClock, managers: true, group: 'Operations' },
  { to: '/admin/bookings', label: 'Bookings', icon: ReceiptText, managers: true, group: 'Operations' },
  { to: '/admin/checkin', label: 'Check-in', icon: QrCode, managers: true, group: 'Operations' },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard, managers: false, group: 'Finance' },
  { to: '/admin/refunds', label: 'Refunds', icon: Undo2, managers: false, group: 'Finance' },
  { to: '/admin/billing', label: 'Billing', icon: FileText, managers: false, group: 'Finance' },
  { to: '/admin/coupons', label: 'Coupons', icon: TicketPercent, managers: false, group: 'Marketing' },
  { to: '/admin/promotions', label: 'Promotions', icon: Megaphone, managers: false, group: 'Marketing' },
  { to: '/admin/movies', label: 'Movies', icon: Film, managers: false, group: 'Catalogue' },
  { to: '/admin/cinemas', label: 'Cinemas', icon: Building2, managers: false, group: 'Catalogue' },
  { to: '/admin/cities', label: 'Cities', icon: Map, managers: false, group: 'Catalogue' },
  { to: '/admin/users', label: 'Customers', icon: Users, managers: false, group: 'System' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, managers: false, group: 'System' },
  { to: '/admin/audit', label: 'Audit log', icon: ClipboardList, managers: false, group: 'System' },
];

export function isStaff(user: User | null): user is User {
  return user?.role === 'ADMIN' || user?.role === 'CINEMA_MANAGER';
}

function ForbiddenPage({ message }: { message?: string }) {
  useDocumentTitle('Access denied');
  return (
    <main id="main" className="grid min-h-[60vh] place-items-center px-4 py-16">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto mb-4 size-8 text-warning" aria-hidden />
        <p className="eyebrow">Error 403</p>
        <h1 className="mt-2 font-display text-3xl text-fg">You do not have access to this area</h1>
        <p className="mt-3 text-muted">{message ?? 'This section is available to administrators only.'}</p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink to="/admin" variant="secondary">
            Admin dashboard
          </ButtonLink>
          <ButtonLink to="/">Back to the site</ButtonLink>
        </div>
      </div>
    </main>
  );
}

function SidebarNav({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const items = nav.filter((n) => user.role === 'ADMIN' || n.managers);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="eyebrow mb-1.5 px-3 text-[10px]">{g}</p>
          <ul className="flex flex-col gap-0.5">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === '/admin'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated hover:text-fg',
                      )
                    }
                  >
                    <i.icon className="size-4 shrink-0" aria-hidden />
                    {i.label}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AdminLayout({ user, children }: { user: User; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="flex min-h-screen bg-canvas">
      <a href="#main" className="sr-only z-[70] rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-line px-4">
          <Link to="/admin" aria-label="Admin dashboard">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <SidebarNav user={user} />
        </div>
        <div className="border-t border-line p-3">
          <Link to="/" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-fg">
            <ExternalLink className="size-4" aria-hidden /> View site
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur-md lg:px-8">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open admin menu">
            <Menu className="size-4" aria-hidden />
          </Button>
          <span className="text-sm font-semibold text-fg lg:hidden">Admin</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-subtle sm:inline">{user.email}</span>
            <span className="rounded-xs border border-line-strong px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {user.role === 'ADMIN' ? 'Administrator' : 'Cinema manager'}
            </span>
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
      <Dialog open={drawer} onClose={() => setDrawer(false)} title="Admin" variant="drawer-left">
        <SidebarNav user={user} onNavigate={() => setDrawer(false)} />
        <Link to="/" className="mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-fg">
          <ExternalLink className="size-4" aria-hidden /> View site
        </Link>
      </Dialog>
    </div>
  );
}

/** Admin entry: guarded (ADMIN or CINEMA_MANAGER) and lazy-loaded as its own chunk. */
export default function AdminRoot() {
  const user = useCurrentUser();
  const location = useLocation();

  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (!isStaff(user)) {
    return (
      <div className="min-h-screen">
        <div className="container-page flex h-16 items-center">
          <Link to="/">
            <Logo />
          </Link>
        </div>
        <ForbiddenPage message="The admin area is for Practice Project staff. If you think you should have access, contact an administrator." />
      </div>
    );
  }

  return (
    <AdminLayout user={user}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {routes.map((r) => {
            const Page = lazyPages.get(r.path)!;
            const allowed = user.role === 'ADMIN' || r.managers;
            const element = allowed ? <Page /> : <ForbiddenPage />;
            return r.path === '' ? (
              <Route key="index" index element={element} />
            ) : (
              <Route key={r.path} path={r.path} element={element} />
            );
          })}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AdminLayout>
  );
}
