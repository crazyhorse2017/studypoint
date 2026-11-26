// Internal link: a real <a href> (so open-in-new-tab, copy link and screen readers work) that the
// router handles on plain left-clicks.

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate, shouldInterceptClick } from './router.ts';

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, target, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (shouldInterceptClick(e, target ?? null, to, window.location.origin)) {
      e.preventDefault();
      navigate(to);
    }
  };
  return <a {...rest} href={to} target={target} onClick={handle} />;
}
