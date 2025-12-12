import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { CustomThemeProvider } from "./contexts/ThemeContext";
import { useRealtimeUpdates } from "./hooks/useRealtimeUpdates";
import Layout from "./components/Layout/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import Inventory from "./pages/Inventory";
import Transactions from "./pages/Transactions";
import Barcodes from "./pages/Barcodes";
import BarcodeScanner from "./pages/BarcodeScanner";
import Alerts from "./pages/Alerts";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Reconciliation from "./pages/Reconciliation";
import LoadingSpinner from "./components/Common/LoadingSpinner";

function App() {
  const { user, loading } = useAuth();

  // Enable real-time updates
  useRealtimeUpdates();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <CustomThemeProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/barcodes" element={<Barcodes />} />
          <Route path="/scanner" element={<BarcodeScanner />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    </CustomThemeProvider>
  );
}

export default App;
