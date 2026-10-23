import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import './lib/i18n';
import { AppLayout, AuthLayout } from './components/Layout';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/auth';
import { AcceptInvitePage } from './pages/AcceptInvite';
import { StaffPage } from './pages/Staff';
import { SettingsPage } from './pages/Settings';
import { ProgramPage } from './pages/Program';
import { ScanPage } from './pages/Scan';
import { NewCustomerPage } from './pages/NewCustomer';
import { StaffCardPage } from './pages/StaffCard';
import { AuditPage, CustomerDetailPage, CustomersPage } from './pages/Customers';
import { CardPage, JoinPage, PrivacyPage, PublicLayout } from './pages/public';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/invite/:token', element: <AcceptInvitePage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <ScanPage /> },
      { path: '/staff', element: <StaffPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/program', element: <ProgramPage /> },
      { path: '/scan', element: <Navigate to="/" replace /> },
      { path: '/cards/:id', element: <StaffCardPage /> },
      { path: '/new-customer', element: <NewCustomerPage /> },
      { path: '/customers', element: <CustomersPage /> },
      { path: '/customers/:id', element: <CustomerDetailPage /> },
      { path: '/audit', element: <AuditPage /> },
    ],
  },
  {
    // публичные страницы для клиенток — без входа
    element: <PublicLayout />,
    children: [
      { path: '/j/:slug', element: <JoinPage /> },
      { path: '/j/:slug/privacy', element: <PrivacyPage /> },
      { path: '/c/:serial', element: <CardPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
