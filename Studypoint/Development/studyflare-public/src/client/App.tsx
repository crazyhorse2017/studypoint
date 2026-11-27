// App routes (T0.19). The app ships blank (LIB-12): no courses, subjects or sample content, ever.

import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { PlanStatus } from './plans/PlanStatus.tsx';
import { ToastProvider } from './ds/index.ts';
import { matchPath, useFocusMainHeading, useLocation } from './router.ts';
import { AppShell } from './shell/AppShell.tsx';
import { ComingSoonPage, NotFoundPage, TodayPage } from './pages/TodayPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { LibraryPage } from './pages/LibraryPage.tsx';
import { GettingStartedPage } from './pages/GettingStartedPage.tsx';

// Gallery: dev/preview only. Vite replaces import.meta.env at build time, so in production this is
// `false && …` and the gallery chunk is never built (checked in CI).
const SHOW_GALLERY = import.meta.env.DEV || import.meta.env.VITE_DS_GALLERY === 'true';
const GalleryPage = SHOW_GALLERY ? lazy(() => import('./pages/GalleryPage.tsx')) : null;

// The note editor is the biggest chunk (Tiptap + KaTeX), so it loads only when a note is opened.
const NotePage = lazy(() => import('./notes/NotePage.tsx'));
// The Reader brings pdf.js and the unzipper, so it also loads only when a file is opened.
const ReaderPage = lazy(() => import('./reader/ReaderPage.tsx'));
// Course pages and reviews bring KaTeX and the scheduler.
const CoursePage = lazy(() => import('./courses/CoursePage.tsx'));
const ReviewPage = lazy(() => import('./cards/ReviewPage.tsx'));
const QuizPage = lazy(() => import('./quizzes/QuizPage.tsx'));
const AssistantPage = lazy(() => import('./ai/AssistantPage.tsx'));

type RouteDef = { path: string; render: (params: Record<string, string>) => ReactNode };

const ROUTES: readonly RouteDef[] = [
  { path: '/', render: () => <TodayPage /> },
  { path: '/setup', render: () => <GettingStartedPage /> },
  { path: '/library', render: () => <LibraryPage /> },
  { path: '/courses/:id', render: (p) => <CoursePage id={p['id'] ?? ''} /> },
  { path: '/notes/:id', render: (p) => <NotePage id={p['id'] ?? ''} /> },
  { path: '/files/:id', render: (p) => <ReaderPage id={p['id'] ?? ''} /> },
  { path: '/review', render: () => <ReviewPage /> },
  { path: '/quizzes/:id', render: (p) => <QuizPage id={p['id'] ?? ''} /> },
  { path: '/assistant', render: () => <AssistantPage /> },
  { path: '/settings', render: () => <SettingsPage /> },
  ...(GalleryPage ? [{ path: '/ds', render: () => <GalleryPage /> }] : []),
];

export function App() {
  const { pathname } = useLocation();
  useFocusMainHeading(pathname);
  // Step 6b: study-plan work runs in the background while unlocked (loaded after first paint).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void import('./plans/planRunner.ts').then((m) => {
        if (!cancelled) stop = m.startPlanRunner();
      });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      stop?.();
    };
  }, []);
  const hit = ROUTES.map((r) => ({ r, params: matchPath(r.path, pathname) })).find((m) => m.params !== null);

  return (
    <ToastProvider>
      <AppShell pathname={pathname}>
        <Suspense fallback={<p className="text-text-2">Loading…</p>}>{hit ? hit.r.render(hit.params ?? {}) : <NotFoundPage />}</Suspense>
        <PlanStatus />
      </AppShell>
    </ToastProvider>
  );
}
