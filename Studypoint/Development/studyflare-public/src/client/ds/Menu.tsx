// Menu button (APG menu button + menu; DESIGN §5). Focus moves into the menu; arrows, Home/End and
// type-ahead move between items; Enter/Space activate; Escape closes and returns focus to the button.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { nextIndex, typeaheadIndex } from './keys.ts';

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean };

export type MenuProps = {
  /** Visible button content (text, or an icon plus `buttonLabel`). */
  trigger: ReactNode;
  /** Accessible name when the trigger is an icon. */
  buttonLabel?: string;
  items: readonly MenuItem[];
  align?: 'start' | 'end';
};

export function Menu({ trigger, buttonLabel, items, align = 'start' }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const disabled = items.map((i) => !!i.disabled);

  const openAt = (index: number | null) => {
    setActive(index ?? 0);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const activate = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    close(true);
    item.onSelect();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt(nextIndex('Home', -1, items.length, { disabled }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(nextIndex('End', -1, items.length, { disabled }));
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(active);
      return;
    }
    const next = nextIndex(e.key, active, items.length, { disabled });
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      return;
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const hit = typeaheadIndex(e.key, items.map((i) => i.label), active, disabled);
      if (hit !== null) setActive(hit);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={buttonLabel}
        onClick={() => (open ? close(false) : openAt(nextIndex('Home', -1, items.length, { disabled })))}
        onKeyDown={onButtonKey}
        className="ds-target inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-text hover:bg-sunken"
      >
        {trigger}
      </button>
      <div
        id={`${id}-menu`}
        role="menu"
        aria-labelledby={`${id}-button`}
        hidden={!open}
        onKeyDown={onMenuKey}
        className={cx(
          'absolute top-full z-30 mt-1 min-w-48 rounded-md border border-border bg-surface py-1 shadow-pop',
          align === 'end' ? 'right-0' : 'left-0',
        )}
      >
        {items.map((item, i) => (
          <div
            key={item.label}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            onClick={() => activate(i)}
            onMouseEnter={() => !item.disabled && setActive(i)}
            className={cx(
              'flex min-h-9 cursor-pointer items-center px-3 outline-none',
              i === active && 'bg-sunken',
              item.destructive ? 'text-danger' : 'text-text',
              item.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
