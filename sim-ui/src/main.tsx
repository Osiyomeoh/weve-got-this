import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Hero from './pages/Hero';
import Console from './pages/Console';
import TVBoard from './pages/TVBoard';
import AmbientTV from './pages/AmbientTV';
import Setup from './pages/Setup';
// The 3D world brings three.js with it; nobody else should have to download that.
const World = lazy(() => import('./pages/World'));

const router = createBrowserRouter([
  { path: '/', element: <Hero /> },
  { path: '/console', element: <Console /> },
  // /tv is the Fire TV surface: an ambient TV screen with notifications.
  // /board keeps the full dashboard for close-up (browser/judge) viewing.
  { path: '/tv', element: <AmbientTV /> },
  { path: '/board', element: <TVBoard /> },
  // First-run onboarding a judge can watch (drives the real setup tools).
  { path: '/setup', element: <Setup /> },
  // One family's day as a 3D street, played on the real server. Pick who you are.
  { path: '/world', element: <Suspense fallback={<div className="world" />}><World /></Suspense> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
