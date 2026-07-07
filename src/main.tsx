import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CrittersPage } from './CrittersPage';
import { PrivacyPage } from './PrivacyPage';
import { TermsPage } from './TermsPage';
import { SubscribePage } from './SubscribePage';
import { SpendPage } from './SpendPage';
import './index.css';

// Tiny path-based router — a handful of pages, no router dependency. Vercel
// rewrites every non-/api path to index.html (see vercel.json), so these all load
// this bundle and we pick the page from the URL.
const path = window.location.pathname.replace(/\/+$/, '');
const Page =
  path === '/critters'
    ? CrittersPage
    : path === '/alerts'
      ? SubscribePage
      : path === '/spend'
        ? SpendPage
        : path === '/privacy'
          ? PrivacyPage
          : path === '/terms'
            ? TermsPage
            : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
