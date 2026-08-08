import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './App';
import { SettingsPage } from './pages/SettingsPage';
import { CreatePage } from './pages/CreatePage';
import { TrackPage } from './pages/TrackPage';
import { CancelPage } from './pages/CancelPage';
import { BulkPage } from './pages/BulkPage';
import { BatchPage } from './pages/BatchPage';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<SettingsPage />} />
          <Route path="create" element={<CreatePage />} />
          <Route path="track" element={<TrackPage />} />
          <Route path="cancel" element={<CancelPage />} />
          <Route path="bulk" element={<BulkPage />} />
          <Route path="batch" element={<BatchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
