import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/**
 * Tab list with roving focus (arrow keys, Home/End). The caller renders the panel and
 * should give it `id={`${idBase}-panel`}` and `role="tabpanel"` with aria-labelledby the active tab id.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
  variant = 'underline',
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  idBase: string;
  className?: string;
  variant?: 'underline' | 'pill';
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].value);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex gap-1 overflow-x-auto scrollbar-none',
        variant === 'underline' && 'border-b border-line',
        variant === 'pill' && 'rounded-md bg-surface p-1 border border-line w-fit max-w-full',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={`${idBase}-tab-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idBase}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors duration-150',
              variant === 'underline' &&
                cn(
                  'px-3 pb-3 pt-1 after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors',
                  selected ? 'text-fg after:bg-accent' : 'text-subtle hover:text-fg after:bg-transparent',
                ),
              variant === 'pill' &&
                cn('h-8 rounded-sm px-3', selected ? 'bg-raised text-fg' : 'text-subtle hover:text-fg'),
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="rounded-xs bg-elevated px-1.5 text-[11px] font-semibold text-muted">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
