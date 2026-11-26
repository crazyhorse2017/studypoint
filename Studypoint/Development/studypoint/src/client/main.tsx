import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { DEFAULT_STYLE, applyAppearance } from './theme.ts';
import './styles.css';

// Defaults until settings load from the API (T0.20). Paper is the default style (DESIGN §2.8).
applyAppearance(DEFAULT_STYLE, 'system');

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root is missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
