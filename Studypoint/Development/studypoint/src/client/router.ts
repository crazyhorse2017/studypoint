// Small client-side router (ARCHITECTURE A12b): History API navigation and React hooks.
// The pure matching helpers are in routeMatch.ts.

import { useEffect, useSyncExternalStore } from 'react';

export { buildPath, isActive, matchPath, shouldInterceptClick } from './routeMatch.ts';
export type { RouteParams } from './routeMatch.ts';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  emit();
}

export type LocationState = { pathname: string; search: URLSearchParams };

export function useLocation(): LocationState {
  const loc = useSyncExternalStore(subscribe, snapshot, () => '/');
  const url = new URL(loc, 'http://local');
  return { pathname: url.pathname, search: url.searchParams };
}

/** After each navigation, move focus to the page's h1 so screen readers announce the new page (DESIGN §8). */
export function useFocusMainHeading(pathname: string): void {
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (!h1) return;
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: false });
  }, [pathname]);
}
