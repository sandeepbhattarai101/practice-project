import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Search, X } from 'lucide-react';
import { useMovieSuggestions } from '@/features/catalog/api';
import { useCity } from '@/app/city';
import { useDebouncedValue } from '@/lib/hooks';
import { formatCalendarDate } from '@/lib/dates';
import { Img } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Header search: an ARIA 1.2 combobox with a debounced suggestion listbox.
 * Arrow keys move, Enter opens the highlighted movie (or searches /movies?q=), Esc closes.
 */
export function SearchBox({ className, onNavigate, autoFocus }: { className?: string; onNavigate?: () => void; autoFocus?: boolean }) {
  const { city } = useCity();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(value.trim(), 220);
  const { data: suggestions = [], isFetching, isError } = useMovieSuggestions(debounced, city.slug);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const showList = open && debounced.length >= 2;
  const items = debounced.length >= 2 ? suggestions : [];

  const go = (path: string) => {
    setOpen(false);
    setActive(-1);
    setValue('');
    inputRef.current?.blur();
    onNavigate?.();
    navigate(path);
  };

  const submit = () => {
    if (active >= 0 && items[active]) go(`/movies/${items[active].slug}`);
    else if (value.trim()) go(`/movies?when=all&q=${encodeURIComponent(value.trim())}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      } else setValue('');
    }
  };

  return (
    <div className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search movies
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && items[active] ? `${listId}-opt-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Search movies"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-md border border-line bg-surface/80 pl-9 pr-9 text-sm text-fg placeholder:text-subtle transition-colors hover:border-line-strong focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-xs text-subtle hover:text-fg"
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </form>
      <div
        className={cn(
          'absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-line-strong bg-elevated shadow-pop',
          !showList && 'hidden',
        )}
      >
        <ul id={listId} role="listbox" aria-label="Movie suggestions" className="max-h-[60vh] overflow-y-auto py-1">
          {items.map((s, i) => (
            <li
              key={s.slug}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(`/movies/${s.slug}`)}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-3 px-3 py-2', i === active && 'bg-raised')}
            >
              <Img src={s.posterUrl} alt="" className="w-8 shrink-0 rounded-xs" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-fg">{s.title}</span>
                <span className="block truncate text-xs text-subtle">
                  {[formatCalendarDate(s.releaseDate), s.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm text-subtle" role="status">
            {isError ? 'Suggestions are unavailable right now.' : isFetching ? 'Searching…' : 'No matching movies. Press Enter to search the catalogue.'}
          </p>
        )}
      </div>
    </div>
  );
}
