import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type {
  CompanyNode,
  SiteRecord,
  SiteTypeCatalogItem,
} from '../../../services/administration.service';
import type { SubCompanyOption } from './subempresas-section';
import { AdminSectionShellComponent } from './admin-section-shell';
import { AdminSectionHeaderComponent } from './admin-section-header';
import { AdminFormActionsComponent } from './admin-form-actions';
import { AdminTableToolbarComponent } from './admin-table-toolbar';
import { AdminPaginationComponent } from './admin-pagination';
import { getSiteTypeUi } from '../../../shared/site-type-ui';

const PAGE_SIZE = 10;

/** SiteRecord enriquecida con nombres de empresa y subempresa. */
export interface SiteOption extends SiteRecord {
  companyName: string;
  subCompanyName: string;
}

export type { SubCompanyOption };

/**
 * Sección "Sitios" de /administration.
 * Gestiona el formulario CRUD de sitios y su tabla paginada.
 * El estado del formulario y la selección viven en el padre;
 * los campos se pasan como inputs individuales.
 */
@Component({
  selector: 'app-sitios-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    AdminSectionShellComponent,
    AdminSectionHeaderComponent,
    AdminFormActionsComponent,
    AdminTableToolbarComponent,
    AdminPaginationComponent,
  ],
  template: `
    <app-admin-section-shell title="Sitios">
      <form (submit)="formSubmit.emit($event)" class="editor-panel grid gap-4 lg:grid-cols-4">
        <div class="lg:col-span-4">
          <app-admin-section-header
            [selected]="!!selectedId()"
            selectedLabel="Sitio seleccionado"
            newLabel="Nuevo sitio"
            selectedHint="Selecciona editar datos para modificar este sitio."
            newHint="Completa los datos para crear un sitio."
            buttonLabel="Nuevo"
            (createNew)="createNew.emit()"
          ></app-admin-section-header>
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Empresa padre</label>
          <select
            required
            [disabled]="formDisabled()"
            name="site-company"
            [ngModel]="empresaId()"
            (ngModelChange)="empresaIdChange.emit($event)"
            class="field-control"
          >
            <option value="" disabled>Selecciona empresa</option>
            @for (company of companies(); track company.id) {
              <option [value]="company.id">{{ company.nombre }}</option>
            }
          </select>
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Subempresa</label>
          <select
            required
            [disabled]="formDisabled()"
            name="site-subcompany"
            [ngModel]="subEmpresaId()"
            (ngModelChange)="subEmpresaIdChange.emit($event)"
            class="field-control"
          >
            <option value="" disabled>Selecciona subempresa</option>
            @for (sub of subCompaniesForForm(); track sub.id) {
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
            [disabled]="formDisabled()"
            [ngModel]="tipoSitio()"
            (ngModelChange)="tipoSitioChange.emit($event)"
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
            [disabled]="formDisabled()"
            [ngModel]="activo() ? 'true' : 'false'"
            (ngModelChange)="activoChange.emit($event)"
            class="field-control"
          >
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Maleta Piloto</label>
          <select
            name="site-maleta-piloto"
            [disabled]="formDisabled()"
            [ngModel]="esMaletaPiloto() ? 'true' : 'false'"
            (ngModelChange)="esMaletaPilotoChange.emit($event)"
            class="field-control"
          >
            <option value="false">No</option>
            <option value="true">Sí — mostrar en Maletas Pilotos</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Nombre del sitio</label>
          <input
            required
            [disabled]="formDisabled()"
            name="site-description"
            [ngModel]="descripcion()"
            (ngModelChange)="descripcionChange.emit($event)"
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
            [disabled]="formDisabled()"
            name="site-serial"
            [ngModel]="idSerial()"
            (ngModelChange)="idSerialChange.emit($event)"
            class="field-control"
            placeholder="151.20.43.6"
          />
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Ubicación</label>
          <input
            name="site-location"
            [disabled]="formDisabled()"
            [ngModel]="ubicacion()"
            (ngModelChange)="ubicacionChange.emit($event)"
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
            [disabled]="formDisabled()"
            [ngModel]="coordNorte()"
            (ngModelChange)="coordNorteChange.emit($event)"
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
            [disabled]="formDisabled()"
            [ngModel]="coordEste()"
            (ngModelChange)="coordEsteChange.emit($event)"
            class="field-control font-mono"
            placeholder="345.678,90"
          />
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Huso UTM</label>
          <select
            name="site-huso"
            [disabled]="formDisabled()"
            [ngModel]="huso()"
            (ngModelChange)="husoChange.emit($event)"
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
            [selected]="!!selectedId()"
            [editMode]="editMode()"
            [busy]="busyAction()"
            createKey="site"
            updateKey="site-update"
            deleteKey="site-delete"
            createLabel="Crear sitio"
            createIcon="add_location_alt"
            entityLabel="sitio"
            (enableEdit)="enableEdit.emit()"
            (cancelEdit)="cancelEdit.emit()"
            (remove)="remove.emit()"
          ></app-admin-form-actions>
        </div>
        @if (selectedId() && !editMode()) {
          <div
            class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-caption text-slate-500 lg:col-span-4"
          >
            {{
              selectedSiteUbicacion()
                ? 'Ubicación: ' + selectedSiteUbicacion()
                : 'Sin ubicación registrada'
            }}
          </div>
        }
      </form>

      <div class="table-card">
        <app-admin-table-toolbar
          title="Sitios registrados"
          [countLabel]="filteredSites().length + ' de ' + sites().length + ' visibles'"
          [searchValue]="search()"
          placeholder="Buscar sitio, serial, empresa o estado"
          (searchChange)="onSearchChange($event)"
        ></app-admin-table-toolbar>

        <div class="overflow-x-auto">
          <table class="responsive-table w-full text-left text-body-sm md:min-w-[680px]">
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
                <tr (click)="selectItem.emit(site.id)" [class]="rowClass(selectedId() === site.id)">
                  <td class="px-4 py-3 font-bold text-slate-800" data-label="Sitio">
                    {{ site.descripcion }}
                  </td>
                  <td class="px-4 py-3" data-label="Tipo">
                    <span [class]="siteTypeBadgeClass(site.tipo_sitio)">{{
                      siteTypeLabel(site.tipo_sitio)
                    }}</span>
                  </td>
                  <td class="px-4 py-3 font-mono text-caption text-slate-600" data-label="Serial">
                    {{ site.id_serial }}
                  </td>
                  <td class="px-4 py-3 text-slate-500" data-label="Subempresa">
                    {{ site.subCompanyName }}
                  </td>
                  <td class="px-4 py-3" data-label="Estado">
                    <span [class]="statusBadgeClass(site.activo ? 'success' : 'neutral')">
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
          [page]="page()"
          (pageChange)="onPageChange($event)"
        ></app-admin-pagination>
      </div>
    </app-admin-section-shell>
  `,
  styles: [
    `
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

      .editor-panel {
        border-radius: 10px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface-subtle);
        padding: 20px;
      }

      .table-card {
        min-width: 0;
        overflow: hidden;
        border-radius: 10px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
      }

      .table-head {
        background: var(--color-surface-subtle);
        font-family: var(--font-josefin);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
      }
    `,
  ],
})
export class SitiosSectionComponent {
  // ── Inputs del padre ─────────────────────────────────────────────────────
  readonly sites = input.required<SiteOption[]>();
  readonly companies = input.required<CompanyNode[]>();
  readonly subCompaniesForForm = input.required<SubCompanyOption[]>();
  readonly siteTypeOptions = input.required<SiteTypeCatalogItem[]>();
  readonly selectedId = input.required<string>();
  readonly editMode = input.required<boolean>();
  readonly busyAction = input.required<string>();
  readonly selectedSiteUbicacion = input<string | null | undefined>(null);
  // Form fields
  readonly empresaId = input.required<string>();
  readonly subEmpresaId = input.required<string>();
  readonly tipoSitio = input.required<string>();
  readonly activo = input.required<boolean>();
  readonly esMaletaPiloto = input.required<boolean>();
  readonly descripcion = input.required<string>();
  readonly idSerial = input.required<string>();
  readonly ubicacion = input.required<string>();
  readonly coordNorte = input.required<string>();
  readonly coordEste = input.required<string>();
  readonly huso = input.required<string>();

  // ── Outputs hacia el padre ───────────────────────────────────────────────
  readonly formSubmit = output<Event>();
  readonly selectItem = output<string>();
  readonly enableEdit = output<void>();
  readonly cancelEdit = output<void>();
  readonly remove = output<void>();
  readonly createNew = output<void>();
  // Field changes
  readonly empresaIdChange = output<string>();
  readonly subEmpresaIdChange = output<string>();
  readonly tipoSitioChange = output<string>();
  readonly activoChange = output<string>();
  readonly esMaletaPilotoChange = output<string>();
  readonly descripcionChange = output<string>();
  readonly idSerialChange = output<string>();
  readonly ubicacionChange = output<string>();
  readonly coordNorteChange = output<string>();
  readonly coordEsteChange = output<string>();
  readonly husoChange = output<string>();

  // ── Estado local ─────────────────────────────────────────────────────────
  readonly search = signal('');
  readonly page = signal(1);

  readonly filteredSites = computed<SiteOption[]>(() =>
    this.sites().filter((site) =>
      this.matchesSearch(this.search(), [
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

  readonly paginatedSites = computed<SiteOption[]>(() =>
    this.paginate(this.filteredSites(), this.page()),
  );

  readonly formDisabled = computed(() => !!this.selectedId() && !this.editMode());

  // ── Métodos ──────────────────────────────────────────────────────────────

  onSearchChange(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  onPageChange(page: number): void {
    this.page.set(this.clampPage(page, this.filteredSites().length));
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

  rowClass(selected: boolean): string {
    const base = 'cursor-pointer transition-colors';
    return selected
      ? `${base} bg-primary-tint-08 shadow-[inset_3px_0_0_var(--color-primary)]`
      : `${base} bg-white hover:bg-surface-subtle`;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private paginate<T>(items: T[], page: number): T[] {
    const current = this.clampPage(page, items.length);
    const start = (current - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }

  private clampPage(page: number, totalItems: number): number {
    const total = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const normalized = Number.isFinite(page) ? Math.trunc(page) : 1;
    return Math.min(Math.max(normalized, 1), total);
  }

  private matchesSearch(
    query: string,
    values: (string | number | null | undefined)[],
  ): boolean {
    const nq = this.normalizeText(query);
    if (!nq) return true;
    const haystack = this.normalizeText(...values.map((v) => String(v ?? '')));
    return nq
      .split(' ')
      .filter(Boolean)
      .every((part) => haystack.includes(part));
  }

  private normalizeText(...values: (string | null | undefined)[]): string {
    return values
      .map((v) => String(v ?? '').trim())
      .join(' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
