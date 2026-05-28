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
    path: 'privacidad',
    loadComponent: () => import('./pages/legal/privacy').then((m) => m.PrivacyComponent),
  },
  {
    path: 'terminos',
    loadComponent: () => import('./pages/legal/terms').then((m) => m.TermsComponent),
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
        path: 'companies/:siteId/electric',
        loadComponent: () =>
          import('./pages/companies/company-site-electric-detail').then(
            (m) => m.CompanySiteElectricDetailComponent,
          ),
      },
      {
        path: 'companies/:siteId/riles',
        data: { siteType: 'riles' },
        loadComponent: () =>
          import('./pages/companies/company-site-coming-soon-detail').then(
            (m) => m.CompanySiteComingSoonDetailComponent,
          ),
      },
      {
        path: 'companies/:siteId/cold-room',
        loadComponent: () =>
          import('./pages/companies/company-site-cold-room-detail').then(
            (m) => m.CompanySiteColdRoomDetailComponent,
          ),
      },
      {
        path: 'companies/:siteId/cold-room/tap/:tapId',
        loadComponent: () =>
          import('./pages/ventisqueros/ventisqueros-tap-detail').then(
            (m) => m.VentisquerosTapDetailComponent,
          ),
      },
      {
        path: 'companies/:siteId/process',
        data: { siteType: 'proceso' },
        loadComponent: () =>
          import('./pages/companies/company-site-coming-soon-detail').then(
            (m) => m.CompanySiteComingSoonDetailComponent,
          ),
      },
      {
        path: 'companies/:siteId/generic',
        data: { siteType: 'generico' },
        loadComponent: () =>
          import('./pages/companies/company-site-coming-soon-detail').then(
            (m) => m.CompanySiteComingSoonDetailComponent,
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
        path: 'profile',
        loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfileComponent),
      },
      {
        path: 'administration',
        canActivate: [roleGuard('SuperAdmin')],
        loadComponent: () =>
          import('./pages/administration/administration').then((m) => m.AdministrationComponent),
      },
      {
        path: 'dga-review',
        canActivate: [roleGuard('SuperAdmin', 'Admin')],
        loadComponent: () =>
          import('./pages/dga-review/dga-review').then((m) => m.DgaReviewComponent),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundComponent),
  },
];
