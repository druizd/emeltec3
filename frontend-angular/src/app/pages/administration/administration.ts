import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  AdministrationService,
  CompanyNode,
  CreateVariableMapPayload,
  DetectedDevice,
  PozoConfig,
  SiteRecord,
  SiteTypeCatalogItem,
  SiteTypeCatalogResponse,
  SiteTypeRoleOption,
  SiteTypeTransformOption,
  SiteVariable,
  SiteVariablesPayload,
  SubCompanyNode,
  VariableMapping,
} from '../../services/administration.service';
import { CompanyService } from '../../services/company.service';
import { KpiCardComponent } from '../../components/ui/kpi-card';
import { dashboardRouteForSite, getSiteTypeUi } from '../../shared/site-type-ui';
import { formatRutInput } from '../../shared/rut';
import { AdminPaginationComponent } from './components/admin-pagination';
import { AdminFormActionsComponent } from './components/admin-form-actions';
import { AdminSectionShellComponent } from './components/admin-section-shell';
import { AdminSectionHeaderComponent } from './components/admin-section-header';
import { AdminTableToolbarComponent } from './components/admin-table-toolbar';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { TableSkeletonComponent } from '../../components/ui/table-skeleton';
import { EquipoEmeltecSectionComponent } from './components/equipo-emeltec-section';
import { DEFAULT_SITE_TYPE_CATALOG } from './site-type-catalog';

type SectionId = 'empresas' | 'subempresas' | 'sitios' | 'equipos' | 'equipo-emeltec';
type StatusType = 'success' | 'error' | '';

interface AdminStatus {
  type: StatusType;
  message: string;
}

interface ConfirmDialog {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  tone: 'danger' | 'primary';
  icon: string;
  onConfirm: () => void;
}

interface PendingDelete {
  label: string;
  /** Reverts the optimistic UI mutation when the user cancels. */
  restore: () => void;
  /** Fires the actual DELETE against the API after the undo window expires. */
  commit: () => void;
  /** setTimeout handle so cancel can clear it. */
  timerId: number;
  /** setInterval handle for the countdown UI. */
  countdownTimerId: number;
  /** ms remaining for UI; updated by the interval. */
  remainingMs: number;
}

interface SubCompanyOption extends SubCompanyNode {
  companyName: string;
}

interface SiteOption extends SiteRecord {
  companyName: string;
  subCompanyName: string;
}

interface CompanyForm {
  nombre: string;
  rut: string;
  tipo_empresa: string;
}

interface SubCompanyForm {
  empresa_id: string;
  nombre: string;
  rut: string;
}

interface SiteForm {
  empresa_id: string;
  sub_empresa_id: string;
  descripcion: string;
  id_serial: string;
  ubicacion: string;
  /** UTM northing (metros). Texto en el form, parseado al guardar. */
  coord_norte: string;
  /** UTM easting (metros). */
  coord_este: string;
  /** Zona UTM (1-60). Chile usa 18, 19 o 20. Default 19. */
  huso: string;
  tipo_sitio: string;
  activo: boolean;
  es_maleta_piloto: boolean;
  profundidad_pozo_m: string;
  profundidad_sensor_m: string;
  nivel_estatico_manual_m: string;
  obra_dga: string;
  slug: string;
}

interface VariableForm {
  mapId: string;
  alias: string;
  d1: string;
  d2: string;
  tipo_dato: string;
  unidad: string;
  rol_dashboard: string;
  transformacion: string;
  factor: string;
  offset: string;
  sandboxRaw: string;
}

const ADMIN_PAGE_SIZE = 10;

const DEFAULT_VARIABLE_FORM: VariableForm = {
  mapId: '',
  alias: '',
  d1: '',
  d2: '',
  tipo_dato: 'FLOAT',
  unidad: '',
  rol_dashboard: 'generico',
  transformacion: 'directo',
  factor: '1',
  offset: '0',
  sandboxRaw: '',
};


@Component({
  selector: 'app-administration',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    A11yModule,
    KpiCardComponent,
    AdminPaginationComponent,
    AdminFormActionsComponent,
    AdminSectionShellComponent,
    AdminSectionHeaderComponent,
    AdminTableToolbarComponent,
    SkeletonComponent,
    TableSkeletonComponent,
    EquipoEmeltecSectionComponent,
  ],
  template: `
    <div class="min-h-[calc(100vh-4rem)] bg-slate-50 px-5 py-5 text-slate-800">
      <div class="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header
          class="flex flex-col gap-5 border-b border-surface-container pb-5 lg:flex-row lg:items-end lg:justify-between"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[18px] text-primary-container"
                >settings_applications</span
              >
              <p
                class="font-josefin text-caption-xs font-semibold uppercase tracking-[0.16em] text-primary-container"
              >
                SuperAdmin
              </p>
            </div>
            <h1
              class="mt-1.5 font-josefin text-h4 font-semibold tracking-[-0.01em] text-on-surface"
            >
              Administración
            </h1>
            <p class="mt-1 text-body-sm text-on-surface-variant">
              Gestiona empresas, subempresas, sitios y dispositivos detectados.
            </p>
          </div>

          <div
            class="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(3,minmax(160px,1fr))_auto] sm:items-stretch"
          >
            <app-kpi-card
              label="Empresas"
              icon="domain"
              tone="primary"
              [value]="hierarchy().length"
            />
            <app-kpi-card
              label="Sitios"
              icon="location_on"
              tone="primary"
              [value]="allSites().length"
            />
            <app-kpi-card
              label="Equipos"
              icon="memory"
              tone="primary"
              [value]="detectedDevices().length"
            />
            <button
              type="button"
              (click)="loadDashboard()"
              [disabled]="loading()"
              class="flex h-full min-h-[64px] w-full items-center justify-center rounded-xl border border-surface-container bg-white text-on-surface-variant transition-all hover:border-primary-tint-30 hover:text-primary-container hover:shadow-primary-glow active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-[56px]"
              aria-label="Actualizar"
            >
              <span
                class="material-symbols-outlined text-[20px]"
                [class.animate-spin]="loading()"
                aria-hidden="true"
                >refresh</span
              >
            </button>
          </div>
        </header>

        @if (status().message) {
          <div [class]="statusClass()" role="alert">
            <span class="material-symbols-outlined text-[19px]">{{
              status().type === 'success' ? 'check_circle' : 'error'
            }}</span>
            <span>{{ status().message }}</span>
          </div>
        }

        @if (pendingDelete(); as pending) {
          <div
            class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm font-semibold text-amber-800"
            role="status"
            aria-live="polite"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="material-symbols-outlined text-[19px]">schedule</span>
              <span class="truncate">
                Eliminando {{ pending.label }} en {{ pendingDeleteCountdown() }}s…
              </span>
            </div>
            <button
              type="button"
              (click)="undoPendingDelete()"
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-caption font-semibold text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span class="material-symbols-outlined text-[16px]">undo</span>
              Deshacer
            </button>
          </div>
        }

        @if (confirmDialog(); as dialog) {
          <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
            (click)="cancelConfirmDialog()"
          >
            <section
              class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]"
              role="dialog"
              cdkTrapFocus
              cdkTrapFocusAutoCapture
              aria-modal="true"
              aria-labelledby="admin-confirm-title"
              (click)="$event.stopPropagation()"
            >
              <div class="flex gap-4 border-b border-slate-100 px-5 py-5">
                <span
                  [class]="
                    dialog.tone === 'danger'
                      ? 'material-symbols-outlined grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-50 text-[24px] text-red-600'
                      : 'material-symbols-outlined grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-tint-10 text-[24px] text-primary-container'
                  "
                  >{{ dialog.icon }}</span
                >
                <div class="min-w-0">
                  <h3 id="admin-confirm-title" class="text-h6 font-semibold text-slate-900">
                    {{ dialog.title }}
                  </h3>
                  <p class="mt-1 text-body-sm leading-6 text-slate-500">{{ dialog.message }}</p>
                </div>
              </div>
              <div
                class="flex flex-col-reverse gap-2 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end"
              >
                <button type="button" (click)="cancelConfirmDialog()" class="secondary-button">
                  {{ dialog.cancelText }}
                </button>
                <button
                  type="button"
                  (click)="confirmDialogAction()"
                  [class]="dialog.tone === 'danger' ? 'danger-button' : 'primary-button'"
                >
                  <span class="material-symbols-outlined text-[18px]">{{
                    dialog.tone === 'danger' ? 'delete' : 'check'
                  }}</span>
                  {{ dialog.confirmText }}
                </button>
              </div>
            </section>
          </div>
        }

        <section class="admin-shell">
          <nav class="section-tabs" aria-label="Secciones de administracion">
            @for (item of sectionItems; track item.id) {
              <button
                type="button"
                (click)="setSection(item.id)"
                [class]="sectionButtonClass(item.id)"
              >
                <span class="material-symbols-outlined text-[21px]">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
              </button>
            }
          </nav>

          <main class="min-w-0">
            @if (loading()) {
              <section class="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <app-skeleton class="h-5 w-48 rounded" />
                <div class="flex flex-wrap gap-3">
                  <app-skeleton class="h-10 w-40 rounded-lg" />
                  <app-skeleton class="h-10 w-32 rounded-lg" />
                  <app-skeleton class="h-10 w-28 rounded-lg" />
                </div>
                <app-table-skeleton [rows]="6" [columns]="5" />
              </section>
            } @else {
              @if (activeSection() === 'empresas') {
                <app-admin-section-shell title="Empresas padre">
                  <form
                    (submit)="submitCompany($event)"
                    class="editor-panel grid gap-4 lg:grid-cols-3"
                  >
                    <div class="lg:col-span-3">
                      <app-admin-section-header
                        [selected]="!!selectedCompanyId()"
                        selectedLabel="Empresa seleccionada"
                        newLabel="Nueva empresa"
                        selectedHint="Presiona editar datos para habilitar cambios."
                        newHint="Completa los datos para crear una empresa."
                        (createNew)="startCreateCompany()"
                      ></app-admin-section-header>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500">Nombre</label>
                      <input
                        required
                        [disabled]="companyFormDisabled()"
                        name="company-name"
                        [ngModel]="companyForm().nombre"
                        (ngModelChange)="updateCompanyForm('nombre', $event)"
                        class="field-control"
                        placeholder="Empresa padre"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >RUT (opcional)</label
                      >
                      <input
                        [disabled]="companyFormDisabled()"
                        name="company-rut"
                        [ngModel]="companyForm().rut"
                        (ngModelChange)="updateCompanyForm('rut', $event)"
                        inputmode="text"
                        maxlength="12"
                        class="field-control"
                        placeholder="76.000.000-0"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500">Tipo</label>
                      <select
                        name="company-type"
                        [disabled]="companyFormDisabled()"
                        [ngModel]="companyForm().tipo_empresa"
                        (ngModelChange)="updateCompanyForm('tipo_empresa', $event)"
                        class="field-control"
                      >
                        <option value="Agua">Agua</option>
                        <option value="Eléctrico">Eléctrico</option>
                        <option value="Industrial">Industrial</option>
                        <option value="Cliente">Cliente</option>
                      </select>
                    </div>
                    <div class="flex flex-wrap gap-2 lg:col-span-3">
                      <app-admin-form-actions
                        [selected]="!!selectedCompanyId()"
                        [editMode]="companyEditMode()"
                        [busy]="busyAction()"
                        createKey="company"
                        updateKey="company-update"
                        deleteKey="company-delete"
                        createLabel="Crear empresa"
                        createIcon="domain_add"
                        entityLabel="empresa"
                        (enableEdit)="enableCompanyEdit()"
                        (cancelEdit)="cancelCompanyEdit()"
                        (remove)="deleteSelectedCompany()"
                      ></app-admin-form-actions>
                    </div>
                  </form>

                  <div class="table-card">
                    <app-admin-table-toolbar
                      title="Empresas registradas"
                      [countLabel]="
                        filteredCompanies().length + ' de ' + hierarchy().length + ' visibles'
                      "
                      [searchValue]="companySearch()"
                      placeholder="Buscar empresa, RUT o tipo"
                      (searchChange)="updateCompanySearch($event)"
                    ></app-admin-table-toolbar>

                    <div class="overflow-x-auto">
                      <table
                        class="responsive-table w-full text-left text-body-sm md:min-w-[680px]"
                      >
                        <thead class="table-head">
                          <tr>
                            <th class="px-4 py-3">Nombre</th>
                            <th class="px-4 py-3">RUT</th>
                            <th class="px-4 py-3">Tipo</th>
                            <th class="px-4 py-3 text-right">Sitios</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (company of paginatedCompanies(); track company.id) {
                            <tr
                              (click)="selectCompany(company.id)"
                              [class]="rowClass(selectedCompanyId() === company.id)"
                            >
                              <td class="px-4 py-3 font-bold text-slate-800" data-label="Nombre">
                                {{ company.nombre }}
                              </td>
                              <td class="px-4 py-3 text-slate-500" data-label="RUT">
                                {{ company.rut }}
                              </td>
                              <td class="px-4 py-3" data-label="Tipo">
                                <span [class]="companyTypeBadgeClass(company.tipo_empresa)">{{
                                  company.tipo_empresa
                                }}</span>
                              </td>
                              <td
                                class="px-4 py-3 text-right font-bold text-slate-600"
                                data-label="Sitios"
                              >
                                {{ countCompanySites(company) }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <app-admin-pagination
                      [total]="filteredCompanies().length"
                      [page]="companyPage()"
                      (pageChange)="setPage('empresas', $event)"
                    ></app-admin-pagination>
                  </div>
                </app-admin-section-shell>
              }

              @if (activeSection() === 'subempresas') {
                <app-admin-section-shell title="Subempresas">
                  <form
                    (submit)="submitSubCompany($event)"
                    class="editor-panel grid gap-4 lg:grid-cols-3"
                  >
                    <div class="lg:col-span-3">
                      <app-admin-section-header
                        [selected]="!!selectedSubCompanyId()"
                        selectedLabel="Subempresa seleccionada"
                        newLabel="Nueva subempresa"
                        selectedHint="Presiona editar datos para habilitar cambios."
                        newHint="Completa los datos para crear una subempresa."
                        (createNew)="startCreateSubCompany()"
                      ></app-admin-section-header>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Empresa padre</label
                      >
                      <select
                        required
                        [disabled]="subCompanyFormDisabled()"
                        name="sub-company-parent"
                        [ngModel]="subCompanyForm().empresa_id"
                        (ngModelChange)="updateSubCompanyForm('empresa_id', $event)"
                        class="field-control"
                      >
                        <option value="" disabled>Selecciona empresa</option>
                        @for (company of hierarchy(); track company.id) {
                          <option [value]="company.id">{{ company.nombre }}</option>
                        }
                      </select>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500">Nombre</label>
                      <input
                        required
                        [disabled]="subCompanyFormDisabled()"
                        name="sub-company-name"
                        [ngModel]="subCompanyForm().nombre"
                        (ngModelChange)="updateSubCompanyForm('nombre', $event)"
                        class="field-control"
                        placeholder="Subempresa o faena"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500">RUT</label>
                      <input
                        required
                        [disabled]="subCompanyFormDisabled()"
                        name="sub-company-rut"
                        [ngModel]="subCompanyForm().rut"
                        (ngModelChange)="updateSubCompanyForm('rut', $event)"
                        inputmode="text"
                        maxlength="12"
                        class="field-control"
                        placeholder="76.000.000-0"
                      />
                    </div>
                    <div class="flex flex-wrap gap-2 lg:col-span-3">
                      <app-admin-form-actions
                        [selected]="!!selectedSubCompanyId()"
                        [editMode]="subCompanyEditMode()"
                        [busy]="busyAction()"
                        createKey="subcompany"
                        updateKey="subcompany-update"
                        deleteKey="subcompany-delete"
                        createLabel="Crear subempresa"
                        createIcon="add_business"
                        entityLabel="subempresa"
                        (enableEdit)="enableSubCompanyEdit()"
                        (cancelEdit)="cancelSubCompanyEdit()"
                        (remove)="deleteSelectedSubCompany()"
                      ></app-admin-form-actions>
                    </div>
                  </form>

                  <div class="table-card">
                    <app-admin-table-toolbar
                      title="Subempresas registradas"
                      [countLabel]="
                        filteredSubCompanies().length +
                        ' de ' +
                        allSubCompanies().length +
                        ' visibles'
                      "
                      [searchValue]="subCompanySearch()"
                      placeholder="Buscar subempresa, empresa o RUT"
                      (searchChange)="updateSubCompanySearch($event)"
                    ></app-admin-table-toolbar>

                    <div class="overflow-x-auto">
                      <table
                        class="responsive-table w-full text-left text-body-sm md:min-w-[760px]"
                      >
                        <thead class="table-head">
                          <tr>
                            <th class="px-4 py-3">Nombre</th>
                            <th class="px-4 py-3">Empresa</th>
                            <th class="px-4 py-3">RUT</th>
                            <th class="px-4 py-3 text-right">Sitios</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (sub of paginatedSubCompanies(); track sub.id) {
                            <tr
                              (click)="selectSubCompany(sub.id)"
                              [class]="rowClass(selectedSubCompanyId() === sub.id)"
                            >
                              <td class="px-4 py-3 font-bold text-slate-800" data-label="Nombre">
                                {{ sub.nombre }}
                              </td>
                              <td class="px-4 py-3 text-slate-500" data-label="Empresa">
                                {{ sub.companyName }}
                              </td>
                              <td class="px-4 py-3 text-slate-500" data-label="RUT">
                                {{ sub.rut }}
                              </td>
                              <td
                                class="px-4 py-3 text-right font-bold text-slate-600"
                                data-label="Sitios"
                              >
                                {{ sub.sites.length }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <app-admin-pagination
                      [total]="filteredSubCompanies().length"
                      [page]="subCompanyPage()"
                      (pageChange)="setPage('subempresas', $event)"
                    ></app-admin-pagination>
                  </div>
                </app-admin-section-shell>
              }

              @if (activeSection() === 'sitios') {
                <app-admin-section-shell title="Sitios">
                  <form
                    (submit)="submitSite($event)"
                    class="editor-panel grid gap-4 lg:grid-cols-4"
                  >
                    <div class="lg:col-span-4">
                      <app-admin-section-header
                        [selected]="!!selectedSiteId()"
                        selectedLabel="Sitio seleccionado"
                        newLabel="Nuevo sitio"
                        selectedHint="Selecciona editar datos para modificar este sitio."
                        newHint="Completa los datos para crear un sitio."
                        buttonLabel="Nuevo"
                        (createNew)="startCreateSite()"
                      ></app-admin-section-header>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Empresa padre</label
                      >
                      <select
                        required
                        [disabled]="siteFormDisabled()"
                        name="site-company"
                        [ngModel]="siteForm().empresa_id"
                        (ngModelChange)="selectCompanyForSite($event)"
                        class="field-control"
                      >
                        <option value="" disabled>Selecciona empresa</option>
                        @for (company of hierarchy(); track company.id) {
                          <option [value]="company.id">{{ company.nombre }}</option>
                        }
                      </select>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Subempresa</label
                      >
                      <select
                        required
                        [disabled]="siteFormDisabled()"
                        name="site-subcompany"
                        [ngModel]="siteForm().sub_empresa_id"
                        (ngModelChange)="updateSiteForm('sub_empresa_id', $event)"
                        class="field-control"
                      >
                        <option value="" disabled>Selecciona subempresa</option>
                        @for (sub of subCompaniesForSiteForm(); track sub.id) {
                          <option [value]="sub.id">{{ sub.nombre }}</option>
                        }
                      </select>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Tipo de instalacion</label
                      >
                      <select
                        name="site-type"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().tipo_sitio"
                        (ngModelChange)="updateSiteForm('tipo_sitio', $event)"
                        class="field-control"
                      >
                        @for (type of siteTypeOptions(); track type.id) {
                          <option [value]="type.id">{{ type.label }}</option>
                        }
                      </select>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500">Estado</label>
                      <select
                        name="site-active"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().activo ? 'true' : 'false'"
                        (ngModelChange)="updateSiteActive($event)"
                        class="field-control"
                      >
                        <option value="true">Activo</option>
                        <option value="false">Inactivo</option>
                      </select>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Maleta Piloto</label
                      >
                      <select
                        name="site-maleta-piloto"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().es_maleta_piloto ? 'true' : 'false'"
                        (ngModelChange)="updateSiteMaletaPiloto($event)"
                        class="field-control"
                      >
                        <option value="false">No</option>
                        <option value="true">Sí — mostrar en Maletas Pilotos</option>
                      </select>
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Nombre del sitio</label
                      >
                      <input
                        required
                        [disabled]="siteFormDisabled()"
                        name="site-description"
                        [ngModel]="siteForm().descripcion"
                        (ngModelChange)="updateSiteForm('descripcion', $event)"
                        class="field-control"
                        placeholder="Pozo, vertiente, canal o instalacion"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Serial del equipo</label
                      >
                      <input
                        required
                        [disabled]="siteFormDisabled()"
                        name="site-serial"
                        [ngModel]="siteForm().id_serial"
                        (ngModelChange)="updateSiteForm('id_serial', $event)"
                        class="field-control"
                        placeholder="151.20.43.6"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Ubicación</label
                      >
                      <input
                        name="site-location"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().ubicacion"
                        (ngModelChange)="updateSiteForm('ubicacion', $event)"
                        class="field-control"
                        placeholder="Ciudad, faena o referencia"
                      />
                    </div>
                    <!-- Coordenadas UTM. Se convierten a lat/lng en el
                         frontend (proj4) para plotear en el mapa satelital
                         de la vista general. Chile usa huso 18/19/20. -->
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Coord. Norte (UTM)</label
                      >
                      <input
                        name="site-coord-norte"
                        type="number"
                        step="0.01"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().coord_norte"
                        (ngModelChange)="updateSiteForm('coord_norte', $event)"
                        class="field-control font-mono"
                        placeholder="6.689.234,50"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Coord. Este (UTM)</label
                      >
                      <input
                        name="site-coord-este"
                        type="number"
                        step="0.01"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().coord_este"
                        (ngModelChange)="updateSiteForm('coord_este', $event)"
                        class="field-control font-mono"
                        placeholder="345.678,90"
                      />
                    </div>
                    <div>
                      <label class="mb-1 block text-caption font-bold text-slate-500"
                        >Huso UTM</label
                      >
                      <select
                        name="site-huso"
                        [disabled]="siteFormDisabled()"
                        [ngModel]="siteForm().huso"
                        (ngModelChange)="updateSiteForm('huso', $event)"
                        class="field-control"
                      >
                        <option value="">—</option>
                        <option value="18">18 (Norte Chile)</option>
                        <option value="19">19 (Centro Chile)</option>
                        <option value="20">20 (Sur Chile)</option>
                      </select>
                    </div>
                    <div class="lg:col-span-4 flex flex-wrap gap-2">
                      <app-admin-form-actions
                        [selected]="!!selectedSiteId()"
                        [editMode]="siteEditMode()"
                        [busy]="busyAction()"
                        createKey="site"
                        updateKey="site-update"
                        deleteKey="site-delete"
                        createLabel="Crear sitio"
                        createIcon="add_location_alt"
                        entityLabel="sitio"
                        (enableEdit)="enableSiteEdit()"
                        (cancelEdit)="cancelSiteEdit()"
                        (remove)="deleteSelectedSite()"
                      ></app-admin-form-actions>
                    </div>
                    @if (selectedSiteId() && !siteEditMode()) {
                      <div
                        class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-caption text-slate-500 lg:col-span-4"
                      >
                        {{
                          selectedSite()?.ubicacion
                            ? 'Ubicación: ' + selectedSite()?.ubicacion
                            : 'Sin ubicación registrada'
                        }}
                      </div>
                    }
                  </form>

                  <div class="table-card">
                    <app-admin-table-toolbar
                      title="Sitios registrados"
                      [countLabel]="
                        filteredSites().length + ' de ' + allSites().length + ' visibles'
                      "
                      [searchValue]="siteSearch()"
                      placeholder="Buscar sitio, serial, empresa o estado"
                      (searchChange)="updateSiteSearch($event)"
                    ></app-admin-table-toolbar>

                    <div class="overflow-x-auto">
                      <table
                        class="responsive-table w-full text-left text-body-sm md:min-w-[680px]"
                      >
                        <thead class="table-head">
                          <tr>
                            <th class="px-4 py-3">Sitio</th>
                            <th class="px-4 py-3">Tipo</th>
                            <th class="px-4 py-3">Serial</th>
                            <th class="px-4 py-3">Subempresa</th>
                            <th class="px-4 py-3">Estado</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (site of paginatedSites(); track site.id) {
                            <tr
                              (click)="selectSite(site.id)"
                              [class]="rowClass(selectedSiteId() === site.id)"
                            >
                              <td class="px-4 py-3 font-bold text-slate-800" data-label="Sitio">
                                {{ site.descripcion }}
                              </td>
                              <td class="px-4 py-3" data-label="Tipo">
                                <span [class]="siteTypeBadgeClass(site.tipo_sitio)">{{
                                  siteTypeLabel(site.tipo_sitio)
                                }}</span>
                              </td>
                              <td
                                class="px-4 py-3 font-mono text-caption text-slate-600"
                                data-label="Serial"
                              >
                                {{ site.id_serial }}
                              </td>
                              <td class="px-4 py-3 text-slate-500" data-label="Subempresa">
                                {{ site.subCompanyName }}
                              </td>
                              <td class="px-4 py-3" data-label="Estado">
                                <span
                                  [class]="statusBadgeClass(site.activo ? 'success' : 'neutral')"
                                >
                                  {{ site.activo ? 'Activo' : 'Inactivo' }}
                                </span>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <app-admin-pagination
                      [total]="filteredSites().length"
                      [page]="sitePage()"
                      (pageChange)="setPage('sitios', $event)"
                    ></app-admin-pagination>
                  </div>
                </app-admin-section-shell>
              }

              @if (activeSection() === 'equipos') {
                <app-admin-section-shell title="Equipos detectados">
                  <div class="table-card">
                    <app-admin-table-toolbar
                      title="Equipos detectados"
                      [countLabel]="
                        filteredDevices().length + ' de ' + detectedDevices().length + ' visibles'
                      "
                      [searchValue]="deviceSearch()"
                      placeholder="Buscar serial, sitio o empresa"
                      (searchChange)="updateDeviceSearch($event)"
                    >
                      <button type="button" (click)="loadDashboard()" class="secondary-button">
                        <span class="material-symbols-outlined text-[18px]">sync</span>
                        Actualizar
                      </button>
                    </app-admin-table-toolbar>

                    <div class="overflow-x-auto">
                      <table
                        class="responsive-table w-full text-left text-body-sm md:min-w-[1080px]"
                      >
                        <thead class="table-head">
                          <tr>
                            <th class="px-4 py-3">Serial</th>
                            <th class="px-4 py-3">Registro</th>
                            <th class="px-4 py-3">Desfase</th>
                            <th class="px-4 py-3 text-right">Cantidad de datos</th>
                            <th class="px-4 py-3">Sitio</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (device of paginatedDevices(); track device.id_serial) {
                            <tr class="bg-white transition-colors hover:bg-slate-50">
                              <td
                                class="px-4 py-3 font-mono text-caption font-bold text-slate-700"
                                data-label="Serial"
                              >
                                {{ device.id_serial }}
                              </td>
                              <td class="px-4 py-3" data-label="Registro">
                                <div class="device-time-stack">
                                  <div class="device-time-row">
                                    <span class="device-time-label">Medición</span>
                                    <span class="device-time-value">{{
                                      deviceMeasurementLabel(device)
                                    }}</span>
                                  </div>
                                  <div class="device-time-row">
                                    <span class="device-time-label">Llegada BD</span>
                                    <span class="device-time-value">{{
                                      deviceArrivalLabel(device)
                                    }}</span>
                                  </div>
                                </div>
                              </td>
                              <td class="px-4 py-3" data-label="Desfase">
                                <span
                                  [class]="deviceClockSkewBadgeClass(device)"
                                  [title]="deviceClockSkewTitle(device)"
                                >
                                  <span class="material-symbols-outlined text-[15px]">{{
                                    deviceClockSkewIcon(device)
                                  }}</span>
                                  {{ deviceClockSkewLabel(device) }}
                                </span>
                              </td>
                              <td
                                class="px-4 py-3 text-right font-bold text-slate-700"
                                data-label="Cantidad de datos"
                              >
                                {{ deviceDataCountLabel(device) }}
                              </td>
                              <td class="px-4 py-3" data-label="Sitio">
                                <span
                                  [class]="
                                    statusBadgeClass(device.sitio_id ? 'success' : 'warning')
                                  "
                                >
                                  {{ device.sitio_descripcion || 'Sin asignar' }}
                                </span>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <app-admin-pagination
                      [total]="filteredDevices().length"
                      [page]="devicePage()"
                      (pageChange)="setPage('equipos', $event)"
                    ></app-admin-pagination>
                  </div>
                </app-admin-section-shell>
              }

              @if (activeSection() === 'equipo-emeltec') {
                <app-admin-section-shell title="Equipo Emeltec">
                  <app-equipo-emeltec-section />
                </app-admin-section-shell>
              }
            }
          </main>
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      /* Shell ----------------------------------------------------- */
      .admin-shell {
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
      }

      /* Tabs ------------------------------------------------------ */
      .section-tabs {
        display: flex;
        gap: 4px;
        overflow-x: auto;
        border-bottom: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 0 16px;
      }

      .section-tab-button {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
        padding: 14px 12px;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-on-surface-variant);
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        transition:
          color 160ms ease,
          border-color 160ms ease;
        cursor: pointer;
      }

      .section-tab-button:hover {
        color: var(--color-primary-container);
      }

      .section-tab-button:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: -2px;
        border-radius: 6px;
      }

      .section-tab-active {
        color: var(--color-primary-container);
        border-bottom-color: var(--color-primary);
      }

      /* Form fields ---------------------------------------------- */
      .field-control {
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 9px 12px;
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--color-on-surface);
        outline: none;
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease;
      }

      .field-control:focus {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px rgba(13, 175, 189, 0.15);
      }

      .field-control:disabled {
        background: var(--color-surface-subtle);
        color: var(--color-on-surface-variant);
        cursor: not-allowed;
      }

      .field-control::placeholder {
        color: var(--color-on-surface-muted);
      }

      /* Editor panel --------------------------------------------- */
      .editor-panel {
        border-radius: 10px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface-subtle);
        padding: 20px;
      }

      /* Table card ----------------------------------------------- */
      .table-card {
        min-width: 0;
        overflow: hidden;
        border-radius: 10px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
      }

      /* Table head ----------------------------------------------- */
      .table-head {
        background: var(--color-surface-subtle);
        font-family: var(--font-josefin);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
      }

      .device-time-stack {
        display: grid;
        gap: 4px;
        min-width: 220px;
      }

      .device-time-row {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr);
        align-items: baseline;
        gap: 10px;
      }

      .device-time-label {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
      }

      .device-time-value {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
        color: var(--color-on-surface);
        white-space: nowrap;
      }

      .device-skew-badge {
        display: inline-flex;
        min-height: 28px;
        align-items: center;
        gap: 6px;
        border-radius: 9999px;
        border: 1px solid transparent;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }

      .device-skew-ok {
        border-color: rgba(34, 197, 94, 0.25);
        background: rgba(34, 197, 94, 0.1);
        color: #16a34a;
      }

      .device-skew-warning {
        border-color: rgba(251, 191, 36, 0.3);
        background: rgba(251, 191, 36, 0.12);
        color: #b45309;
      }

      .device-skew-danger {
        border-color: rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.1);
        color: #dc2626;
      }

      .device-skew-neutral {
        border-color: var(--color-outline-variant);
        background: var(--color-surface-subtle);
        color: var(--color-on-surface-variant);
      }

      /* Buttons --------------------------------------------------- */
      .primary-button,
      .secondary-button,
      .danger-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-family: var(--font-body);
        cursor: pointer;
        transition: all 160ms ease;
      }

      .primary-button {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-primary);
        background: var(--color-primary);
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: white;
      }

      .primary-button:hover:not(:disabled) {
        background: var(--color-primary-container);
        border-color: var(--color-primary-container);
        box-shadow: 0 4px 12px rgba(13, 175, 189, 0.25);
      }

      .primary-button:active:not(:disabled) {
        transform: scale(0.98);
      }

      .primary-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .secondary-button {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-on-surface-variant);
      }

      .secondary-button:hover {
        border-color: rgba(13, 175, 189, 0.3);
        background: rgba(13, 175, 189, 0.04);
        color: var(--color-primary-container);
      }

      .secondary-button:active {
        transform: scale(0.98);
      }

      .danger-button {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.08);
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 600;
        color: #dc2626;
      }

      .danger-button:hover:not(:disabled) {
        background: rgba(248, 113, 113, 0.14);
        border-color: rgba(248, 113, 113, 0.45);
      }

      .danger-button:active:not(:disabled) {
        transform: scale(0.98);
      }

      .danger-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      @media (max-width: 760px) {
        .primary-button,
        .secondary-button,
        .danger-button {
          width: 100%;
        }
      }
    `,
  ],
})
export class AdministrationComponent implements OnInit, OnDestroy {
  private api = inject(AdministrationService);
  private companyService = inject(CompanyService);
  private router = inject(Router);

  readonly sectionItems: { id: SectionId; icon: string; label: string }[] = [
    { id: 'empresas', icon: 'domain', label: 'Empresas' },
    { id: 'subempresas', icon: 'add_business', label: 'Subempresas' },
    { id: 'sitios', icon: 'location_on', label: 'Sitios' },
    { id: 'equipos', icon: 'memory', label: 'Equipos' },
    { id: 'equipo-emeltec', icon: 'groups', label: 'Equipo Emeltec' },
  ];

  activeSection = signal<SectionId>('empresas');
  loading = signal(false);
  busyAction = signal('');
  status = signal<AdminStatus>({ type: '', message: '' });
  confirmDialog = signal<ConfirmDialog | null>(null);
  /**
   * Pending delete with 5s undo window. The actual API call fires only after
   * the timer expires; pressing "Deshacer" cancels the timer and restores the
   * pre-delete UI snapshot. One in-flight at a time — starting a new delete
   * commits the previous one immediately so the second confirm dialog can't
   * race the first timer.
   */
  pendingDelete = signal<PendingDelete | null>(null);
  pendingDeleteCountdown = signal(0);

  hierarchy = signal<CompanyNode[]>([]);
  detectedDevices = signal<DetectedDevice[]>([]);
  selectedCompanyId = signal('');
  selectedSubCompanyId = signal('');
  selectedSiteId = signal('');
  companyEditMode = signal(false);
  subCompanyEditMode = signal(false);
  siteEditMode = signal(false);
  companySearch = signal('');
  subCompanySearch = signal('');
  siteSearch = signal('');
  deviceSearch = signal('');
  companyPage = signal(1);
  subCompanyPage = signal(1);
  sitePage = signal(1);
  devicePage = signal(1);
  siteTypeCatalog = signal<SiteTypeCatalogResponse>(DEFAULT_SITE_TYPE_CATALOG);
  siteVariables = signal<SiteVariablesPayload>({
    site: this.emptySite(),
    pozo_config: null,
    variables: [],
    mappings: [],
  });

  companyForm = signal<CompanyForm>({ nombre: '', rut: '', tipo_empresa: 'Agua' });
  subCompanyForm = signal<SubCompanyForm>({ empresa_id: '', nombre: '', rut: '' });
  siteForm = signal<SiteForm>({
    empresa_id: '',
    sub_empresa_id: '',
    descripcion: '',
    id_serial: '',
    ubicacion: '',
    coord_norte: '',
    coord_este: '',
    huso: '',
    tipo_sitio: 'pozo',
    activo: true,
    es_maleta_piloto: false,
    profundidad_pozo_m: '',
    profundidad_sensor_m: '',
    nivel_estatico_manual_m: '',
    obra_dga: '',
    slug: '',
  });
  variableForm = signal<VariableForm>({ ...DEFAULT_VARIABLE_FORM });

  allSubCompanies = computed<SubCompanyOption[]>(() =>
    this.hierarchy().flatMap((company) =>
      company.subCompanies.map((subCompany) => ({
        ...subCompany,
        companyName: company.nombre,
      })),
    ),
  );

  allSites = computed<SiteOption[]>(() =>
    this.hierarchy().flatMap((company) =>
      company.subCompanies.flatMap((subCompany) =>
        subCompany.sites.map((site) => ({
          ...site,
          companyName: company.nombre,
          subCompanyName: subCompany.nombre,
        })),
      ),
    ),
  );

  filteredCompanies = computed<CompanyNode[]>(() =>
    this.hierarchy().filter((company) =>
      this.matchesSearch(this.companySearch(), [
        company.nombre,
        company.rut,
        company.tipo_empresa,
        String(this.countCompanySites(company)),
      ]),
    ),
  );

  filteredSubCompanies = computed<SubCompanyOption[]>(() =>
    this.allSubCompanies().filter((subCompany) =>
      this.matchesSearch(this.subCompanySearch(), [
        subCompany.nombre,
        subCompany.rut,
        subCompany.companyName,
        String(subCompany.sites.length),
      ]),
    ),
  );

  filteredSites = computed<SiteOption[]>(() =>
    this.allSites().filter((site) =>
      this.matchesSearch(this.siteSearch(), [
        site.descripcion,
        site.id_serial,
        site.tipo_sitio,
        this.siteTypeLabel(site.tipo_sitio),
        site.companyName,
        site.subCompanyName,
        site.ubicacion || '',
        site.activo ? 'activo' : 'inactivo',
      ]),
    ),
  );

  filteredDevices = computed<DetectedDevice[]>(() =>
    this.detectedDevices().filter((device) =>
      this.matchesSearch(this.deviceSearch(), [
        device.id_serial,
        device.ultimo_registro,
        device.ultimo_registro_local || '',
        device.ultima_medicion || '',
        device.ultima_medicion_local || '',
        device.ultima_llegada || '',
        device.ultima_llegada_local || '',
        this.deviceClockSkewLabel(device),
        String(this.deviceDataCount(device)),
        String(device.total_registros),
        device.sitio_descripcion || '',
        device.empresa_nombre || '',
        device.sub_empresa_nombre || '',
      ]),
    ),
  );

  paginatedCompanies = computed<CompanyNode[]>(() =>
    this.paginate(this.filteredCompanies(), this.companyPage()),
  );

  paginatedSubCompanies = computed<SubCompanyOption[]>(() =>
    this.paginate(this.filteredSubCompanies(), this.subCompanyPage()),
  );

  paginatedSites = computed<SiteOption[]>(() =>
    this.paginate(this.filteredSites(), this.sitePage()),
  );

  paginatedDevices = computed<DetectedDevice[]>(() =>
    this.paginate(this.filteredDevices(), this.devicePage()),
  );

  selectedCompany = computed<CompanyNode | undefined>(() =>
    this.hierarchy().find((company) => company.id === this.selectedCompanyId()),
  );

  selectedSubCompany = computed<SubCompanyOption | undefined>(() =>
    this.allSubCompanies().find((subCompany) => subCompany.id === this.selectedSubCompanyId()),
  );

  selectedSite = computed<SiteOption | undefined>(() =>
    this.allSites().find((site) => site.id === this.selectedSiteId()),
  );

  subCompaniesForSiteForm = computed<SubCompanyOption[]>(() =>
    this.allSubCompanies().filter(
      (subCompany) => subCompany.empresa_id === this.siteForm().empresa_id,
    ),
  );

  siteTypeOptions = computed<SiteTypeCatalogItem[]>(() => Object.values(this.siteTypeCatalog()));

  selectedSiteCatalog = computed<SiteTypeCatalogItem>(() => {
    const type = this.siteVariables().site.tipo_sitio || this.siteForm().tipo_sitio || 'generico';
    return (
      this.siteTypeCatalog()[type] ||
      this.siteTypeCatalog()['generico'] ||
      DEFAULT_SITE_TYPE_CATALOG['generico']
    );
  });

  variableRoleOptions = computed<SiteTypeRoleOption[]>(() => this.selectedSiteCatalog().roles);

  variableTransformOptions = computed<SiteTypeTransformOption[]>(() =>
    this.selectedSiteCatalog().transforms.filter((transform) => transform.enabled !== false),
  );

  ngOnInit(): void {
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    // If a delete is mid-undo-window when the user navigates away, fire it
    // immediately. Otherwise the timer keeps running against a destroyed
    // component and the row stays locally hidden but un-deleted server-side.
    this.flushPendingDelete();
  }

  setSection(section: SectionId): void {
    this.activeSection.set(section);
  }

  loadDashboard(showLoader = true): void {
    if (showLoader) {
      this.loading.set(true);
      this.status.set({ type: '', message: '' });
    }

    forkJoin({
      hierarchy: this.api.getHierarchy(),
      devices: this.api.getDetectedDevices(500),
      catalog: this.api.getSiteTypeCatalog(),
    }).subscribe({
      next: ({ hierarchy, devices, catalog }) => {
        this.setHierarchy(hierarchy.ok ? hierarchy.data : []);
        this.detectedDevices.set(devices.ok ? devices.data : []);
        this.siteTypeCatalog.set(catalog.ok ? catalog.data : DEFAULT_SITE_TYPE_CATALOG);
        this.seedSelections();
        this.clampAllPages();
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.setError(this.errorMessage(err, 'No fue posible cargar administracion.'));
      },
    });
  }

  updateCompanyForm(field: keyof CompanyForm, value: string): void {
    this.companyForm.update((form) => ({
      ...form,
      [field]: field === 'rut' ? formatRutInput(value) : value,
    }));
  }

  updateSubCompanyForm(field: keyof SubCompanyForm, value: string): void {
    this.subCompanyForm.update((form) => ({
      ...form,
      [field]: field === 'rut' ? formatRutInput(value) : value,
    }));
  }

  updateSiteForm(field: keyof SiteForm, value: string): void {
    this.siteForm.update((form) => ({ ...form, [field]: value }));
  }

  updateSiteActive(value: string): void {
    this.siteForm.update((form) => ({ ...form, activo: value === 'true' }));
  }

  updateSiteMaletaPiloto(value: string): void {
    this.siteForm.update((form) => ({ ...form, es_maleta_piloto: value === 'true' }));
  }

  updateCompanySearch(value: string): void {
    this.companySearch.set(value);
    this.companyPage.set(1);
  }

  updateSubCompanySearch(value: string): void {
    this.subCompanySearch.set(value);
    this.subCompanyPage.set(1);
  }

  updateSiteSearch(value: string): void {
    this.siteSearch.set(value);
    this.sitePage.set(1);
  }

  updateDeviceSearch(value: string): void {
    this.deviceSearch.set(value);
    this.devicePage.set(1);
  }

  setPage(section: SectionId, page: number): void {
    const totalItems = this.sectionTotal(section);
    const nextPage = this.clampPage(page, totalItems);
    if (section === 'empresas') this.companyPage.set(nextPage);
    if (section === 'subempresas') this.subCompanyPage.set(nextPage);
    if (section === 'sitios') this.sitePage.set(nextPage);
    if (section === 'equipos') this.devicePage.set(nextPage);
  }

  cancelConfirmDialog(): void {
    if (this.busyAction()) return;
    this.confirmDialog.set(null);
  }

  confirmDialogAction(): void {
    const dialog = this.confirmDialog();
    if (!dialog) return;
    this.confirmDialog.set(null);
    dialog.onConfirm();
  }

  /** Closes the confirm dialog on Escape. No-op if no dialog is open. */
  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    if (this.confirmDialog()) this.cancelConfirmDialog();
  }

  private totalPages(totalItems: number): number {
    return Math.max(1, Math.ceil(totalItems / ADMIN_PAGE_SIZE));
  }

  companyFormDisabled(): boolean {
    return !!this.selectedCompanyId() && !this.companyEditMode();
  }

  subCompanyFormDisabled(): boolean {
    return !!this.selectedSubCompanyId() && !this.subCompanyEditMode();
  }

  siteFormDisabled(): boolean {
    return !!this.selectedSiteId() && !this.siteEditMode();
  }

  updateVariableForm(field: keyof VariableForm, value: string): void {
    this.variableForm.update((form) => ({ ...form, [field]: value }));
  }

  updateVariableRole(role: string): void {
    const nextRole = this.normalizeVariableRoleForForm(role);
    const roleOption = this.variableRoleOptions().find((item) => item.id === nextRole);

    this.variableForm.update((form) => ({
      ...form,
      rol_dashboard: nextRole,
      unidad: form.unidad || roleOption?.unitHint || '',
      transformacion: this.suggestTransformForRole(nextRole, form.transformacion),
    }));
  }

  selectVariableKey(d1: string): void {
    const selected = this.siteVariables().variables.find((variable) => variable.nombre_dato === d1);
    const nextRole = this.inferVariableRoleFromValues(
      this.variableForm().alias || selected?.nombre_dato,
      d1,
      this.variableForm().unidad,
    );
    const roleOption = this.variableRoleOptions().find((item) => item.id === nextRole);

    this.variableForm.update((form) => ({
      ...form,
      d1,
      alias: form.alias || selected?.nombre_dato || '',
      tipo_dato: form.tipo_dato || this.guessDataType(selected?.valor_dato ?? null),
      rol_dashboard: form.rol_dashboard === 'generico' ? nextRole : form.rol_dashboard,
      unidad: form.unidad || roleOption?.unitHint || '',
      transformacion: this.suggestTransformForRole(
        form.rol_dashboard === 'generico' ? nextRole : form.rol_dashboard,
        form.transformacion,
      ),
      sandboxRaw:
        selected?.valor_dato === null || selected?.valor_dato === undefined
          ? form.sandboxRaw
          : String(selected.valor_dato),
    }));
  }

  updateVariableTransform(transformacion: string): void {
    const normalizedTransform = this.normalizeVariableTransformForForm(transformacion);

    this.variableForm.update((form) => ({
      ...form,
      transformacion: normalizedTransform,
      factor: this.isLinearTransformValue(normalizedTransform) ? form.factor || '1' : '1',
      offset: this.isLinearTransformValue(normalizedTransform) ? form.offset || '0' : '0',
    }));
  }

  isLinearTransform(): boolean {
    return this.isLinearTransformValue(this.variableForm().transformacion);
  }

  requiresSecondRegister(): boolean {
    return this.selectedVariableTransform()?.requiresD2 === true;
  }

  selectedVariableRole(): SiteTypeRoleOption | undefined {
    return this.variableRoleOptions().find((role) => role.id === this.variableForm().rol_dashboard);
  }

  selectedVariableTransform(): SiteTypeTransformOption | undefined {
    return this.variableTransformOptions().find(
      (transform) => transform.id === this.variableForm().transformacion,
    );
  }

  previewResultText(): string {
    const form = this.variableForm();
    const rawText = String(form.sandboxRaw ?? '').trim();
    const unit = form.unidad ? ` ${form.unidad}` : '';

    if (!rawText) return 'Ingresa un valor crudo';

    if (this.isLinearTransformValue(form.transformacion)) {
      const raw = this.parsePreviewNumber(rawText);
      const factor = this.parsePreviewNumber(form.factor) ?? 1;
      const offset = this.parsePreviewNumber(form.offset) ?? 0;
      if (raw === null) return 'Valor crudo no numerico';
      return `${this.formatPreviewNumber(raw * factor + offset)}${unit}`;
    }

    if (form.transformacion === 'ieee754_32') {
      return form.d2 ? 'Se calculara con dos registros' : 'Selecciona segundo registro';
    }

    return `${rawText}${unit}`;
  }

  displayVariableTransform(transformacion: string | null | undefined): string {
    const normalized = this.normalizeVariableTransformForForm(transformacion);
    return this.findTransformOption(normalized)?.label || normalized;
  }

  submitCompany(event: Event): void {
    if (this.selectedCompanyId()) {
      this.saveSelectedCompany(event);
      return;
    }
    this.createCompany(event);
  }

  startCreateCompany(): void {
    this.selectedCompanyId.set('');
    this.companyEditMode.set(false);
    this.companyForm.set({ nombre: '', rut: '', tipo_empresa: 'Agua' });
  }

  selectCompany(companyId: string): void {
    const company = this.hierarchy().find((item) => item.id === companyId);
    if (!company) return;
    this.selectedCompanyId.set(company.id);
    this.companyEditMode.set(false);
    this.companyForm.set({
      nombre: company.nombre,
      rut: formatRutInput(company.rut),
      tipo_empresa: company.tipo_empresa || 'Agua',
    });
  }

  enableCompanyEdit(): void {
    if (!this.selectedCompanyId()) return;
    this.companyEditMode.set(true);
  }

  cancelCompanyEdit(): void {
    const selected = this.selectedCompanyId();
    this.companyEditMode.set(false);
    if (selected) this.selectCompany(selected);
  }

  createCompany(event: Event): void {
    event.preventDefault();
    this.busyAction.set('company');

    this.api.createCompany(this.companyForm()).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Empresa creada.');
        this.selectedCompanyId.set(res.data.id);
        this.companyEditMode.set(false);
        this.loadDashboard(false);
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible crear la empresa.'));
      },
    });
  }

  saveSelectedCompany(event?: Event): void {
    event?.preventDefault();
    const companyId = this.selectedCompanyId();
    if (!companyId) {
      this.setError('Selecciona una empresa.');
      return;
    }
    if (!this.companyEditMode()) {
      this.enableCompanyEdit();
      return;
    }
    this.confirmAdminAction({
      title: 'Actualizar empresa',
      message: 'Se guardaran los cambios de la empresa seleccionada.',
      confirmText: 'Actualizar',
      tone: 'primary',
      icon: 'save',
      onConfirm: () => {
        this.busyAction.set('company-update');
        this.api.updateCompany(companyId, this.companyForm()).subscribe({
          next: (res) => {
            this.busyAction.set('');
            this.companyEditMode.set(false);
            this.setSuccess(res.message || 'Empresa actualizada.');
            this.loadDashboard(false);
          },
          error: (err: unknown) => {
            this.busyAction.set('');
            this.setError(this.errorMessage(err, 'No fue posible actualizar la empresa.'));
          },
        });
      },
    });
  }

  deleteSelectedCompany(): void {
    const company = this.selectedCompany();
    if (!company) {
      this.setError('Selecciona una empresa.');
      return;
    }
    this.confirmAdminAction({
      title: 'Eliminar empresa',
      message: `Se eliminara ${company.nombre} junto a sus subempresas y sitios asociados.`,
      confirmText: 'Eliminar',
      tone: 'danger',
      icon: 'warning',
      onConfirm: () => {
        const previousHierarchy = this.hierarchy();
        this.setHierarchy(previousHierarchy.filter((item) => item.id !== company.id));
        this.selectedCompanyId.set('');
        this.companyEditMode.set(false);
        this.clampAllPages();

        this.schedulePendingDelete({
          label: `empresa "${company.nombre}"`,
          restore: () => {
            this.setHierarchy(previousHierarchy);
            this.selectCompany(company.id);
          },
          commit: () => {
            this.busyAction.set('company-delete');
            this.api.deleteCompany(company.id).subscribe({
              next: (res) => {
                this.busyAction.set('');
                this.setSuccess(res.message || 'Empresa eliminada.');
                this.loadDashboard(false);
              },
              error: (err: unknown) => {
                this.busyAction.set('');
                this.setHierarchy(previousHierarchy);
                this.selectCompany(company.id);
                this.setError(this.errorMessage(err, 'No fue posible eliminar la empresa.'));
              },
            });
          },
        });
      },
    });
  }

  submitSubCompany(event: Event): void {
    if (this.selectedSubCompanyId()) {
      this.saveSelectedSubCompany(event);
      return;
    }
    this.createSubCompany(event);
  }

  startCreateSubCompany(): void {
    const companyId = this.selectedCompanyId() || this.hierarchy()[0]?.id || '';
    this.selectedSubCompanyId.set('');
    this.subCompanyEditMode.set(false);
    this.subCompanyForm.set({ empresa_id: companyId, nombre: '', rut: '' });
  }

  selectSubCompany(subCompanyId: string): void {
    const subCompany = this.allSubCompanies().find((item) => item.id === subCompanyId);
    if (!subCompany) return;
    this.selectedSubCompanyId.set(subCompany.id);
    this.subCompanyEditMode.set(false);
    this.subCompanyForm.set({
      empresa_id: subCompany.empresa_id,
      nombre: subCompany.nombre,
      rut: formatRutInput(subCompany.rut),
    });
  }

  enableSubCompanyEdit(): void {
    if (!this.selectedSubCompanyId()) return;
    this.subCompanyEditMode.set(true);
  }

  cancelSubCompanyEdit(): void {
    const selected = this.selectedSubCompanyId();
    this.subCompanyEditMode.set(false);
    if (selected) this.selectSubCompany(selected);
  }

  createSubCompany(event: Event): void {
    event.preventDefault();
    const form = this.subCompanyForm();
    if (!form.empresa_id) {
      this.setError('Selecciona una empresa padre.');
      return;
    }

    this.busyAction.set('subcompany');
    this.api.createSubCompany(form.empresa_id, { nombre: form.nombre, rut: form.rut }).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Subempresa creada.');
        this.selectedSubCompanyId.set(res.data.id);
        this.subCompanyEditMode.set(false);
        this.loadDashboard(false);
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible crear la subempresa.'));
      },
    });
  }

  saveSelectedSubCompany(event?: Event): void {
    event?.preventDefault();
    const subCompany = this.selectedSubCompany();
    const form = this.subCompanyForm();
    if (!subCompany) {
      this.setError('Selecciona una subempresa.');
      return;
    }
    if (!this.subCompanyEditMode()) {
      this.enableSubCompanyEdit();
      return;
    }
    if (!form.empresa_id) {
      this.setError('Selecciona una empresa padre.');
      return;
    }
    this.confirmAdminAction({
      title: 'Actualizar subempresa',
      message: 'Se guardaran los cambios de la subempresa seleccionada.',
      confirmText: 'Actualizar',
      tone: 'primary',
      icon: 'save',
      onConfirm: () => {
        this.busyAction.set('subcompany-update');
        this.api
          .updateSubCompany(subCompany.empresa_id, subCompany.id, {
            empresa_id: form.empresa_id,
            nombre: form.nombre,
            rut: form.rut,
          })
          .subscribe({
            next: (res) => {
              this.busyAction.set('');
              this.selectedSubCompanyId.set(res.data.id);
              this.subCompanyEditMode.set(false);
              this.setSuccess(res.message || 'Subempresa actualizada.');
              this.loadDashboard(false);
            },
            error: (err: unknown) => {
              this.busyAction.set('');
              this.setError(this.errorMessage(err, 'No fue posible actualizar la subempresa.'));
            },
          });
      },
    });
  }

  deleteSelectedSubCompany(): void {
    const subCompany = this.selectedSubCompany();
    if (!subCompany) {
      this.setError('Selecciona una subempresa.');
      return;
    }
    this.confirmAdminAction({
      title: 'Eliminar subempresa',
      message: `Se eliminara ${subCompany.nombre} junto a sus sitios asociados.`,
      confirmText: 'Eliminar',
      tone: 'danger',
      icon: 'warning',
      onConfirm: () => {
        const previousHierarchy = this.hierarchy();
        this.setHierarchy(
          previousHierarchy.map((company) =>
            company.id === subCompany.empresa_id
              ? {
                  ...company,
                  subCompanies: company.subCompanies.filter((item) => item.id !== subCompany.id),
                }
              : company,
          ),
        );
        this.selectedSubCompanyId.set('');
        this.subCompanyEditMode.set(false);
        this.clampAllPages();

        this.schedulePendingDelete({
          label: `subempresa "${subCompany.nombre}"`,
          restore: () => {
            this.setHierarchy(previousHierarchy);
            this.selectSubCompany(subCompany.id);
          },
          commit: () => {
            this.busyAction.set('subcompany-delete');
            this.api.deleteSubCompany(subCompany.empresa_id, subCompany.id).subscribe({
              next: (res) => {
                this.busyAction.set('');
                this.setSuccess(res.message || 'Subempresa eliminada.');
                this.loadDashboard(false);
              },
              error: (err: unknown) => {
                this.busyAction.set('');
                this.setHierarchy(previousHierarchy);
                this.selectSubCompany(subCompany.id);
                this.setError(this.errorMessage(err, 'No fue posible eliminar la subempresa.'));
              },
            });
          },
        });
      },
    });
  }

  submitSite(event: Event): void {
    if (this.selectedSiteId()) {
      this.saveSelectedSite(event);
      return;
    }
    this.createSite(event);
  }

  startCreateSite(): void {
    const companyId = this.selectedCompanyId() || this.hierarchy()[0]?.id || '';
    const firstSubCompany = this.allSubCompanies().find(
      (subCompany) => subCompany.empresa_id === companyId,
    );
    this.selectedSiteId.set('');
    this.siteEditMode.set(false);
    this.siteVariables.set({
      site: this.emptySite(),
      pozo_config: null,
      variables: [],
      mappings: [],
    });
    this.siteForm.set({
      empresa_id: companyId,
      sub_empresa_id: firstSubCompany?.id || '',
      descripcion: '',
      id_serial: '',
      ubicacion: '',
      coord_norte: '',
      coord_este: '',
      huso: '',
      tipo_sitio: 'pozo',
      activo: true,
      es_maleta_piloto: false,
      profundidad_pozo_m: '',
      profundidad_sensor_m: '',
      nivel_estatico_manual_m: '',
      obra_dga: '',
      slug: '',
    });
  }

  createSite(event: Event): void {
    event.preventDefault();
    const form = this.siteForm();
    if (!form.empresa_id || !form.sub_empresa_id) {
      this.setError('Selecciona empresa y subempresa.');
      return;
    }

    this.busyAction.set('site');
    this.api
      .createSite(form.empresa_id, form.sub_empresa_id, {
        descripcion: form.descripcion,
        id_serial: form.id_serial,
        ubicacion: form.ubicacion || null,
        coord_norte: form.coord_norte !== '' ? Number(form.coord_norte) : null,
        coord_este: form.coord_este !== '' ? Number(form.coord_este) : null,
        huso: form.huso !== '' ? Number(form.huso) : null,
        tipo_sitio: form.tipo_sitio,
        activo: form.activo,
        es_maleta_piloto: form.es_maleta_piloto,
      })
      .subscribe({
        next: (res) => {
          this.busyAction.set('');
          this.setSuccess(res.message || 'Sitio creado.');
          this.selectedSiteId.set(res.data.id);
          this.siteEditMode.set(false);
          this.loadDashboard(false);
        },
        error: (err: unknown) => {
          this.busyAction.set('');
          this.setError(this.errorMessage(err, 'No fue posible crear el sitio.'));
        },
      });
  }

  saveSelectedSite(event?: Event): void {
    event?.preventDefault();
    const siteId = this.selectedSiteId();
    const form = this.siteForm();

    if (!siteId) {
      this.setError('Selecciona un sitio.');
      return;
    }
    if (!this.siteEditMode()) {
      this.enableSiteEdit();
      return;
    }
    if (!form.empresa_id || !form.sub_empresa_id) {
      this.setError('Selecciona empresa y subempresa.');
      return;
    }
    this.confirmAdminAction({
      title: 'Actualizar sitio',
      message: 'Se guardaran los cambios del sitio seleccionado.',
      confirmText: 'Actualizar',
      tone: 'primary',
      icon: 'save',
      onConfirm: () => {
        this.busyAction.set('site-update');
        this.api
          .updateSite(siteId, {
            empresa_id: form.empresa_id,
            sub_empresa_id: form.sub_empresa_id,
            descripcion: form.descripcion,
            id_serial: form.id_serial,
            ubicacion: form.ubicacion || null,
            coord_norte: form.coord_norte !== '' ? Number(form.coord_norte) : null,
            coord_este: form.coord_este !== '' ? Number(form.coord_este) : null,
            huso: form.huso !== '' ? Number(form.huso) : null,
            tipo_sitio: form.tipo_sitio,
            activo: form.activo,
            es_maleta_piloto: form.es_maleta_piloto,
          })
          .subscribe({
            next: (res) => {
              this.busyAction.set('');
              this.siteEditMode.set(false);
              this.setSuccess(res.message || 'Sitio actualizado.');
              this.loadDashboard(false);
            },
            error: (err: unknown) => {
              this.busyAction.set('');
              this.setError(this.errorMessage(err, 'No fue posible actualizar el sitio.'));
            },
          });
      },
    });
  }

  enableSiteEdit(): void {
    if (!this.selectedSiteId()) return;
    this.siteEditMode.set(true);
  }

  cancelSiteEdit(): void {
    const selected = this.selectedSiteId();
    this.siteEditMode.set(false);
    if (selected) this.selectSite(selected);
  }

  deleteSelectedSite(): void {
    const site = this.selectedSite();
    if (!site) {
      this.setError('Selecciona un sitio.');
      return;
    }
    this.confirmAdminAction({
      title: 'Eliminar sitio',
      message: `Se eliminara ${site.descripcion}. Esta accion no se puede deshacer.`,
      confirmText: 'Eliminar',
      tone: 'danger',
      icon: 'warning',
      onConfirm: () => {
        const previousHierarchy = this.hierarchy();
        this.setHierarchy(
          previousHierarchy.map((company) => ({
            ...company,
            subCompanies: company.subCompanies.map((subCompany) =>
              subCompany.id === site.sub_empresa_id
                ? {
                    ...subCompany,
                    sites: subCompany.sites.filter((item) => item.id !== site.id),
                  }
                : subCompany,
            ),
          })),
        );
        this.selectedSiteId.set('');
        this.siteEditMode.set(false);
        this.siteVariables.set({
          site: this.emptySite(),
          pozo_config: null,
          variables: [],
          mappings: [],
        });
        this.clampAllPages();

        this.schedulePendingDelete({
          label: `sitio "${site.descripcion}"`,
          restore: () => {
            this.setHierarchy(previousHierarchy);
            this.selectSite(site.id);
          },
          commit: () => {
            this.busyAction.set('site-delete');
            this.api.deleteSite(site.id).subscribe({
              next: (res) => {
                this.busyAction.set('');
                this.setSuccess(res.message || 'Sitio eliminado.');
                this.loadDashboard(false);
              },
              error: (err: unknown) => {
                this.busyAction.set('');
                this.setHierarchy(previousHierarchy);
                this.selectSite(site.id);
                this.setError(this.errorMessage(err, 'No fue posible eliminar el sitio.'));
              },
            });
          },
        });
      },
    });
  }

  selectCompanyForSite(companyId: string): void {
    const firstSubCompany = this.allSubCompanies().find(
      (subCompany) => subCompany.empresa_id === companyId,
    );
    this.siteForm.update((form) => ({
      ...form,
      empresa_id: companyId,
      sub_empresa_id: firstSubCompany?.id || '',
    }));
  }

  selectSite(siteId: string): void {
    this.selectedSiteId.set(siteId);
    this.siteEditMode.set(false);
    const site = this.allSites().find((item) => item.id === siteId);
    if (!site) {
      this.siteVariables.set({
        site: this.emptySite(),
        pozo_config: null,
        variables: [],
        mappings: [],
      });
      return;
    }

    this.siteForm.set({
      empresa_id: site.empresa_id,
      sub_empresa_id: site.sub_empresa_id,
      descripcion: site.descripcion,
      id_serial: site.id_serial,
      ubicacion: site.ubicacion || '',
      coord_norte: site.coord_norte != null ? String(site.coord_norte) : '',
      coord_este: site.coord_este != null ? String(site.coord_este) : '',
      huso: site.huso != null ? String(site.huso) : '',
      tipo_sitio: site.tipo_sitio || 'pozo',
      activo: site.activo !== false,
      es_maleta_piloto: site.es_maleta_piloto === true,
      profundidad_pozo_m: '',
      profundidad_sensor_m: '',
      nivel_estatico_manual_m: '',
      obra_dga: '',
      slug: '',
    });
    this.loadSiteVariables(siteId);
  }

  loadSiteVariables(siteId: string): void {
    if (!siteId) return;

    this.api.getSiteVariables(siteId).subscribe({
      next: (res) => {
        if (res.ok) {
          this.siteVariables.set(res.data);
          this.patchPozoConfigForm(res.data.pozo_config);
        }
      },
      error: (err: unknown) =>
        this.setError(this.errorMessage(err, 'No fue posible cargar variables.')),
    });
  }

  useDeviceInSiteForm(device: DetectedDevice): void {
    this.activeSection.set('sitios');
    this.startCreateSite();
    this.siteForm.update((form) => ({ ...form, id_serial: device.id_serial }));
  }

  assignDeviceToSelectedSite(device: DetectedDevice): void {
    const siteId = this.selectedSiteId();
    if (!siteId) {
      this.setError('Selecciona un sitio.');
      return;
    }

    this.busyAction.set('assign-device');
    this.api.updateSite(siteId, { id_serial: device.id_serial }).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Equipo asignado.');
        this.loadDashboard(false);
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible asignar el equipo.'));
      },
    });
  }

  prepareVariableMap(variable: SiteVariable): void {
    const params = variable.mapping?.parametros || null;

    this.variableForm.set({
      mapId: variable.mapping?.id || '',
      alias: variable.mapping?.alias || variable.nombre_dato,
      d1: variable.nombre_dato,
      d2: variable.mapping?.d2 || '',
      tipo_dato: variable.mapping?.tipo_dato || this.guessDataType(variable.valor_dato),
      unidad: variable.mapping?.unidad || '',
      rol_dashboard: this.normalizeVariableRoleForForm(variable.mapping?.rol_dashboard),
      transformacion: this.normalizeVariableTransformForForm(variable.mapping?.transformacion),
      factor: this.configNumberToString(params?.factor) || '1',
      offset: this.configNumberToString(params?.offset) || '0',
      sandboxRaw:
        variable.valor_dato === null || variable.valor_dato === undefined
          ? ''
          : String(variable.valor_dato),
    });
  }

  createVariableMap(event: Event): void {
    event.preventDefault();
    const siteId = this.selectedSiteId();
    if (!siteId) {
      this.setError('Selecciona un sitio.');
      return;
    }

    const payload: CreateVariableMapPayload = {
      alias: this.variableForm().alias,
      d1: this.variableForm().d1,
      d2: this.variableForm().d2 || null,
      tipo_dato: this.variableForm().tipo_dato,
      unidad: this.variableForm().unidad || null,
      rol_dashboard: this.normalizeVariableRoleForForm(this.variableForm().rol_dashboard),
      transformacion: this.normalizeVariableTransformForForm(this.variableForm().transformacion),
      parametros: this.buildVariableParameters(),
    };

    this.busyAction.set('variable');
    const request$ = this.variableForm().mapId
      ? this.api.updateSiteVariableMap(siteId, this.variableForm().mapId, payload)
      : this.api.createSiteVariableMap(siteId, payload);

    request$.subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Variable guardada.');
        this.variableForm.set({ ...DEFAULT_VARIABLE_FORM });
        this.loadSiteVariables(siteId);
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible guardar la variable.'));
      },
    });
  }

  deleteVariableMap(mapping: VariableMapping): void {
    const siteId = this.selectedSiteId();
    if (!siteId) return;

    this.busyAction.set('delete-variable');
    this.api.deleteSiteVariableMap(siteId, mapping.id).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Variable eliminada.');
        this.loadSiteVariables(siteId);
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible eliminar la variable.'));
      },
    });
  }

  openSite(site: SiteRecord): void {
    this.router.navigate(dashboardRouteForSite(site));
  }

  countCompanySites(company: CompanyNode): number {
    return company.subCompanies.reduce((total, subCompany) => total + subCompany.sites.length, 0);
  }

  displayValue(value: SiteVariable['valor_dato']): string {
    if (value === null || value === undefined) return '-';
    return String(value);
  }

  siteTypeLabel(type: string): string {
    return getSiteTypeUi(type).label;
  }

  siteTypeBadgeClass(type: string): string {
    const base = 'rounded-md px-2 py-1 text-caption font-bold';
    return `${base} ${getSiteTypeUi(type).badgeClass}`;
  }

  statusBadgeClass(tone: 'success' | 'warning' | 'neutral'): string {
    const base = 'rounded-md px-2 py-1 text-caption font-bold';
    if (tone === 'success') return `${base} bg-emerald-50 text-emerald-700`;
    if (tone === 'warning') return `${base} bg-amber-50 text-amber-700`;
    return `${base} bg-slate-100 text-slate-500`;
  }

  companyTypeBadgeClass(type: string): string {
    const base = 'rounded-md px-2 py-1 text-caption font-semibold';
    const normalized = this.normalizeSearchText(type);
    if (normalized.includes('electrico')) return `${base} bg-amber-50 text-amber-700`;
    if (normalized.includes('industrial')) return `${base} bg-indigo-50 text-indigo-700`;
    if (normalized.includes('riles')) return `${base} bg-emerald-50 text-emerald-700`;
    if (normalized.includes('proceso')) return `${base} bg-accent/10 text-accent-container`;
    if (normalized.includes('cliente')) return `${base} bg-slate-100 text-slate-600`;
    return `${base} bg-primary-tint-10 text-primary-container`;
  }

  deviceDataCount(device: DetectedDevice): number {
    return Number(device.total_datos ?? 0);
  }

  deviceDataCountLabel(device: DetectedDevice): string {
    if (device.total_datos === undefined || device.total_datos === null) return 'No disponible';
    const count = this.deviceDataCount(device);
    return `${count} ${count === 1 ? 'dato' : 'datos'}`;
  }

  deviceMeasurementLabel(device: DetectedDevice): string {
    return (
      this.deviceDateLabel(device.ultima_medicion_local, device.ultima_medicion) ||
      this.deviceLastSeenLabel(device)
    );
  }

  deviceArrivalLabel(device: DetectedDevice): string {
    return (
      this.deviceDateLabel(device.ultima_llegada_local, device.ultima_llegada) ||
      this.deviceLastSeenLabel(device)
    );
  }

  deviceClockSkewLabel(device: DetectedDevice): string {
    const seconds = this.deviceClockSkewSeconds(device);
    if (seconds === null) return 'Sin llegada';
    if (seconds === 0) return 'Sin desfase';

    const absLabel = this.formatDurationLabel(Math.abs(seconds));
    if (seconds > 0) return `Adelantado ${absLabel}`;
    if (Math.abs(seconds) >= 86400) return 'Carga histórica';
    return `Llegada +${absLabel}`;
  }

  deviceClockSkewTitle(device: DetectedDevice): string {
    return [
      `Medición: ${this.deviceMeasurementLabel(device)}`,
      `Llegada BD: ${this.deviceArrivalLabel(device)}`,
      `Estado: ${this.deviceClockSkewLabel(device)}`,
    ].join(' | ');
  }

  deviceClockSkewIcon(device: DetectedDevice): string {
    const tone = this.deviceClockSkewTone(device);
    if (tone === 'danger') return 'error';
    if (tone === 'warning') return 'schedule';
    if (tone === 'ok') return 'check_circle';
    return 'history';
  }

  deviceClockSkewBadgeClass(device: DetectedDevice): string {
    return `device-skew-badge device-skew-${this.deviceClockSkewTone(device)}`;
  }

  deviceLastSeenLabel(device: DetectedDevice): string {
    if (device.ultimo_registro_local)
      return this.readableDeviceDateTime(device.ultimo_registro_local);

    const date = new Date(device.ultimo_registro);
    if (Number.isNaN(date.getTime())) return device.ultimo_registro || 'Sin registro';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'Etc/GMT+4',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(',', '');
  }

  private deviceClockSkewSeconds(device: DetectedDevice): number | null {
    if (device.desfase_segundos !== undefined && device.desfase_segundos !== null) {
      const direct = Number(device.desfase_segundos);
      if (Number.isFinite(direct)) return Math.round(direct);
    }

    const measuredMs = this.deviceTimestampMs(device.ultima_medicion);
    const receivedMs = this.deviceTimestampMs(device.ultima_llegada);
    if (measuredMs === null || receivedMs === null) return null;
    return Math.round((measuredMs - receivedMs) / 1000);
  }

  private deviceClockSkewTone(device: DetectedDevice): 'ok' | 'warning' | 'danger' | 'neutral' {
    const seconds = this.deviceClockSkewSeconds(device);
    if (seconds === null) return 'neutral';
    if (seconds < -86400) return 'neutral';
    if (seconds > 120) return 'danger';
    if (seconds > 30 || seconds < -600) return 'warning';
    return 'ok';
  }

  private deviceDateLabel(localValue?: string | null, utcValue?: string | null): string | null {
    if (localValue) return this.readableDeviceDateTime(localValue);

    const date = utcValue ? new Date(utcValue) : null;
    if (!date || Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'Etc/GMT+4',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(',', '');
  }

  private deviceTimestampMs(value?: string | null): number | null {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  private formatDurationLabel(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    if (minutes < 60) {
      return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) {
      return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
    }

    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days}d ${restHours}h` : `${days}d`;
  }

  private readableDeviceDateTime(value: string): string {
    const cleaned = value.trim();
    const isoLike = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
    if (isoLike) return `${isoLike[3]}-${isoLike[2]}-${isoLike[1]} ${isoLike[4]}`;
    return cleaned.replace(',', '');
  }

  sectionButtonClass(section: SectionId): string {
    const base = `section-tab-button section-tab-${section}`;
    return this.activeSection() === section ? `${base} section-tab-active` : base;
  }

  rowClass(selected: boolean): string {
    const base = 'cursor-pointer transition-colors';
    return selected
      ? `${base} bg-primary-tint-08 shadow-[inset_3px_0_0_var(--color-primary)]`
      : `${base} bg-white hover:bg-surface-subtle`;
  }

  statusClass(): string {
    const base = 'flex items-center gap-2 rounded-lg border px-4 py-3 text-body-sm font-bold';
    return this.status().type === 'success'
      ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
      : `${base} border-red-200 bg-red-50 text-red-700`;
  }

  private paginate<T>(items: T[], page: number): T[] {
    const currentPage = this.clampPage(page, items.length);
    const start = (currentPage - 1) * ADMIN_PAGE_SIZE;
    return items.slice(start, start + ADMIN_PAGE_SIZE);
  }

  private clampPage(page: number, totalItems: number): number {
    const total = this.totalPages(totalItems);
    const normalized = Number.isFinite(page) ? Math.trunc(page) : 1;
    return Math.min(Math.max(normalized, 1), total);
  }

  private sectionTotal(section: SectionId): number {
    if (section === 'empresas') return this.filteredCompanies().length;
    if (section === 'subempresas') return this.filteredSubCompanies().length;
    if (section === 'sitios') return this.filteredSites().length;
    return this.filteredDevices().length;
  }

  private clampAllPages(): void {
    this.companyPage.set(this.clampPage(this.companyPage(), this.filteredCompanies().length));
    this.subCompanyPage.set(
      this.clampPage(this.subCompanyPage(), this.filteredSubCompanies().length),
    );
    this.sitePage.set(this.clampPage(this.sitePage(), this.filteredSites().length));
    this.devicePage.set(this.clampPage(this.devicePage(), this.filteredDevices().length));
  }

  private setHierarchy(hierarchy: CompanyNode[]): void {
    const formattedHierarchy = hierarchy.map((company) => ({
      ...company,
      rut: formatRutInput(company.rut),
      subCompanies: company.subCompanies.map((subCompany) => ({
        ...subCompany,
        rut: formatRutInput(subCompany.rut),
      })),
    }));

    this.hierarchy.set(formattedHierarchy);
    this.companyService.hierarchy.set(formattedHierarchy);
  }

  private seedSelections(): void {
    const firstCompany = this.hierarchy()[0];
    const currentCompanyExists = this.hierarchy().some(
      (company) => company.id === this.selectedCompanyId(),
    );
    const companyId = currentCompanyExists ? this.selectedCompanyId() : firstCompany?.id || '';
    const firstSubCompany = this.allSubCompanies().find(
      (subCompany) => subCompany.empresa_id === companyId,
    );
    const currentSubCompanyExists = this.allSubCompanies().some(
      (subCompany) => subCompany.id === this.selectedSubCompanyId(),
    );
    const subCompanyId = currentSubCompanyExists
      ? this.selectedSubCompanyId()
      : firstSubCompany?.id || '';
    const currentSiteExists = this.allSites().some((site) => site.id === this.selectedSiteId());

    this.selectedCompanyId.set(companyId);
    if (companyId) this.selectCompany(companyId);
    this.selectedSubCompanyId.set(subCompanyId);
    if (subCompanyId) this.selectSubCompany(subCompanyId);
    this.subCompanyForm.update((form) => ({ ...form, empresa_id: form.empresa_id || companyId }));
    this.siteForm.update((form) => ({
      ...form,
      empresa_id: form.empresa_id || companyId,
      sub_empresa_id: form.sub_empresa_id || firstSubCompany?.id || '',
    }));

    if (!currentSiteExists) {
      const firstSite = this.allSites()[0];
      this.selectedSiteId.set(firstSite?.id || '');
    }

    if (this.selectedSiteId()) {
      this.selectSite(this.selectedSiteId());
    }
  }

  private guessDataType(value: SiteVariable['valor_dato']): string {
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'FLOAT';
    return 'TEXT';
  }

  private setSuccess(message: string): void {
    this.status.set({ type: 'success', message });
  }

  private setError(message: string): void {
    this.status.set({ type: 'error', message });
  }

  /**
   * Stages a destructive action with a 5s undo window. The optimistic UI
   * mutation has already been applied by the caller; we keep the rollback
   * (`restore`) and the real API trigger (`commit`) so the user can change
   * their mind in the brief window before commit fires.
   */
  private schedulePendingDelete(opts: {
    label: string;
    restore: () => void;
    commit: () => void;
  }): void {
    // If another delete is mid-window, commit it now so we don't lose it
    // when we overwrite the signal below.
    this.flushPendingDelete();

    const totalMs = 5000;
    const tickMs = 100;

    const timerId = window.setTimeout(() => {
      const pending = this.pendingDelete();
      if (!pending) return;
      window.clearInterval(pending.countdownTimerId);
      this.pendingDelete.set(null);
      this.pendingDeleteCountdown.set(0);
      pending.commit();
    }, totalMs);

    const countdownTimerId = window.setInterval(() => {
      const pending = this.pendingDelete();
      if (!pending) return;
      const next = Math.max(0, pending.remainingMs - tickMs);
      this.pendingDelete.set({ ...pending, remainingMs: next });
      this.pendingDeleteCountdown.set(Math.ceil(next / 1000));
    }, tickMs);

    this.pendingDelete.set({
      label: opts.label,
      restore: opts.restore,
      commit: opts.commit,
      timerId,
      countdownTimerId,
      remainingMs: totalMs,
    });
    this.pendingDeleteCountdown.set(5);
  }

  /** User clicked "Deshacer": stop the timer + roll back the optimistic UI. */
  undoPendingDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    window.clearInterval(pending.countdownTimerId);
    pending.restore();
    this.pendingDelete.set(null);
    this.pendingDeleteCountdown.set(0);
    this.setSuccess(`Eliminación cancelada (${pending.label}).`);
  }

  /**
   * Forces the pending delete to fire its commit *now*. Used when navigating
   * away or queueing another delete — otherwise the page could leave behind a
   * dangling timer firing against a stale snapshot.
   */
  private flushPendingDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    window.clearInterval(pending.countdownTimerId);
    this.pendingDelete.set(null);
    this.pendingDeleteCountdown.set(0);
    pending.commit();
  }

  private confirmAdminAction(
    dialog: Omit<ConfirmDialog, 'cancelText'> & { cancelText?: string },
  ): void {
    this.confirmDialog.set({
      cancelText: 'Cancelar',
      ...dialog,
    });
  }

  private matchesSearch(query: string, values: (string | number | null | undefined)[]): boolean {
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const haystack = this.normalizeSearchText(...values.map((value) => String(value ?? '')));
    return normalizedQuery
      .split(' ')
      .filter(Boolean)
      .every((part) => haystack.includes(part));
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error as { message?: string; error?: string } | string | undefined;
      if (typeof payload === 'string') return payload;
      return payload?.message || payload?.error || fallback;
    }

    return fallback;
  }

  private emptySite(): SiteRecord {
    return {
      id: '',
      descripcion: '',
      empresa_id: '',
      sub_empresa_id: '',
      id_serial: '',
      ubicacion: '',
      tipo_sitio: 'pozo',
      activo: true,
    };
  }

  private buildPozoConfigPayload(): PozoConfig | null {
    if (this.siteForm().tipo_sitio !== 'pozo') return null;

    return {
      profundidad_pozo_m: this.numberOrNull(this.siteForm().profundidad_pozo_m),
      profundidad_sensor_m: this.numberOrNull(this.siteForm().profundidad_sensor_m),
    };
  }

  private buildVariableParameters(): NonNullable<CreateVariableMapPayload['parametros']> {
    const form = this.variableForm();

    if (this.transformUsesLinearParameters(form.transformacion)) {
      return {
        factor: this.numberOrNull(form.factor) ?? 1,
        offset: this.numberOrNull(form.offset) ?? 0,
      };
    }

    return {};
  }

  private inferVariableRoleFromValues(...values: (string | null | undefined)[]): string {
    const text = this.normalizeSearchText(...values);
    const availableRoles = new Set(this.variableRoleOptions().map((role) => role.id));

    if (text.includes('freatico') && availableRoles.has('nivel')) return 'nivel';
    if (
      (text.includes('nivel') || text.includes('level') || text.includes('sonda')) &&
      availableRoles.has('nivel')
    )
      return 'nivel';
    if (
      (text.includes('caudal') || text.includes('l s') || text.includes('lps')) &&
      availableRoles.has('caudal')
    )
      return 'caudal';
    if (
      text.includes('totalizador') ||
      text.includes('totalizado') ||
      text.includes('acumulado') ||
      text.includes('volumen')
    ) {
      return availableRoles.has('totalizador') ? 'totalizador' : 'generico';
    }
    if (
      (text.includes('senal') ||
        text.includes('signal') ||
        text.includes('rssi') ||
        text.includes('csq')) &&
      availableRoles.has('señal')
    )
      return 'señal';

    return 'generico';
  }

  private patchPozoConfigForm(config: PozoConfig | null): void {
    this.siteForm.update((form) => ({
      ...form,
      profundidad_pozo_m: this.configNumberToString(config?.profundidad_pozo_m),
      profundidad_sensor_m: this.configNumberToString(config?.profundidad_sensor_m),
      nivel_estatico_manual_m: this.configNumberToString(config?.nivel_estatico_manual_m),
      obra_dga: config?.obra_dga || '',
      slug: config?.slug || '',
    }));
  }

  private isLinearTransformValue(transformacion: string): boolean {
    return this.transformUsesLinearParameters(transformacion);
  }

  private normalizeVariableTransformForForm(transformacion: string | null | undefined): string {
    if (transformacion === 'lineal' || transformacion === 'escala_lineal') return 'lineal';
    if (transformacion === 'ieee754' || transformacion === 'ieee754_32') return 'ieee754_32';
    if (
      transformacion === 'caudal' ||
      transformacion === 'caudal_m3h_lps' ||
      transformacion === 'nivel_freatico'
    )
      return 'lineal';
    return 'directo';
  }

  private normalizeVariableRoleForForm(role: string | null | undefined): string {
    const normalizedInput = String(role ?? '')
      .trim()
      .toLowerCase();
    const normalized =
      normalizedInput === 'nivel_freatico' ? 'nivel' : normalizedInput || 'generico';
    return this.variableRoleOptions().some((option) => option.id === normalized)
      ? normalized
      : 'generico';
  }

  private suggestTransformForRole(role: string, currentTransform: string): string {
    const current = this.normalizeVariableTransformForForm(currentTransform);
    if (current !== 'directo') return current;
    return current;
  }

  private transformUsesLinearParameters(transformacion: string): boolean {
    return transformacion === 'lineal';
  }

  private findTransformOption(transformacion: string): SiteTypeTransformOption | undefined {
    const normalized = this.normalizeVariableTransformForForm(transformacion);
    return this.variableTransformOptions().find((option) => option.id === normalized);
  }

  private normalizeSearchText(...values: (string | null | undefined)[]): string {
    return values
      .map((value) => String(value ?? '').trim())
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private parsePreviewNumber(value: string): number | null {
    const normalized = String(value ?? '')
      .trim()
      .replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatPreviewNumber(value: number): string {
    if (!Number.isFinite(value)) return 'No calculable';
    const rounded = Math.round(value * 1000) / 1000;
    return Number.isInteger(rounded)
      ? String(rounded)
      : String(rounded)
          .replace(/(\.\d*?)0+$/, '$1')
          .replace(/\.$/, '');
  }

  private numberOrNull(value: string): number | null {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private configNumberToString(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }
}
