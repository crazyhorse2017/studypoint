import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { api } from './api.ts';
import { SetupPage, type SetupStatus } from './pages/SetupPage.tsx';
import { VaultGate } from './pages/VaultPages.tsx';
import { ToastProvider } from './ds/index.ts';
import { initSettings } from './settingsStore.ts';
import { loadStudy } from './studyStore.ts';
import './styles.css';

// Paint with cached settings (or Paper defaults) right away (T0.20).
void initSettings();

/**
 * A fresh one-click deploy has no sign-in yet (AUTH-07): show first-run setup instead of the app.
 * If the check itself fails, fall through to the app, which shows its own errors.
 */
function Root() {
  const [setup, setSetup] = useState<SetupStatus | null | 'checking'>('checking');
  useEffect(() => {
    api<SetupStatus>('GET', '/api/setup')
      .then((s) => setSetup(s.needed ? s : null))
      .catch(() => setSetup(null));
  }, []);
  useEffect(() => {
    if (setup === null) void loadStudy();
  }, [setup]);
  if (setup === 'checking') return null;
  if (setup) return <SetupPage status={setup} />;
  // AUTH-08: nothing behind the lock renders until the vault is unlocked.
  return (
    <ToastProvider>
      <VaultGate>
        <App />
      </VaultGate>
    </ToastProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root is missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
