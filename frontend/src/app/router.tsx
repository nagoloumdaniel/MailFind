import { createBrowserRouter } from 'react-router';
import { AppLayout } from './AppLayout';
import { RequireSession } from './RequireSession';
import { AccountPage } from '../pages/AccountPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ImportDetailPage } from '../pages/ImportDetailPage';
import { ImportPage } from '../pages/ImportPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { TermsPage } from '../pages/TermsPage';

/**
 * Les chemins sont en francais, comme le reste de l'interface. Ce sont des
 * adresses que l'utilisateur lit et partage.
 */
export const router = createBrowserRouter([
  { path: '/connexion', element: <LoginPage /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/imports/:id', element: <ImportDetailPage /> },
          { path: '/conditions', element: <TermsPage /> },
          { path: '/compte', element: <AccountPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
