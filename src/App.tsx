import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './lib/store';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import Settings from './pages/Settings';
import Presets from './pages/Presets';
import AccountSettings from './pages/AccountSettings';
import Sidebar from './components/Sidebar';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div className="titlebar" />
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
        <Route path="/locations" element={<ProtectedRoute><AppLayout><Servers /></AppLayout></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><AppLayout><Settings /></AppLayout></ProtectedRoute>} />
        <Route path="/settings/apps" element={<ProtectedRoute><AppLayout><Presets /></AppLayout></ProtectedRoute>} />
        <Route path="/settings/account" element={<ProtectedRoute><AppLayout><AccountSettings /></AppLayout></ProtectedRoute>} />
        {/* Legacy redirects */}
        <Route path="/servers" element={<Navigate to="/locations" replace />} />
        <Route path="/presets" element={<Navigate to="/settings/apps" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
