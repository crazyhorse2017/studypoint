// App shell (T0.19, DESIGN §3): skip link, top bar with primary navigation, a courses sidebar on wide
// screens, and a bottom nav on phones. The sidebar lists Alex's own courses (never pre-filled, LIB-12).

import type { ReactNode } from 'react';
import { cx } from '../ds/cx.ts';
import { Link } from '../Link.tsx';
import { isActive } from '../../shared/routeMatch.ts';
import { useStudy } from '../studyStore.ts';

function SidebarCourses() {
  const { courses } = useStudy();
  const active = courses.filter((c) => !c.archived);
  if (active.length === 0) return <p className="text-sm text-text-2">Courses you add appear here.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {active.map((c) => (
        <li key={c.id}>
          <Link to="/library" className="flex flex-col rounded-md px-2 py-1.5 hover:bg-sunken">
            {c.code ? <span className="font-mono text-xs text-text-3">{c.code}</span> : null}
            <span className="text-sm text-text">{c.title ?? c.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export type NavItem = { to: string; label: string; icon: ReactNode };

const icon = (d: string) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const NAV: readonly NavItem[] = [
  { to: '/', label: 'Today', icon: icon('M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z') },
  { to: '/library', label: 'Library', icon: icon('M5 4h4v16H5zM10 4h4v16h-4zM15.5 4.5l3.5 1-4 15-3.5-1') },
  { to: '/review', label: 'Review', icon: icon('M4 6h16v12H4zM8 10h8M8 14h5') },
  { to: '/assistant', label: 'Ask', icon: icon('M4 5h16v11H9l-5 4z') },
  { to: '/settings', label: 'Settings', icon: icon('M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z') },
];

export function AppShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page text-text">
      <a href="#main" className="skip-link rounded-md bg-accent px-3 py-2 text-on-accent">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-page/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-text">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5z" strokeLinejoin="round" />
              <path d="M12 6v13.5" />
            </svg>
            Studypoint
          </Link>
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={isActive(item.to, pathname) ? 'page' : undefined}
                    className={cx(
                      'ds-target inline-flex min-h-9 items-center rounded-md px-3 text-sm',
                      isActive(item.to, pathname) ? 'bg-accent-bg font-semibold text-chip-text' : 'text-text-2 hover:bg-sunken hover:text-text',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        <aside aria-label="Courses" className="hidden w-[264px] shrink-0 border-r border-border px-4 py-6 xl:block">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-text-3 uppercase">Courses</h2>
          <SidebarCourses />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pt-8 pb-24 sm:px-8 md:pb-12">
          {children}
        </main>
      </div>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:hidden">
        <ul className="grid grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={isActive(item.to, pathname) ? 'page' : undefined}
                className={cx(
                  'ds-target flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
                  isActive(item.to, pathname) ? 'font-semibold text-accent' : 'text-text-2',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
