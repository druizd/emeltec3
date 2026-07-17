import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { CompanyNode, SubCompanyNode } from '../../../services/administration.service';
import { AdminSectionShellComponent } from './admin-section-shell';
import { AdminSectionHeaderComponent } from './admin-section-header';
import { AdminFormActionsComponent } from './admin-form-actions';
import { AdminTableToolbarComponent } from './admin-table-toolbar';
import { AdminPaginationComponent } from './admin-pagination';

const PAGE_SIZE = 10;

/** SubCompanyNode enriquecida con el nombre de la empresa padre. */
export interface SubCompanyOption extends SubCompanyNode {
  companyName: string;
}

/**
 * Sección "Subempresas" de /administration.
 * Gestiona el formulario CRUD de subempresas y su tabla paginada.
 * El estado del formulario y la selección viven en el padre.
 */
@Component({
  selector: 'app-subempresas-section',
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
    <app-admin-section-shell title="Subempresas">
      <form (submit)="formSubmit.emit($event)" class="editor-panel grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-3">
          <app-admin-section-header
            [selected]="!!selectedId()"
            selectedLabel="Subempresa seleccionada"
            newLabel="Nueva subempresa"
            selectedHint="Presiona editar datos para habilitar cambios."
            newHint="Completa los datos para crear una subempresa."
            (createNew)="createNew.emit()"
          ></app-admin-section-header>
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">Empresa padre</label>
          <select
            required
            [disabled]="formDisabled()"
            name="sub-company-parent"
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
          <label class="mb-1 block text-caption font-bold text-slate-500">Nombre</label>
          <input
            required
            [disabled]="formDisabled()"
            name="sub-company-name"
            [ngModel]="nombre()"
            (ngModelChange)="nombreChange.emit($event)"
            class="field-control"
            placeholder="Subempresa o faena"
          />
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500">RUT</label>
          <input
            required
            [disabled]="formDisabled()"
            name="sub-company-rut"
            [ngModel]="rut()"
            (ngModelChange)="rutChange.emit($event)"
            inputmode="text"
            maxlength="12"
            class="field-control"
            placeholder="76.000.000-0"
          />
        </div>
        <div class="flex flex-wrap gap-2 lg:col-span-3">
          <app-admin-form-actions
            [selected]="!!selectedId()"
            [editMode]="editMode()"
            [busy]="busyAction()"
            createKey="subcompany"
            updateKey="subcompany-update"
            deleteKey="subcompany-delete"
            createLabel="Crear subempresa"
            createIcon="add_business"
            entityLabel="subempresa"
            (enableEdit)="enableEdit.emit()"
            (cancelEdit)="cancelEdit.emit()"
            (remove)="remove.emit()"
          ></app-admin-form-actions>
        </div>
      </form>

      <div class="table-card">
        <app-admin-table-toolbar
          title="Subempresas registradas"
          [countLabel]="
            filteredSubCompanies().length + ' de ' + subCompanies().length + ' visibles'
          "
          [searchValue]="search()"
          placeholder="Buscar subempresa, empresa o RUT"
          (searchChange)="onSearchChange($event)"
        ></app-admin-table-toolbar>

        <div class="overflow-x-auto">
          <table class="responsive-table w-full text-left text-body-sm md:min-w-[760px]">
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
                  (click)="selectItem.emit(sub.id)"
                  [class]="rowClass(selectedId() === sub.id)"
                >
                  <td class="px-4 py-3 font-bold text-slate-800" data-label="Nombre">
                    {{ sub.nombre }}
                  </td>
                  <td class="px-4 py-3 text-slate-500" data-label="Empresa">
                    {{ sub.companyName }}
                  </td>
                  <td class="px-4 py-3 text-slate-500" data-label="RUT">{{ sub.rut }}</td>
                  <td class="px-4 py-3 text-right font-bold text-slate-600" data-label="Sitios">
                    {{ sub.sites.length }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-admin-pagination
          [total]="filteredSubCompanies().length"
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
export class SubempresasSectionComponent {
  // ── Inputs desde el padre ────────────────────────────────────────────────
  readonly subCompanies = input.required<SubCompanyOption[]>();
  readonly companies = input.required<CompanyNode[]>();
  readonly selectedId = input.required<string>();
  readonly editMode = input.required<boolean>();
  readonly busyAction = input.required<string>();
  // Form fields
  readonly empresaId = input.required<string>();
  readonly nombre = input.required<string>();
  readonly rut = input.required<string>();

  // ── Outputs hacia el padre ───────────────────────────────────────────────
  readonly formSubmit = output<Event>();
  readonly selectItem = output<string>();
  readonly enableEdit = output<void>();
  readonly cancelEdit = output<void>();
  readonly remove = output<void>();
  readonly createNew = output<void>();
  // Cambios de campo del formulario
  readonly empresaIdChange = output<string>();
  readonly nombreChange = output<string>();
  readonly rutChange = output<string>();

  // ── Estado local (paginación/búsqueda) ────────────────────────────────────
  readonly search = signal('');
  readonly page = signal(1);

  readonly filteredSubCompanies = computed<SubCompanyOption[]>(() =>
    this.subCompanies().filter((sub) =>
      this.matchesSearch(this.search(), [
        sub.nombre,
        sub.rut,
        sub.companyName,
        String(sub.sites.length),
      ]),
    ),
  );

  readonly paginatedSubCompanies = computed<SubCompanyOption[]>(() =>
    this.paginate(this.filteredSubCompanies(), this.page()),
  );

  readonly formDisabled = computed(() => !!this.selectedId() && !this.editMode());

  // ── Métodos ──────────────────────────────────────────────────────────────

  onSearchChange(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  onPageChange(page: number): void {
    this.page.set(this.clampPage(page, this.filteredSubCompanies().length));
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
