import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, TicketPercent } from 'lucide-react';
import { toast } from 'sonner';
import type { Promotion } from '@/types/api';
import { Img, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';

export function CouponCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`Code ${code} copied — apply it at checkout.`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Could not copy automatically. Your code is ${code}.`);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="group inline-flex items-center gap-2 rounded-sm border border-dashed border-accent/60 bg-accent-soft px-3 py-1.5 font-mono text-sm font-bold tracking-wider text-accent transition-colors hover:border-accent"
      aria-label={`Copy coupon code ${code}`}
    >
      {code}
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5 opacity-70 group-hover:opacity-100" aria-hidden />}
    </button>
  );
}

function isInternal(url: string) {
  return url.startsWith('/') && !url.startsWith('//');
}

export function PromotionCard({ promotion, className }: { promotion: Promotion; className?: string }) {
  const cta =
    promotion.ctaUrl && promotion.ctaLabel ? (
      isInternal(promotion.ctaUrl) ? (
        <Link to={promotion.ctaUrl} className="text-sm font-semibold text-fg underline-offset-4 hover:text-accent hover:underline">
          {promotion.ctaLabel}
        </Link>
      ) : (
        <a href={promotion.ctaUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-fg underline-offset-4 hover:text-accent hover:underline">
          {promotion.ctaLabel}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )
    ) : null;

  return (
    <article className={cn('relative flex h-full overflow-hidden rounded-lg border border-line bg-surface', className)}>
      {promotion.imageUrl ? (
        <Img src={promotion.imageUrl} alt="" ratio="none" className="hidden w-40 shrink-0 sm:block" />
      ) : (
        <div className="hidden w-28 shrink-0 place-items-center bg-[radial-gradient(circle_at_30%_30%,rgb(245_181_68/0.2),transparent_70%)] sm:grid" aria-hidden>
          <TicketPercent className="size-8 text-accent" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="font-display text-lg leading-snug text-fg">{promotion.title}</h3>
        {promotion.subtitle && <p className="text-sm text-muted">{promotion.subtitle}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
          {promotion.couponCode && <CouponCode code={promotion.couponCode} />}
          {cta}
        </div>
      </div>
    </article>
  );
}

export function PromotionCardSkeleton() {
  return <Skeleton className="h-40 w-full rounded-lg" />;
}
