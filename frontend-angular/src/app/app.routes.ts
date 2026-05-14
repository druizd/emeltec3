import { Routes } from '@angular/router';
import { authGuard, publicGuard, roleGuard } from './guards/auth.guard';

import { LayoutComponent } from './components/layout/layout';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
    canActivate: [publicGuard],
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'companies/:siteId/water',
        loadComponent: () =>
          import('./pages/companies/company-site-water-detail').then(
            (m) => m.CompanySiteWaterDetailComponent,
          ),
      },
      {
        path: 'ventisqueros',
        loadComponent: () =>
          import('./pages/ventisqueros/ventisqueros').then((m) => m.VentisquerosComponent),
      },
      {
        path: 'ventisqueros/tap/:tapId',
        loadComponent: () =>
          import('./pages/ventisqueros/ventisqueros-tap-detail').then(
            (m) => m.VentisquerosTapDetailComponent,
          ),
      },
      {
        path: 'companies',
        loadComponent: () =>
          import('./pages/companies/companies').then((m) => m.CompaniesComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent),
      },
      {
        path: 'administration',
        canActivate: [roleGuard('SuperAdmin')],
        loadComponent: () =>
          import('./pages/administration/administration').then((m) => m.AdministrationComponent),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
