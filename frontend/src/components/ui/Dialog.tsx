import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

let openCount = 0;

export type DialogVariant = 'center' | 'drawer-right' | 'drawer-left' | 'media';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: DialogVariant;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Visually hide the title (it remains the accessible name). */
  hideTitle?: boolean;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  /** Prevent closing while an action is in flight. */
  dismissible?: boolean;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/**
 * Accessible modal: portal, aria-modal, labelled by its title, focus moved in and trapped,
 * Esc to close, focus restored to the opener, page scroll locked.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'center',
  initialFocusRef,
  hideTitle,
  role = 'dialog',
  className,
  dismissible = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    openCount += 1;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const target = initialFocusRef?.current ?? (panel ? focusables(panel).find((el) => !el.dataset.dialogClose) : null) ?? panel;
    target?.focus();

    return () => {
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = prevOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, initialFocusRef]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (dismissibleRef.current) onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusables(panelRef.current);
    if (items.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  const isDrawer = variant === 'drawer-right' || variant === 'drawer-left';

  return createPortal(
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 animate-fade-in bg-black/75 backdrop-blur-[2px]"
        aria-hidden
        onClick={() => dismissible && onClose()}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex',
          variant === 'center' && 'items-end justify-center p-0 sm:items-center sm:p-6',
          variant === 'media' && 'items-center justify-center p-3 sm:p-8',
          variant === 'drawer-right' && 'justify-end',
          variant === 'drawer-left' && 'justify-start',
        )}
      >
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={cn(
            'pointer-events-auto relative flex max-h-full w-full flex-col overflow-hidden border border-line bg-surface shadow-pop outline-none',
            variant === 'center' && cn(sizes[size], 'animate-pop-in rounded-t-lg sm:rounded-lg max-h-[92vh]'),
            variant === 'media' && 'max-w-5xl animate-pop-in rounded-lg bg-black',
            isDrawer && cn('h-full animate-fade-in', size === 'xl' ? 'max-w-3xl' : size === 'lg' ? 'max-w-xl' : 'max-w-sm'),
            className,
          )}
        >
          <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', hideTitle && 'sr-only')}>
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-xl leading-tight text-fg">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1.5 text-sm text-muted">
                  {description}
                </div>
              )}
            </div>
            {dismissible && !hideTitle && (
              <button
                type="button"
                data-dialog-close="true"
                onClick={onClose}
                className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-sm text-subtle transition-colors hover:bg-elevated hover:text-fg"
                aria-label="Close"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {hideTitle && dismissible && (
            <button
              type="button"
              data-dialog-close="true"
              onClick={onClose}
              className="absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-sm bg-black/60 text-fg transition-colors hover:bg-black"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
          {children !== undefined && <div className={cn('min-h-0 flex-1 overflow-y-auto', variant === 'media' ? '' : 'px-5 py-4')}>{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 pb-safe sm:pb-3.5">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
