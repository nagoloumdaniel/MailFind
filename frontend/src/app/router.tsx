import { createBrowserRouter } from 'react-router';
import { AppLayout } from './AppLayout';
import { RequireSession } from './RequireSession';
import { AccountPage } from '../pages/AccountPage';
import { ApiDocsPage } from '../pages/ApiDocsPage';
import { CompaniesPage } from '../pages/CompaniesPage';
import { CompanyPage } from '../pages/CompanyPage';
import { ExportsPage } from '../pages/ExportsPage';
import { ContactsPage } from '../pages/ContactsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ImportDetailPage } from '../pages/ImportDetailPage';
import { ImportPage } from '../pages/ImportPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { TermsPage } from '../pages/TermsPage';
import { VerifyPage } from '../pages/VerifyPage';

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
          { path: '/entreprises', element: <CompaniesPage /> },
          { path: '/entreprises/:id', element: <CompanyPage /> },
          { path: '/contacts', element: <ContactsPage /> },
          { path: '/exports', element: <ExportsPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/imports/:id', element: <ImportDetailPage /> },
          { path: '/verifier', element: <VerifyPage /> },
          { path: '/conditions', element: <TermsPage /> },
          { path: '/compte', element: <AccountPage /> },
          { path: '/documentation-api', element: <ApiDocsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
