import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminPage from './pages/AdminPage';
import DemoPage from './pages/DemoPage';

const App: React.FC = () => {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>预决算报告智能生成系统</h1>
        <nav className="app-nav">
          <a href="/admin">管理端</a>
          <a href="/demo/ui">工作台演示</a>
        </nav>
      </header>
      <div className="container">
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/demo/ui" element={<DemoPage />} />
          <Route path="/" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
};

export default App;
