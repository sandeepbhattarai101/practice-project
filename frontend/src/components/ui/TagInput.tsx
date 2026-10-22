import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { controlClasses } from './Field';

/** Free-text tag entry: Enter or comma adds, Backspace on empty removes the last, × removes one. */
export function TagInput({
  id,
  value,
  onChange,
  placeholder = 'Type and press Enter',
  suggestions = [],
  describedBy,
  invalid,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  describedBy?: string;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const listId = id ? `${id}-suggestions` : undefined;

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (!value.some((v) => v.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className={cn(controlClasses, 'flex min-h-10 flex-wrap items-center gap-1.5 px-2 py-1.5 focus-within:border-accent')} aria-invalid={invalid || undefined}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-xs bg-raised px-2 py-0.5 text-xs font-medium text-fg">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== tag))}
            className="text-subtle hover:text-fg"
            aria-label={`Remove ${tag}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        list={listId}
        aria-describedby={describedBy}
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-fg placeholder:text-subtle outline-none"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}
