import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initSettings } from './settingsStore.ts';
import { loadStudy } from './studyStore.ts';
import './styles.css';

// Paint with cached settings (or Paper defaults) right away, then load the saved copy (T0.20).
void initSettings();
void loadStudy();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root is missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
