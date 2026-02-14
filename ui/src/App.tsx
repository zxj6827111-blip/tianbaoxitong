import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { WorkbenchPage } from './pages/WorkbenchPage';
import AdminPage from './pages/AdminPage';
import AdminUnitDetailPage from './pages/AdminUnitDetailPage';
import DemoPage from './pages/DemoPage';
import { Loading } from './components/ui/Loading';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <Loading fullScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <Loading fullScreen />;
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/workbench" replace /> : <LoginPage />} />
      <Route
        path="/workbench"
        element={
          <ProtectedRoute>
            <WorkbenchPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/unit/:unitId"
        element={
          <ProtectedRoute>
            <AdminUnitDetailPage />
          </ProtectedRoute>
        }
      />
      <Route path="/demo/ui" element={<DemoPage />} />
      <Route path="/" element={<Navigate to={isAuthenticated ? "/workbench" : "/login"} replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
};

export default App;
