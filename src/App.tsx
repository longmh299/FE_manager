// @ts-nocheck
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
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
import InvoicePrintPage from "./pages/InvoicePrintPage";
import InvoiceDetailPage from "./pages/InvoiceDetailPage";
import ReceivablesReport from "./pages/ReceivablesReportPage";
import SalesReturnsPage from "./pages/SalesReturnsPage";
import SalesReturnFormPage from "./pages/SalesReturnFormPage";
import LedgerPage from "./pages/LedgerPage";
import SalesLedgerReportPage from "./pages/SalesLedgerReportPage";
import PaymentAccountsPage from "./pages/PaymentAccountsPage";
import MySalesDashboardPage from "./pages/MySalesDashboardPage";
import AuditLogsPage from "./pages/AuditLogsPage";

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
        <Route index element={<Navigate to="/part-stocks" replace />} />

        {/* master */}
        <Route path="items" element={<ItemsPage />} />
        <Route path="items-master" element={<ItemsMasterPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="partners/:id" element={<CustomerDetailPage />} />

        {/* invoices */}
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/new" element={<InvoiceDetailPage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />

        {/* returns */}
        <Route path="sales-returns" element={<SalesReturnsPage />} />
        <Route path="sales-returns/new" element={<SalesReturnFormPage />} />
        <Route path="sales-returns/:id" element={<SalesReturnFormPage />} />

        {/* stocks */}
        <Route path="part-stocks" element={<PartStocksPage />} />
        <Route path="stock-counts" element={<StockCountListPage />} />
        <Route path="stock-counts/:id" element={<StockCountDetailPage />} />
        <Route path="stock-import-opening" element={<StockOpeningImportPage />} />

        {/* machines */}
        <Route path="machines" element={<MachinesPage />} />
        <Route path="machine-stocks" element={<MachineStocksPage />} />

        {/* users */}
        <Route path="users" element={<UserManagementPage />} />
        <Route path="change-password" element={<ChangePasswordPage />} />

        {/* reports */}
        <Route path="revenue" element={<RevenuePage />} />
        <Route path="debts/by-sale" element={<ReceivablesReport />} />
        <Route path="reports/ledger" element={<LedgerPage />} />
        <Route path="reports/sales-ledger" element={<SalesLedgerReportPage />} />
        <Route path="payment-accounts" element={<PaymentAccountsPage />}/>
        <Route path="/me/sales" element={<MySalesDashboardPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
      </Route>
      <Route path="invoices/:id/print" element={<InvoicePrintPage />} />
      <Route path="*" element={<div className="p-4">404 Not Found</div>} />
    </Routes>
  );
};

export default App;
