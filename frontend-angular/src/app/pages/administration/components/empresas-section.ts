import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { CompanyNode } from '../../../services/administration.service';
import { AdminSectionShellComponent } from './admin-section-shell';
import { AdminSectionHeaderComponent } from './admin-section-header';
import { AdminFormActionsComponent } from './admin-form-actions';
import { AdminTableToolbarComponent } from './admin-table-toolbar';
import { AdminPaginationComponent } from './admin-pagination';
import { formatRutInput } from '../../../shared/rut';

const PAGE_SIZE = 10;

/**
 * Sección "Empresas padre" de /administration.
 * Gestiona el formulario CRUD de empresas y su tabla paginada.
 * El estado del formulario y la selección viven en el padre; este
 * componente es presentacional y emite eventos de intención.
 */
@Component({
  selector: 'app-empresas-section',
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
    <app-admin-section-shell title="Empresas padre">
      <form (submit)="submit.emit($event)" class="editor-panel grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-3">
          <app-admin-section-header
            [selected]="!!selectedId()"
            selectedLabel="Empresa seleccionada"
            newLabel="Nueva empresa"
            selectedHint="Presiona editar datos para habilitar cambios."
            newHint="Completa los datos para crear una empresa."
            (createNew)="createNew.emit()"
          ></app-admin-section-header>
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Nombre</label>
          <input
            required
            [disabled]="formDisabled()"
            name="company-name"
            [ngModel]="nombre()"
            (ngModelChange)="nombreChange.emit($event)"
            class="field-control"
            placeholder="Empresa padre"
          />
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">RUT (opcional)</label>
          <input
            [disabled]="formDisabled()"
            name="company-rut"
            [ngModel]="rut()"
            (ngModelChange)="rutChange.emit($event)"
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
            [disabled]="formDisabled()"
            [ngModel]="tipoEmpresa()"
            (ngModelChange)="tipoEmpresaChange.emit($event)"
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
            [selected]="!!selectedId()"
            [editMode]="editMode()"
            [busy]="busyAction()"
            createKey="company"
            updateKey="company-update"
            deleteKey="company-delete"
            createLabel="Crear empresa"
            createIcon="domain_add"
            entityLabel="empresa"
            (enableEdit)="enableEdit.emit()"
            (cancelEdit)="cancelEdit.emit()"
            (remove)="remove.emit()"
          ></app-admin-form-actions>
        </div>
      </form>

      <div class="table-card">
        <app-admin-table-toolbar
          title="Empresas registradas"
          [countLabel]="filteredCompanies().length + ' de ' + companies().length + ' visibles'"
          [searchValue]="search()"
          placeholder="Buscar empresa, RUT o tipo"
          (searchChange)="onSearchChange($event)"
        ></app-admin-table-toolbar>

        <div class="overflow-x-auto">
          <table class="responsive-table w-full text-left text-body-sm md:min-w-[680px]">
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
                  (click)="select.emit(company.id)"
                  [class]="rowClass(selectedId() === company.id)"
                >
                  <td class="px-4 py-3 font-bold text-slate-800" data-label="Nombre">
                    {{ company.nombre }}
                  </td>
                  <td class="px-4 py-3 text-slate-500" data-label="RUT">{{ company.rut }}</td>
                  <td class="px-4 py-3" data-label="Tipo">
                    <span [class]="companyTypeBadgeClass(company.tipo_empresa)">{{
                      company.tipo_empresa
                    }}</span>
                  </td>
                  <td class="px-4 py-3 text-right font-bold text-slate-600" data-label="Sitios">
                    {{ countCompanySites(company) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-admin-pagination
          [total]="filteredCompanies().length"
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
export class EmpresasSectionComponent {
  // ── Inputs desde el padre ────────────────────────────────────────────────
  readonly companies = input.required<CompanyNode[]>();
  readonly selectedId = input.required<string>();
  readonly editMode = input.required<boolean>();
  readonly busyAction = input.required<string>();
  // Form fields pasados desde el padre
  readonly nombre = input.required<string>();
  readonly rut = input.required<string>();
  readonly tipoEmpresa = input.required<string>();

  // ── Outputs hacia el padre ───────────────────────────────────────────────
  readonly submit = output<Event>();
  readonly select = output<string>();
  readonly enableEdit = output<void>();
  readonly cancelEdit = output<void>();
  readonly remove = output<void>();
  readonly createNew = output<void>();
  // Cambios de campo del formulario
  readonly nombreChange = output<string>();
  readonly rutChange = output<string>();
  readonly tipoEmpresaChange = output<string>();

  // ── Estado local (paginación/búsqueda) ────────────────────────────────────
  readonly search = signal('');
  readonly page = signal(1);

  readonly filteredCompanies = computed<CompanyNode[]>(() =>
    this.companies().filter((company) =>
      this.matchesSearch(this.search(), [
        company.nombre,
        company.rut,
        company.tipo_empresa,
        String(this.countCompanySites(company)),
      ]),
    ),
  );

  readonly paginatedCompanies = computed<CompanyNode[]>(() =>
    this.paginate(this.filteredCompanies(), this.page()),
  );

  readonly formDisabled = computed(() => !!this.selectedId() && !this.editMode());

  // ── Métodos ──────────────────────────────────────────────────────────────

  onSearchChange(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  onPageChange(page: number): void {
    this.page.set(this.clampPage(page, this.filteredCompanies().length));
  }

  countCompanySites(company: CompanyNode): number {
    return company.subCompanies.reduce((total, sub) => total + sub.sites.length, 0);
  }

  companyTypeBadgeClass(type: string): string {
    const base = 'rounded-md px-2 py-1 text-caption font-semibold';
    const normalized = this.normalizeText(type);
    if (normalized.includes('electrico')) return `${base} bg-amber-50 text-amber-700`;
    if (normalized.includes('industrial')) return `${base} bg-indigo-50 text-indigo-700`;
    if (normalized.includes('riles')) return `${base} bg-emerald-50 text-emerald-700`;
    if (normalized.includes('proceso')) return `${base} bg-accent/10 text-accent-container`;
    if (normalized.includes('cliente')) return `${base} bg-slate-100 text-slate-600`;
    return `${base} bg-primary-tint-10 text-primary-container`;
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
