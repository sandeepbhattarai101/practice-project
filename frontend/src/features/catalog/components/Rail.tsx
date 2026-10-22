import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function SectionHeading({
  title,
  eyebrow,
  action,
  id,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: { to: string; label: string };
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h2 id={id} className="font-display text-2xl text-fg sm:text-[1.75rem]">
          {title}
        </h2>
      </div>
      {action && (
        <Link to={action.to} className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-accent">
          {action.label}
          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** Horizontally scrolling row with optional arrow buttons (desktop). Items keep a fixed width. */
export function Rail({ children, label, itemClassName = 'w-[42vw] sm:w-[200px] lg:w-[210px]' }: { children: ReactNode[]; label: string; itemClassName?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children.length]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  const arrow =
    'absolute top-[38%] z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-canvas/90 text-fg shadow-pop backdrop-blur transition-opacity duration-200 hover:border-accent hover:text-accent md:grid disabled:pointer-events-none disabled:opacity-0';

  return (
    <div className="relative">
      <button type="button" className={cn(arrow, '-left-4')} onClick={() => scroll(-1)} disabled={edges.start} aria-label={`Scroll ${label} left`}>
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      <ul
        ref={ref}
        onScroll={update}
        aria-label={label}
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0"
      >
        {children.map((child, i) => (
          <li key={i} className={cn('shrink-0 snap-start', itemClassName)}>
            {child}
          </li>
        ))}
      </ul>
      <button type="button" className={cn(arrow, '-right-4')} onClick={() => scroll(1)} disabled={edges.end} aria-label={`Scroll ${label} right`}>
        <ChevronRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}
