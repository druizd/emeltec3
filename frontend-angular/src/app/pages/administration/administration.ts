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
  DetectedDevice,
  PozoConfig,
  SiteRecord,
  SiteTypeCatalogItem,
  SiteTypeCatalogResponse,
  SiteVariablesPayload,
  SubCompanyNode,
} from '../../services/administration.service';
import { CompanyService } from '../../services/company.service';
import { KpiCardComponent } from '../../components/ui/kpi-card';
import { dashboardRouteForSite } from '../../shared/site-type-ui';
import { formatRutInput } from '../../shared/rut';
import { AdminSectionShellComponent } from './components/admin-section-shell';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { TableSkeletonComponent } from '../../components/ui/table-skeleton';
import { EquipoEmeltecSectionComponent } from './components/equipo-emeltec-section';
import { EquiposSectionComponent } from './components/equipos-section';
import { EmpresasSectionComponent } from './components/empresas-section';
import { SubempresasSectionComponent } from './components/subempresas-section';
import { SitiosSectionComponent } from './components/sitios-section';
import { AlertasCorreoSectionComponent } from './components/alertas-correo-section';
import { DEFAULT_SITE_TYPE_CATALOG } from './site-type-catalog';

type SectionId =
  | 'empresas'
  | 'subempresas'
  | 'sitios'
  | 'equipos'
  | 'equipo-emeltec'
  | 'alertas-correo';
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

@Component({
  selector: 'app-administration',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    A11yModule,
    KpiCardComponent,
    AdminSectionShellComponent,
    SkeletonComponent,
    TableSkeletonComponent,
    EquipoEmeltecSectionComponent,
    EquiposSectionComponent,
    EmpresasSectionComponent,
    SubempresasSectionComponent,
    SitiosSectionComponent,
    AlertasCorreoSectionComponent,
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
              class="flex h-full min-h-[64px] w-full items-center justify-center rounded-xl border border-surface-container bg-white text-on-surface-variant transition hover:border-primary-tint-30 hover:text-primary-container hover:shadow-primary-glow active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-[56px]"
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
            <span class="material-symbols-outlined text-[19px]" aria-hidden="true">{{
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
              <span class="material-symbols-outlined text-[19px]" aria-hidden="true">schedule</span>
              <span class="truncate">
                Eliminando {{ pending.label }} en {{ pendingDeleteCountdown() }}s…
              </span>
            </div>
            <button
              type="button"
              (click)="undoPendingDelete()"
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-caption font-semibold text-amber-800 transition-colors hover:bg-amber-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span class="material-symbols-outlined text-[16px]" aria-hidden="true">undo</span>
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
                  aria-hidden="true"
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
                  <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{
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
                [attr.aria-current]="activeSection() === item.id ? 'page' : null"
              >
                <span class="material-symbols-outlined text-[21px]" aria-hidden="true">{{
                  item.icon
                }}</span>
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
                <app-empresas-section
                  [companies]="hierarchy()"
                  [selectedId]="selectedCompanyId()"
                  [editMode]="companyEditMode()"
                  [busyAction]="busyAction()"
                  [nombre]="companyForm().nombre"
                  [rut]="companyForm().rut"
                  [tipoEmpresa]="companyForm().tipo_empresa"
                  (formSubmit)="submitCompany($event)"
                  (selectItem)="selectCompany($event)"
                  (enableEdit)="enableCompanyEdit()"
                  (cancelEdit)="cancelCompanyEdit()"
                  (remove)="deleteSelectedCompany()"
                  (createNew)="startCreateCompany()"
                  (nombreChange)="updateCompanyForm('nombre', $event)"
                  (rutChange)="updateCompanyForm('rut', $event)"
                  (tipoEmpresaChange)="updateCompanyForm('tipo_empresa', $event)"
                />
              }

              @if (activeSection() === 'subempresas') {
                <app-subempresas-section
                  [subCompanies]="allSubCompanies()"
                  [companies]="hierarchy()"
                  [selectedId]="selectedSubCompanyId()"
                  [editMode]="subCompanyEditMode()"
                  [busyAction]="busyAction()"
                  [empresaId]="subCompanyForm().empresa_id"
                  [nombre]="subCompanyForm().nombre"
                  [rut]="subCompanyForm().rut"
                  (formSubmit)="submitSubCompany($event)"
                  (selectItem)="selectSubCompany($event)"
                  (enableEdit)="enableSubCompanyEdit()"
                  (cancelEdit)="cancelSubCompanyEdit()"
                  (remove)="deleteSelectedSubCompany()"
                  (createNew)="startCreateSubCompany()"
                  (empresaIdChange)="updateSubCompanyForm('empresa_id', $event)"
                  (nombreChange)="updateSubCompanyForm('nombre', $event)"
                  (rutChange)="updateSubCompanyForm('rut', $event)"
                />
              }

              @if (activeSection() === 'sitios') {
                <app-sitios-section
                  [sites]="allSites()"
                  [companies]="hierarchy()"
                  [subCompaniesForForm]="subCompaniesForSiteForm()"
                  [siteTypeOptions]="siteTypeOptions()"
                  [selectedId]="selectedSiteId()"
                  [editMode]="siteEditMode()"
                  [busyAction]="busyAction()"
                  [selectedSiteUbicacion]="selectedSite()?.ubicacion"
                  [empresaId]="siteForm().empresa_id"
                  [subEmpresaId]="siteForm().sub_empresa_id"
                  [tipoSitio]="siteForm().tipo_sitio"
                  [activo]="siteForm().activo"
                  [esMaletaPiloto]="siteForm().es_maleta_piloto"
                  [descripcion]="siteForm().descripcion"
                  [idSerial]="siteForm().id_serial"
                  [ubicacion]="siteForm().ubicacion"
                  [coordNorte]="siteForm().coord_norte"
                  [coordEste]="siteForm().coord_este"
                  [huso]="siteForm().huso"
                  (formSubmit)="submitSite($event)"
                  (selectItem)="selectSite($event)"
                  (enableEdit)="enableSiteEdit()"
                  (cancelEdit)="cancelSiteEdit()"
                  (remove)="deleteSelectedSite()"
                  (createNew)="startCreateSite()"
                  (empresaIdChange)="selectCompanyForSite($event)"
                  (subEmpresaIdChange)="updateSiteForm('sub_empresa_id', $event)"
                  (tipoSitioChange)="updateSiteForm('tipo_sitio', $event)"
                  (activoChange)="updateSiteActive($event)"
                  (esMaletaPilotoChange)="updateSiteMaletaPiloto($event)"
                  (descripcionChange)="updateSiteForm('descripcion', $event)"
                  (idSerialChange)="updateSiteForm('id_serial', $event)"
                  (ubicacionChange)="updateSiteForm('ubicacion', $event)"
                  (coordNorteChange)="updateSiteForm('coord_norte', $event)"
                  (coordEsteChange)="updateSiteForm('coord_este', $event)"
                  (husoChange)="updateSiteForm('huso', $event)"
                />
              }

              @if (activeSection() === 'equipos') {
                <app-equipos-section [devices]="detectedDevices()" (refresh)="loadDashboard()" />
              }

              @if (activeSection() === 'equipo-emeltec') {
                <app-admin-section-shell title="Equipo Emeltec">
                  <app-equipo-emeltec-section />
                </app-admin-section-shell>
              }

              @if (activeSection() === 'alertas-correo') {
                <app-admin-section-shell title="Alertas por correo">
                  <app-alertas-correo-section />
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
    { id: 'alertas-correo', icon: 'mark_email_unread', label: 'Alertas por correo' },
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

  openSite(site: SiteRecord): void {
    this.router.navigate(dashboardRouteForSite(site));
  }

  sectionButtonClass(section: SectionId): string {
    const base = `section-tab-button section-tab-${section}`;
    return this.activeSection() === section ? `${base} section-tab-active` : base;
  }

  statusClass(): string {
    const base = 'flex items-center gap-2 rounded-lg border px-4 py-3 text-body-sm font-bold';
    return this.status().type === 'success'
      ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
      : `${base} border-red-200 bg-red-50 text-red-700`;
  }

  // Paginación de sitios delegada al hijo SitiosSectionComponent.
  private clampAllPages(): void {
    // No-op: cada sección hija maneja su propia paginación.
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

  private configNumberToString(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }
}
