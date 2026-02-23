import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Loading } from './components/ui/Loading';

const LoginPage = React.lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const WorkbenchPage = React.lazy(() => import('./pages/WorkbenchPage').then((module) => ({ default: module.WorkbenchPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const AdminUnitDetailPage = React.lazy(() => import('./pages/AdminUnitDetailPage'));
const DemoPage = React.lazy(() => import('./pages/DemoPage'));

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
    <Suspense fallback={<Loading fullScreen />}>
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
    </Suspense>
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
