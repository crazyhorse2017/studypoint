// App routes (T0.19). The app ships blank (LIB-12): no courses, subjects or sample content, ever.

import { lazy, Suspense, type ReactNode } from 'react';
import { ToastProvider } from './ds/index.ts';
import { matchPath, useFocusMainHeading, useLocation } from './router.ts';
import { AppShell } from './shell/AppShell.tsx';
import { ComingSoonPage, NotFoundPage, TodayPage } from './pages/TodayPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { LibraryPage } from './pages/LibraryPage.tsx';

// Gallery: dev/preview only. Vite replaces import.meta.env at build time, so in production this is
// `false && …` and the gallery chunk is never built (checked in CI).
const SHOW_GALLERY = import.meta.env.DEV || import.meta.env.VITE_DS_GALLERY === 'true';
const GalleryPage = SHOW_GALLERY ? lazy(() => import('./pages/GalleryPage.tsx')) : null;

// The note editor is the biggest chunk (Tiptap + KaTeX), so it loads only when a note is opened.
const NotePage = lazy(() => import('./notes/NotePage.tsx'));
// The Reader brings pdf.js and the unzipper, so it also loads only when a file is opened.
const ReaderPage = lazy(() => import('./reader/ReaderPage.tsx'));

type RouteDef = { path: string; render: (params: Record<string, string>) => ReactNode };

const ROUTES: readonly RouteDef[] = [
  { path: '/', render: () => <TodayPage /> },
  { path: '/library', render: () => <LibraryPage /> },
  { path: '/notes/:id', render: (p) => <NotePage id={p['id'] ?? ''} /> },
  { path: '/files/:id', render: (p) => <ReaderPage id={p['id'] ?? ''} /> },
  { path: '/review', render: () => <ComingSoonPage title="Review" what="Flashcard reviews, scheduled with FSRS, arrive in the next phase." /> },
  { path: '/assistant', render: () => <ComingSoonPage title="Ask" what="The study assistant, which answers from your own sources with citations, arrives in the next phase." /> },
  { path: '/settings', render: () => <SettingsPage /> },
  ...(GalleryPage ? [{ path: '/ds', render: () => <GalleryPage /> }] : []),
];

export function App() {
  const { pathname } = useLocation();
  useFocusMainHeading(pathname);
  const hit = ROUTES.map((r) => ({ r, params: matchPath(r.path, pathname) })).find((m) => m.params !== null);

  return (
    <ToastProvider>
      <AppShell pathname={pathname}>
        <Suspense fallback={<p className="text-text-2">Loading…</p>}>{hit ? hit.r.render(hit.params ?? {}) : <NotFoundPage />}</Suspense>
      </AppShell>
    </ToastProvider>
  );
}
