import React from "react";
import { Routes, Route } from "react-router-dom";
import { RequireAuth } from "./components/RequireAuth";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import ItemsPage from "./pages/ItemsPage";
import ItemsMasterPage from "./pages/ItemsMasterPage";
import RevenuePage from "./pages/RevenuePage";
import InvoicesPage from "./pages/InvoicesPage";
import PartnersPage from "./pages/PartnersPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import MachinesPage from "./pages/MachinesPage";
import MachineStocksPage from "./pages/MachineStocksPage";
import StockCountListPage from "./pages/StockCountListPage";
import StockCountDetailPage from "./pages/StockCountDetailPage";
import StockOpeningImportPage from "./pages/StockOpeningImportPage";
import PartStocksPage from "./pages/PartStocksPage";
import UserManagementPage from "./pages/UserManagementPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<PartStocksPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="items-master" element={<ItemsMasterPage />} />
        <Route path="revenue" element={<RevenuePage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="change-password" element={<ChangePasswordPage />} />
        <Route path="machines" element={<MachinesPage/>} />
        <Route path="machine-stocks" element={<MachineStocksPage />} />
        <Route path="/stock-counts" element={<StockCountListPage />} />
        <Route path="/stock-counts/:id" element={<StockCountDetailPage />} />
        <Route path="stock-import-opening" element={<StockOpeningImportPage />} />
        <Route path="part-stocks" element={<PartStocksPage />} />
        <Route path="/users" element={<UserManagementPage />} />
        <Route path="partners/:id" element={<CustomerDetailPage />} />
      </Route>

      <Route path="*" element={<div className="p-4">404 Not Found</div>} />
    </Routes>
  );
};

export default App;
