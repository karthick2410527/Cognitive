import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import { Home } from './pages/Home';
import { Start } from './pages/Start';
import { Session } from './pages/Session';
import { Report } from './pages/Report';
import { Probes } from './pages/Probes';
import { History } from './pages/History';
import { AuthPage } from './pages/Auth';
import { Admin } from './pages/admin/Admin';
import { applyDisplay, loadDisplay } from './store';

export default function App() {
  useEffect(() => applyDisplay(loadDisplay()), []);
  const guard = (el: JSX.Element) => <RequireAuth>{el}</RequireAuth>;
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/start" element={guard(<Start />)} />
        <Route path="/session/:id" element={guard(<Session />)} />
        <Route path="/session/:id/report" element={guard(<Report />)} />
        <Route path="/history" element={guard(<History />)} />
        <Route path="/probes" element={guard(<Probes />)} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}
