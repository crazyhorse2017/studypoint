// Button and IconButton (DESIGN §5 "Actions"). At most one primary button per view (DESIGN §1.3).

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-sunken',
  ghost: 'bg-transparent text-text hover:bg-sunken',
  danger: 'bg-surface text-danger border border-danger hover:bg-sunken',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-sm',
  md: 'min-h-10 px-4 text-base',
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state; the button stays focusable and announces aria-busy. */
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = 'secondary', size = 'md', loading = false, type = 'button', className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={cx(
        'ds-target inline-flex items-center justify-center gap-2 rounded-md font-medium select-none',
        'transition-[background-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {loading ? <span aria-hidden="true" className="ds-spinner" /> : null}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label'> & {
  /** Required: icon-only buttons must have an accessible name (DESIGN §10). */
  label: string;
  icon: ReactNode;
};

export function IconButton({ label, icon, size = 'md', variant = 'ghost', className, ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cx(size === 'sm' ? 'w-8 px-0' : 'w-10 px-0', className)}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </Button>
  );
}
