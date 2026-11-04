import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Spinner from '@cloudscape-design/components/spinner';
import HomePage from './pages/HomePage';
import CallbackPage from './pages/CallbackPage';

const OrganizerPage = lazy(() => import('./pages/OrganizerPage'));

export default function App() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner size="large" /></div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/organizer" element={<OrganizerPage />} />
        <Route path="/callback" element={<CallbackPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Suspense>
  );
}
