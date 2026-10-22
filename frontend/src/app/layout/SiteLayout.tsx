import { Link, Outlet } from 'react-router';
import { Mail } from 'lucide-react';
import { useConfig } from '@/features/config/api';
import { Logo } from '../Logo';
import { Header } from './Header';

function Footer() {
  const config = useConfig();
  const year = new Date().getFullYear();
  const groups = [
    {
      title: 'Discover',
      links: [
        { to: '/movies', label: 'Movies' },
        { to: '/movies?when=upcoming', label: 'Coming soon' },
        { to: '/cinemas', label: 'Cinemas' },
        { to: '/offers', label: 'Offers' },
      ],
    },
    {
      title: 'Your tickets',
      links: [
        { to: '/bookings/find', label: 'Find a booking' },
        { to: '/account/bookings', label: 'My bookings' },
        { to: '/account', label: 'Account' },
        { to: '/register', label: 'Become a member' },
      ],
    },
  ];
  return (
    <footer className="print-hide mt-24 border-t border-line bg-surface">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted">
            Choose your film, pick the perfect seats and be in them before the trailers roll.
          </p>
        </div>
        {groups.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <h2 className="eyebrow mb-3">{g.title}</h2>
            <ul className="space-y-2">
              {g.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-sm text-muted transition-colors hover:text-fg">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <div>
          <h2 className="eyebrow mb-3">Support</h2>
          <a href={`mailto:${config.supportEmail}`} className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-accent">
            <Mail className="size-4" aria-hidden />
            {config.supportEmail}
          </a>
          <p className="mt-3 text-xs text-subtle">
            Cancellations up to {config.cancellation.cutoffHours} hours before the show receive a {config.cancellation.refundPercent}% refund.
          </p>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Practice Project</p>
          <p className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            Practice project — not a real cinema. Showtimes and bookings are for demonstration only.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <Header />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
