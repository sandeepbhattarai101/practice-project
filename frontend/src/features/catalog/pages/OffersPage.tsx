import { TicketPercent } from 'lucide-react';
import { usePromotions } from '../api';
import { ButtonLink, EmptyState, ErrorState } from '@/components/ui';
import { PromotionCard, PromotionCardSkeleton } from '../components/PromotionCard';
import { useDocumentTitle } from '@/lib/hooks';

export default function OffersPage() {
  const promotions = usePromotions();
  useDocumentTitle('Offers');
  return (
    <main id="main" className="container-page pt-10">
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow mb-2">Save on your next visit</p>
        <h1 className="font-display text-4xl text-fg sm:text-5xl">Offers</h1>
        <p className="mt-3 text-muted">Copy a code and apply it at checkout. Each offer's terms are checked when you apply it.</p>
      </header>
      {promotions.error ? (
        <ErrorState error={promotions.error} onRetry={() => promotions.refetch()} retrying={promotions.isFetching} />
      ) : promotions.isPending ? (
        <div className="grid gap-5 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <PromotionCardSkeleton key={i} />)}</div>
      ) : promotions.data.length === 0 ? (
        <EmptyState
          icon={<TicketPercent className="size-5" />}
          title="No offers right now"
          description="New offers appear here first. Members can opt in to hear about them by email."
          action={<ButtonLink to="/movies" variant="secondary" size="sm">Browse movies</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-5 md:grid-cols-2">
          {promotions.data.map((p) => <li key={p.id}><PromotionCard promotion={p} /></li>)}
        </ul>
      )}
    </main>
  );
}
