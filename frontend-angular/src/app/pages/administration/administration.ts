import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
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

type SectionId = 'empresas' | 'subempresas' | 'sitios' | 'equipos';
type StatusType = 'success' | 'error' | '';

interface AdminStatus {
  type: StatusType;
  message: string;
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
  tipo_sitio: string;
  activo: boolean;
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

const DEFAULT_SITE_TYPE_CATALOG: SiteTypeCatalogResponse = {
  pozo: {
    id: 'pozo',
    label: 'Pozo',
    roles: [
      {
        id: 'nivel',
        label: 'Nivel',
        unitHint: 'm',
        description: 'Lectura del sensor usada para calcular el nivel freatico del pozo.',
      },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  electrico: {
    id: 'electrico',
    label: 'Electrico',
    roles: [
      {
        id: 'energia',
        label: 'Energia',
        unitHint: 'kWh',
        description: 'Energia acumulada o consumida.',
      },
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura asociada.',
      },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  riles: {
    id: 'riles',
    label: 'Riles',
    roles: [
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  proceso: {
    id: 'proceso',
    label: 'Proceso',
    roles: [
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura de proceso.',
      },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  generico: {
    id: 'generico',
    label: 'Generico',
    roles: [{ id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' }],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
};

@Component({
  selector: 'app-administration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-[calc(100vh-4rem)] bg-slate-50 px-5 py-5 font-['Inter'] text-slate-800">
      <div class="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header
          class="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center md:justify-between"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-[22px] text-cyan-700"
                >settings_applications</span
              >
              <p class="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-700">
                SuperAdmin
              </p>
            </div>
            <h1 class="mt-1 text-2xl font-black text-slate-900">Administracion</h1>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(3,12rem)_3.75rem]">
            <div
              class="flex min-h-[3.8rem] items-center gap-3 rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white px-3 py-2 shadow-sm"
            >
              <span
                class="material-symbols-outlined grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-center text-[20px] leading-none text-cyan-700 shadow-[inset_0_0_0_1px_rgba(8,145,178,0.16)]"
                >domain</span
              >
              <div>
                <p class="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  Empresas
                </p>
                <p class="mt-0.5 text-xl font-black leading-none text-slate-900">
                  {{ hierarchy().length }}
                </p>
              </div>
            </div>
            <div
              class="flex min-h-[3.8rem] items-center gap-3 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-3 py-2 shadow-sm"
            >
              <span
                class="material-symbols-outlined grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-center text-[20px] leading-none text-blue-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.16)]"
                >location_on</span
              >
              <div>
                <p class="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  Sitios
                </p>
                <p class="mt-0.5 text-xl font-black leading-none text-slate-900">
                  {{ allSites().length }}
                </p>
              </div>
            </div>
            <div
              class="flex min-h-[3.8rem] items-center gap-3 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-3 py-2 shadow-sm"
            >
              <span
                class="material-symbols-outlined grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-center text-[20px] leading-none text-violet-700 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.16)]"
                >memory</span
              >
              <div>
                <p class="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  Equipos
                </p>
                <p class="mt-0.5 text-xl font-black leading-none text-slate-900">
                  {{ detectedDevices().length }}
                </p>
              </div>
            </div>
            <button
              type="button"
              (click)="loadDashboard()"
              [disabled]="loading()"
              class="inline-flex min-h-[3.8rem] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Actualizar"
            >
              <span class="material-symbols-outlined text-[22px]" aria-hidden="true">refresh</span>
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
              <section class="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
                <div class="flex items-center gap-3 text-sm font-bold text-slate-500">
                  <span class="material-symbols-outlined animate-spin text-[22px] text-cyan-600"
                    >progress_activity</span
                  >
                  Cargando administracion
                </div>
              </section>
            } @else {
              @if (activeSection() === 'empresas') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Empresas padre</h2>
                  </div>

                  <div class="space-y-5 p-6">
                    <form (submit)="submitCompany($event)" class="editor-panel grid gap-4 lg:grid-cols-3">
                      <div class="flex items-start justify-between gap-3 lg:col-span-3">
                        <div>
                          <p class="text-xs font-black uppercase tracking-[0.12em] text-cyan-700">
                            {{ selectedCompanyId() ? 'Empresa seleccionada' : 'Nueva empresa' }}
                          </p>
                          <p class="mt-1 text-sm text-slate-500">
                            {{
                              selectedCompanyId()
                                ? 'Presiona editar datos para habilitar cambios.'
                                : 'Completa los datos para crear una empresa.'
                            }}
                          </p>
                        </div>
                        @if (selectedCompanyId()) {
                          <button type="button" (click)="startCreateCompany()" class="secondary-button">
                            <span class="material-symbols-outlined text-[18px]">add</span>
                            Nueva
                          </button>
                        }
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Nombre</label>
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
                        <label class="mb-1 block text-xs font-bold text-slate-500">RUT</label>
                        <input
                          required
                          [disabled]="companyFormDisabled()"
                          name="company-rut"
                          [ngModel]="companyForm().rut"
                          (ngModelChange)="updateCompanyForm('rut', $event)"
                          class="field-control"
                          placeholder="76000000-0"
                        />
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Tipo</label>
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
                      @if (!selectedCompanyId()) {
                        <button
                          type="submit"
                          [disabled]="busyAction() === 'company'"
                          class="primary-button"
                        >
                          <span class="material-symbols-outlined text-[18px]">domain_add</span>
                          {{ busyAction() === 'company' ? 'Guardando' : 'Crear empresa' }}
                        </button>
                      } @else if (!companyEditMode()) {
                        <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <button type="button" (click)="enableCompanyEdit()" class="secondary-button">
                            <span class="material-symbols-outlined text-[18px]">edit</span>
                            Editar datos
                          </button>
                          <button
                            type="button"
                            (click)="deleteSelectedCompany()"
                            [disabled]="busyAction() === 'company-delete'"
                            class="danger-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      } @else {
                        <div class="grid gap-2 sm:grid-cols-2">
                          <button
                            type="submit"
                            [disabled]="busyAction() === 'company-update'"
                            class="primary-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">save</span>
                            {{
                              busyAction() === 'company-update' ? 'Actualizando' : 'Actualizar'
                            }}
                          </button>
                          <button type="button" (click)="cancelCompanyEdit()" class="secondary-button">
                            Cancelar
                          </button>
                        </div>
                      }
                      </div>
                    </form>

                    <div class="table-card">
                      <div class="table-toolbar">
                        <div>
                          <p class="text-sm font-black text-slate-800">Empresas registradas</p>
                          <p class="text-xs font-bold text-slate-400">
                            {{ filteredCompanies().length }} de {{ hierarchy().length }} visibles
                          </p>
                        </div>
                        <label class="search-control">
                          <span class="material-symbols-outlined text-[18px]">search</span>
                          <input
                            type="search"
                            [ngModel]="companySearch()"
                            (ngModelChange)="updateCompanySearch($event)"
                            [ngModelOptions]="{ standalone: true }"
                            placeholder="Buscar empresa, RUT o tipo"
                          />
                        </label>
                      </div>

                      <div class="overflow-x-auto">
                      <table class="min-w-[680px] w-full text-left text-sm">
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
                              <td class="px-4 py-3 font-bold text-slate-800">
                                {{ company.nombre }}
                              </td>
                              <td class="px-4 py-3 text-slate-500">{{ company.rut }}</td>
                              <td class="px-4 py-3">
                                <span
                                  [class]="companyTypeBadgeClass(company.tipo_empresa)"
                                  >{{ company.tipo_empresa }}</span
                                >
                              </td>
                              <td class="px-4 py-3 text-right font-bold text-slate-600">
                                {{ countCompanySites(company) }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                      </div>
                      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                        <p class="text-xs font-bold text-slate-400">
                          Mostrando {{ paginationStart(filteredCompanies().length, companyPage()) }}-{{ paginationEnd(filteredCompanies().length, companyPage()) }} de {{ filteredCompanies().length }}
                        </p>
                        @if (totalPages(filteredCompanies().length) > 1) {
                          <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" (click)="setPage('empresas', companyPage() - 1)" [disabled]="companyPage() === 1" class="pagination-button">
                              Anterior
                            </button>
                            @for (page of paginationPages(filteredCompanies().length, companyPage()); track page) {
                              <button type="button" (click)="setPage('empresas', page)" [class]="paginationButtonClass(companyPage() === page)">
                                {{ page }}
                              </button>
                            }
                            <button type="button" (click)="setPage('empresas', companyPage() + 1)" [disabled]="companyPage() >= totalPages(filteredCompanies().length)" class="pagination-button">
                              Siguiente
                            </button>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                </section>
              }

              @if (activeSection() === 'subempresas') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Subempresas</h2>
                  </div>

                  <div class="space-y-5 p-6">
                    <form (submit)="submitSubCompany($event)" class="editor-panel grid gap-4 lg:grid-cols-3">
                      <div class="flex items-start justify-between gap-3 lg:col-span-3">
                        <div>
                          <p class="text-xs font-black uppercase tracking-[0.12em] text-cyan-700">
                            {{ selectedSubCompanyId() ? 'Subempresa seleccionada' : 'Nueva subempresa' }}
                          </p>
                          <p class="mt-1 text-sm text-slate-500">
                            {{
                              selectedSubCompanyId()
                                ? 'Presiona editar datos para habilitar cambios.'
                                : 'Completa los datos para crear una subempresa.'
                            }}
                          </p>
                        </div>
                        @if (selectedSubCompanyId()) {
                          <button type="button" (click)="startCreateSubCompany()" class="secondary-button">
                            <span class="material-symbols-outlined text-[18px]">add</span>
                            Nueva
                          </button>
                        }
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500"
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
                        <label class="mb-1 block text-xs font-bold text-slate-500">Nombre</label>
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
                        <label class="mb-1 block text-xs font-bold text-slate-500">RUT</label>
                        <input
                          required
                          [disabled]="subCompanyFormDisabled()"
                          name="sub-company-rut"
                          [ngModel]="subCompanyForm().rut"
                          (ngModelChange)="updateSubCompanyForm('rut', $event)"
                          class="field-control"
                          placeholder="76000000-0"
                        />
                      </div>
                      <div class="flex flex-wrap gap-2 lg:col-span-3">
                      @if (!selectedSubCompanyId()) {
                        <button
                          type="submit"
                          [disabled]="busyAction() === 'subcompany'"
                          class="primary-button"
                        >
                          <span class="material-symbols-outlined text-[18px]">add_business</span>
                          {{ busyAction() === 'subcompany' ? 'Guardando' : 'Crear subempresa' }}
                        </button>
                      } @else if (!subCompanyEditMode()) {
                        <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <button
                            type="button"
                            (click)="enableSubCompanyEdit()"
                            class="secondary-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">edit</span>
                            Editar datos
                          </button>
                          <button
                            type="button"
                            (click)="deleteSelectedSubCompany()"
                            [disabled]="busyAction() === 'subcompany-delete'"
                            class="danger-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      } @else {
                        <div class="grid gap-2 sm:grid-cols-2">
                          <button
                            type="submit"
                            [disabled]="busyAction() === 'subcompany-update'"
                            class="primary-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">save</span>
                            {{
                              busyAction() === 'subcompany-update'
                                ? 'Actualizando'
                                : 'Actualizar'
                            }}
                          </button>
                          <button
                            type="button"
                            (click)="cancelSubCompanyEdit()"
                            class="secondary-button"
                          >
                            Cancelar
                          </button>
                        </div>
                      }
                      </div>
                    </form>

                    <div class="table-card">
                      <div class="table-toolbar">
                        <div>
                          <p class="text-sm font-black text-slate-800">Subempresas registradas</p>
                          <p class="text-xs font-bold text-slate-400">
                            {{ filteredSubCompanies().length }} de {{ allSubCompanies().length }} visibles
                          </p>
                        </div>
                        <label class="search-control">
                          <span class="material-symbols-outlined text-[18px]">search</span>
                          <input
                            type="search"
                            [ngModel]="subCompanySearch()"
                            (ngModelChange)="updateSubCompanySearch($event)"
                            [ngModelOptions]="{ standalone: true }"
                            placeholder="Buscar subempresa, empresa o RUT"
                          />
                        </label>
                      </div>

                      <div class="overflow-x-auto">
                      <table class="min-w-[760px] w-full text-left text-sm">
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
                              <td class="px-4 py-3 font-bold text-slate-800">{{ sub.nombre }}</td>
                              <td class="px-4 py-3 text-slate-500">{{ sub.companyName }}</td>
                              <td class="px-4 py-3 text-slate-500">{{ sub.rut }}</td>
                              <td class="px-4 py-3 text-right font-bold text-slate-600">
                                {{ sub.sites.length }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                      </div>
                      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                        <p class="text-xs font-bold text-slate-400">
                          Mostrando {{ paginationStart(filteredSubCompanies().length, subCompanyPage()) }}-{{ paginationEnd(filteredSubCompanies().length, subCompanyPage()) }} de {{ filteredSubCompanies().length }}
                        </p>
                        @if (totalPages(filteredSubCompanies().length) > 1) {
                          <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" (click)="setPage('subempresas', subCompanyPage() - 1)" [disabled]="subCompanyPage() === 1" class="pagination-button">
                              Anterior
                            </button>
                            @for (page of paginationPages(filteredSubCompanies().length, subCompanyPage()); track page) {
                              <button type="button" (click)="setPage('subempresas', page)" [class]="paginationButtonClass(subCompanyPage() === page)">
                                {{ page }}
                              </button>
                            }
                            <button type="button" (click)="setPage('subempresas', subCompanyPage() + 1)" [disabled]="subCompanyPage() >= totalPages(filteredSubCompanies().length)" class="pagination-button">
                              Siguiente
                            </button>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                </section>
              }

              @if (activeSection() === 'sitios') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Sitios</h2>
                  </div>

                  <div class="space-y-5 p-6">
                    <form (submit)="submitSite($event)" class="editor-panel grid gap-4 lg:grid-cols-4">
                      <div class="flex items-start justify-between gap-3 lg:col-span-4">
                        <div>
                          <p class="text-xs font-black uppercase tracking-[0.12em] text-cyan-700">
                            {{ selectedSiteId() ? 'Sitio seleccionado' : 'Nuevo sitio' }}
                          </p>
                          <p class="mt-1 text-sm text-slate-500">
                            {{
                              selectedSiteId()
                                ? 'Selecciona editar datos para modificar este sitio.'
                                : 'Completa los datos para crear un sitio.'
                            }}
                          </p>
                        </div>
                        @if (selectedSiteId()) {
                          <button type="button" (click)="startCreateSite()" class="secondary-button">
                            <span class="material-symbols-outlined text-[18px]">add</span>
                            Nuevo
                          </button>
                        }
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500"
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
                        <label class="mb-1 block text-xs font-bold text-slate-500"
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
                        <label class="mb-1 block text-xs font-bold text-slate-500"
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
                        <label class="mb-1 block text-xs font-bold text-slate-500">Estado</label>
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
                        <label class="mb-1 block text-xs font-bold text-slate-500"
                          >Nombre del sitio</label
                        >
                        <input
                          required
                          [disabled]="siteFormDisabled()"
                          name="site-description"
                          [ngModel]="siteForm().descripcion"
                          (ngModelChange)="updateSiteForm('descripcion', $event)"
                          class="field-control"
                          placeholder="Pozo, planta o instalacion"
                        />
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500"
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
                        <label class="mb-1 block text-xs font-bold text-slate-500">Ubicacion</label>
                        <input
                          name="site-location"
                          [disabled]="siteFormDisabled()"
                          [ngModel]="siteForm().ubicacion"
                          (ngModelChange)="updateSiteForm('ubicacion', $event)"
                          class="field-control"
                          placeholder="Ciudad, faena o coordenadas"
                        />
                      </div>
                      <div class="lg:col-span-4 flex flex-wrap gap-2">
                      @if (!selectedSiteId()) {
                        <button
                          type="submit"
                          [disabled]="busyAction() === 'site'"
                          class="primary-button"
                        >
                          <span class="material-symbols-outlined text-[18px]">add_location_alt</span>
                          {{ busyAction() === 'site' ? 'Guardando' : 'Crear sitio' }}
                        </button>
                      } @else if (!siteEditMode()) {
                        <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <button type="button" (click)="enableSiteEdit()" class="secondary-button">
                            <span class="material-symbols-outlined text-[18px]">edit</span>
                            Editar datos
                          </button>
                          <button
                            type="button"
                            (click)="deleteSelectedSite()"
                            [disabled]="busyAction() === 'site-delete'"
                            class="danger-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      } @else {
                        <div class="grid gap-2 sm:grid-cols-2">
                          <button
                            type="submit"
                            [disabled]="busyAction() === 'site-update'"
                            class="primary-button"
                          >
                            <span class="material-symbols-outlined text-[18px]">save</span>
                            {{
                              busyAction() === 'site-update' ? 'Actualizando' : 'Actualizar'
                            }}
                          </button>
                          <button type="button" (click)="cancelSiteEdit()" class="secondary-button">
                            Cancelar
                          </button>
                        </div>
                      }
                      </div>
                      @if (selectedSiteId() && !siteEditMode()) {
                        <div
                          class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 lg:col-span-4"
                        >
                          {{
                            selectedSite()?.ubicacion
                              ? 'Ubicacion: ' + selectedSite()?.ubicacion
                              : 'Sin ubicacion registrada'
                          }}
                        </div>
                      }
                    </form>

                    <div class="table-card">
                      <div class="table-toolbar">
                        <div>
                          <p class="text-sm font-black text-slate-800">Sitios registrados</p>
                          <p class="text-xs font-bold text-slate-400">
                            {{ filteredSites().length }} de {{ allSites().length }} visibles
                          </p>
                        </div>
                        <label class="search-control">
                          <span class="material-symbols-outlined text-[18px]">search</span>
                          <input
                            type="search"
                            [ngModel]="siteSearch()"
                            (ngModelChange)="updateSiteSearch($event)"
                            [ngModelOptions]="{ standalone: true }"
                            placeholder="Buscar sitio, serial, empresa o estado"
                          />
                        </label>
                      </div>

                      <div class="overflow-x-auto">
                        <table class="min-w-[680px] w-full text-left text-sm">
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
                                <td class="px-4 py-3 font-bold text-slate-800">
                                  {{ site.descripcion }}
                                </td>
                                <td class="px-4 py-3">
                                  <span [class]="siteTypeBadgeClass(site.tipo_sitio)">{{
                                    siteTypeLabel(site.tipo_sitio)
                                  }}</span>
                                </td>
                                <td class="px-4 py-3 font-mono text-xs text-slate-600">
                                  {{ site.id_serial }}
                                </td>
                                <td class="px-4 py-3 text-slate-500">{{ site.subCompanyName }}</td>
                                <td class="px-4 py-3">
                                  <span
                                    [class]="
                                      site.activo
                                        ? 'rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700'
                                        : 'rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500'
                                    "
                                  >
                                    {{ site.activo ? 'Activo' : 'Inactivo' }}
                                  </span>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                        <p class="text-xs font-bold text-slate-400">
                          Mostrando {{ paginationStart(filteredSites().length, sitePage()) }}-{{ paginationEnd(filteredSites().length, sitePage()) }} de {{ filteredSites().length }}
                        </p>
                        @if (totalPages(filteredSites().length) > 1) {
                          <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" (click)="setPage('sitios', sitePage() - 1)" [disabled]="sitePage() === 1" class="pagination-button">
                              Anterior
                            </button>
                            @for (page of paginationPages(filteredSites().length, sitePage()); track page) {
                              <button type="button" (click)="setPage('sitios', page)" [class]="paginationButtonClass(sitePage() === page)">
                                {{ page }}
                              </button>
                            }
                            <button type="button" (click)="setPage('sitios', sitePage() + 1)" [disabled]="sitePage() >= totalPages(filteredSites().length)" class="pagination-button">
                              Siguiente
                            </button>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                </section>
              }

              @if (activeSection() === 'equipos') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Equipos detectados</h2>
                  </div>

                  <div class="space-y-5 p-6">
                    <div class="table-card">
                      <div class="table-toolbar">
                        <div>
                          <p class="text-sm font-black text-slate-800">Equipos detectados</p>
                          <p class="text-xs font-bold text-slate-400">
                            {{ filteredDevices().length }} de {{ detectedDevices().length }} visibles
                          </p>
                        </div>
                        <div class="flex flex-wrap items-center justify-end gap-2">
                          <label class="search-control">
                            <span class="material-symbols-outlined text-[18px]">search</span>
                            <input
                              type="search"
                              [ngModel]="deviceSearch()"
                              (ngModelChange)="updateDeviceSearch($event)"
                              [ngModelOptions]="{ standalone: true }"
                              placeholder="Buscar serial, sitio o empresa"
                            />
                          </label>
                          <button type="button" (click)="loadDashboard()" class="secondary-button">
                            <span class="material-symbols-outlined text-[18px]">sync</span>
                            Actualizar
                          </button>
                        </div>
                      </div>

                      <div class="overflow-x-auto">
                      <table class="min-w-[760px] w-full text-left text-sm">
                        <thead class="table-head">
                          <tr>
                            <th class="px-4 py-3">Serial</th>
                            <th class="px-4 py-3">Ultimo registro</th>
                            <th class="px-4 py-3 text-right">Cantidad de datos</th>
                            <th class="px-4 py-3">Sitio</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (device of paginatedDevices(); track device.id_serial) {
                            <tr class="bg-white transition-colors hover:bg-slate-50">
                              <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">
                                {{ device.id_serial }}
                              </td>
                              <td class="px-4 py-3 text-slate-500">
                                {{ deviceLastSeenLabel(device) }}
                              </td>
                              <td class="px-4 py-3 text-right font-bold text-slate-700">
                                {{ deviceDataCountLabel(device) }}
                              </td>
                              <td class="px-4 py-3">
                                <span
                                  [class]="
                                    device.sitio_id
                                      ? 'rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700'
                                      : 'rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700'
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
                      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                        <p class="text-xs font-bold text-slate-400">
                          Mostrando {{ paginationStart(filteredDevices().length, devicePage()) }}-{{ paginationEnd(filteredDevices().length, devicePage()) }} de {{ filteredDevices().length }}
                        </p>
                        @if (totalPages(filteredDevices().length) > 1) {
                          <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" (click)="setPage('equipos', devicePage() - 1)" [disabled]="devicePage() === 1" class="pagination-button">
                              Anterior
                            </button>
                            @for (page of paginationPages(filteredDevices().length, devicePage()); track page) {
                              <button type="button" (click)="setPage('equipos', page)" [class]="paginationButtonClass(devicePage() === page)">
                                {{ page }}
                              </button>
                            }
                            <button type="button" (click)="setPage('equipos', devicePage() + 1)" [disabled]="devicePage() >= totalPages(filteredDevices().length)" class="pagination-button">
                              Siguiente
                            </button>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                </section>
              }
            }
          </main>
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      .admin-shell {
        overflow: hidden;
        border-radius: 0.9rem;
        border: 1px solid rgb(226 232 240);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.95)),
          white;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.07);
      }

      .section-tabs {
        display: flex;
        gap: 0.55rem;
        overflow-x: auto;
        border-bottom: 1px solid rgb(226 232 240);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.86)),
          white;
        padding: 0.9rem 1rem 0;
      }

      .section-tab-button {
        position: relative;
        min-height: 3.35rem;
        border: 1px solid transparent;
        border-bottom: 0;
        border-radius: 0.9rem 0.9rem 0 0;
        color: rgb(100 116 139);
      }

      .section-tab-button:hover {
        border-color: rgb(207 250 254);
        background: rgb(240 253 250);
      }

      .section-tab-active {
        border-color: rgb(186 230 253);
        background: linear-gradient(180deg, rgb(236 254 255), white);
        color: rgb(8 145 178);
        box-shadow: inset 0 -3px 0 rgb(8 145 178);
      }

      .field-control {
        width: 100%;
        border-radius: 0.7rem;
        border: 1px solid rgb(203 213 225);
        background: rgba(248, 250, 252, 0.82);
        padding: 0.625rem 0.75rem;
        font-size: 0.875rem;
        color: rgb(15 23 42);
        outline: none;
      }

      .field-control:focus {
        border-color: rgb(6 182 212);
        background: white;
        box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.12);
      }

      .field-control:disabled {
        border-color: rgb(226 232 240);
        background: rgb(241 245 249);
        color: rgb(51 65 85);
      }

      .editor-panel {
        border-radius: 0.9rem;
        border: 1px solid rgb(207 250 254);
        background:
          radial-gradient(circle at top left, rgba(6, 182, 212, 0.12), transparent 34rem),
          linear-gradient(180deg, rgba(236, 254, 255, 0.72), rgba(255, 255, 255, 0.96)),
          white;
        padding: 1.25rem;
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.055);
      }

      .table-card {
        min-width: 0;
        overflow: hidden;
        border-radius: 0.9rem;
        border: 1px solid rgb(226 232 240);
        background: white;
        box-shadow: 0 12px 26px rgba(15, 23, 42, 0.052);
      }

      .table-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border-bottom: 1px solid rgb(226 232 240);
        padding: 1rem 1.25rem;
      }

      .search-control {
        display: flex;
        min-height: 2.5rem;
        width: min(100%, 25rem);
        align-items: center;
        gap: 0.5rem;
        border-radius: 0.65rem;
        border: 1px solid rgb(203 213 225);
        background: rgba(248, 250, 252, 0.9);
        padding: 0 0.75rem;
        color: rgb(100 116 139);
      }

      .search-control:focus-within {
        border-color: rgb(6 182 212);
        background: white;
        box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.12);
      }

      .search-control input {
        min-width: 0;
        flex: 1;
        border: 0;
        background: transparent;
        font-size: 0.875rem;
        color: rgb(15 23 42);
        outline: none;
      }

      .table-head {
        background: rgb(241 245 249);
        font-size: 0.75rem;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgb(100 116 139);
      }

      .pagination-button {
        display: inline-flex;
        min-height: 2.25rem;
        align-items: center;
        justify-content: center;
        border-radius: 0.65rem;
        border: 1px solid rgb(226 232 240);
        background: white;
        padding: 0 0.8rem;
        font-size: 0.75rem;
        font-weight: 900;
        color: rgb(71 85 105);
        transition: all 160ms ease;
      }

      .pagination-button:hover:not(:disabled) {
        border-color: rgb(165 243 252);
        color: rgb(8 145 178);
      }

      .pagination-button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      .primary-button,
      .secondary-button,
      .danger-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        transition: all 160ms ease;
      }

      .primary-button {
        min-height: 2.5rem;
        min-width: 11rem;
        border-radius: 0.7rem;
        border: 1px solid rgb(8 145 178);
        background: rgb(8 145 178);
        padding: 0.625rem 1rem;
        font-size: 0.875rem;
        font-weight: 800;
        color: white;
      }

      .primary-button:hover:not(:disabled) {
        border-color: rgb(14 116 144);
        background: rgb(14 116 144);
        transform: translateY(-1px);
        box-shadow: 0 10px 18px rgba(8, 145, 178, 0.18);
      }

      .primary-button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .secondary-button {
        min-height: 2.5rem;
        min-width: 8.5rem;
        border-radius: 0.7rem;
        border: 1px solid rgb(203 213 225);
        background: rgba(255, 255, 255, 0.92);
        padding: 0.625rem 1rem;
        font-size: 0.875rem;
        font-weight: 800;
        color: rgb(71 85 105);
      }

      .secondary-button:hover {
        border-color: rgb(125 211 252);
        background: rgb(240 249 255);
        color: rgb(3 105 161);
        transform: translateY(-1px);
      }

      .danger-button {
        min-height: 2.5rem;
        border-radius: 0.7rem;
        border: 1px solid rgb(254 202 202);
        background: rgb(254 242 242);
        padding: 0.625rem 0.8rem;
        font-size: 0.875rem;
        font-weight: 800;
        color: rgb(185 28 28);
      }

      .danger-button:hover:not(:disabled) {
        border-color: rgb(252 165 165);
        background: rgb(254 226 226);
        transform: translateY(-1px);
      }

      .danger-button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      @media (max-width: 760px) {
        .table-toolbar {
          align-items: stretch;
          flex-direction: column;
        }

        .search-control {
          width: 100%;
        }

        .primary-button,
        .secondary-button,
        .danger-button {
          width: 100%;
        }
      }
    `,
  ],
})
export class AdministrationComponent implements OnInit {
  private api = inject(AdministrationService);
  private companyService = inject(CompanyService);
  private router = inject(Router);

  readonly sectionItems: { id: SectionId; icon: string; label: string }[] = [
    { id: 'empresas', icon: 'domain', label: 'Empresas' },
    { id: 'subempresas', icon: 'add_business', label: 'Subempresas' },
    { id: 'sitios', icon: 'location_on', label: 'Sitios' },
    { id: 'equipos', icon: 'memory', label: 'Equipos' },
  ];

  activeSection = signal<SectionId>('empresas');
  loading = signal(false);
  busyAction = signal('');
  status = signal<AdminStatus>({ type: '', message: '' });

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
    tipo_sitio: 'pozo',
    activo: true,
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

  paginatedSites = computed<SiteOption[]>(() => this.paginate(this.filteredSites(), this.sitePage()));

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

  setSection(section: SectionId): void {
    this.activeSection.set(section);
  }

  loadDashboard(): void {
    this.loading.set(true);
    this.status.set({ type: '', message: '' });

    forkJoin({
      hierarchy: this.api.getHierarchy(),
      devices: this.api.getDetectedDevices(500),
      catalog: this.api.getSiteTypeCatalog(),
    }).subscribe({
      next: ({ hierarchy, devices, catalog }) => {
        this.hierarchy.set(hierarchy.ok ? hierarchy.data : []);
        this.detectedDevices.set(devices.ok ? devices.data : []);
        this.siteTypeCatalog.set(catalog.ok ? catalog.data : DEFAULT_SITE_TYPE_CATALOG);
        this.seedSelections();
        this.clampAllPages();
        this.companyService.fetchHierarchy().subscribe();
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.setError(this.errorMessage(err, 'No fue posible cargar administracion.'));
      },
    });
  }

  updateCompanyForm(field: keyof CompanyForm, value: string): void {
    this.companyForm.update((form) => ({ ...form, [field]: value }));
  }

  updateSubCompanyForm(field: keyof SubCompanyForm, value: string): void {
    this.subCompanyForm.update((form) => ({ ...form, [field]: value }));
  }

  updateSiteForm(field: keyof SiteForm, value: string): void {
    this.siteForm.update((form) => ({ ...form, [field]: value }));
  }

  updateSiteActive(value: string): void {
    this.siteForm.update((form) => ({ ...form, activo: value === 'true' }));
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

  totalPages(totalItems: number): number {
    return Math.max(1, Math.ceil(totalItems / ADMIN_PAGE_SIZE));
  }

  paginationPages(totalItems: number, currentPage: number): number[] {
    const total = this.totalPages(totalItems);
    const start = Math.max(1, Math.min(currentPage - 2, Math.max(1, total - 4)));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  paginationStart(totalItems: number, currentPage: number): number {
    if (!totalItems) return 0;
    return (this.clampPage(currentPage, totalItems) - 1) * ADMIN_PAGE_SIZE + 1;
  }

  paginationEnd(totalItems: number, currentPage: number): number {
    return Math.min(totalItems, this.clampPage(currentPage, totalItems) * ADMIN_PAGE_SIZE);
  }

  paginationButtonClass(active: boolean): string {
    const base =
      'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-xs font-black transition';
    return active
      ? `${base} border-cyan-300 bg-cyan-50 text-cyan-700`
      : `${base} border-slate-200 bg-white text-slate-500 hover:border-cyan-200 hover:text-cyan-700`;
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

  calculatorButtonClass(transformId: string): string {
    const base =
      'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-black uppercase tracking-[0.1em] transition';
    return this.variableForm().transformacion === transformId
      ? `${base} border-cyan-300 bg-cyan-100 text-cyan-900`
      : `${base} border-cyan-100 bg-white text-cyan-800 hover:border-cyan-200 hover:bg-cyan-50`;
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
      rut: company.rut,
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
        this.loadDashboard();
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
    if (!this.confirmAdminAction('Confirmar actualizacion de empresa.')) return;

    this.busyAction.set('company-update');
    this.api.updateCompany(companyId, this.companyForm()).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.companyEditMode.set(false);
        this.setSuccess(res.message || 'Empresa actualizada.');
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible actualizar la empresa.'));
      },
    });
  }

  deleteSelectedCompany(): void {
    const company = this.selectedCompany();
    if (!company) {
      this.setError('Selecciona una empresa.');
      return;
    }
    if (
      !this.confirmAdminAction(
        `Eliminar ${company.nombre}? Tambien se eliminaran sus subempresas y sitios asociados.`,
      )
    ) {
      return;
    }

    this.busyAction.set('company-delete');
    this.api.deleteCompany(company.id).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.selectedCompanyId.set('');
        this.companyEditMode.set(false);
        this.setSuccess(res.message || 'Empresa eliminada.');
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible eliminar la empresa.'));
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
      rut: subCompany.rut,
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
        this.loadDashboard();
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
    if (!this.confirmAdminAction('Confirmar actualizacion de subempresa.')) return;

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
          this.loadDashboard();
        },
        error: (err: unknown) => {
          this.busyAction.set('');
          this.setError(this.errorMessage(err, 'No fue posible actualizar la subempresa.'));
        },
      });
  }

  deleteSelectedSubCompany(): void {
    const subCompany = this.selectedSubCompany();
    if (!subCompany) {
      this.setError('Selecciona una subempresa.');
      return;
    }
    if (
      !this.confirmAdminAction(
        `Eliminar ${subCompany.nombre}? Tambien se eliminaran sus sitios asociados.`,
      )
    ) {
      return;
    }

    this.busyAction.set('subcompany-delete');
    this.api.deleteSubCompany(subCompany.empresa_id, subCompany.id).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.selectedSubCompanyId.set('');
        this.subCompanyEditMode.set(false);
        this.setSuccess(res.message || 'Subempresa eliminada.');
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible eliminar la subempresa.'));
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
      tipo_sitio: 'pozo',
      activo: true,
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
        tipo_sitio: form.tipo_sitio,
        activo: form.activo,
      })
      .subscribe({
        next: (res) => {
          this.busyAction.set('');
          this.setSuccess(res.message || 'Sitio creado.');
          this.selectedSiteId.set(res.data.id);
          this.siteEditMode.set(false);
          this.loadDashboard();
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
    if (!this.confirmAdminAction('Confirmar actualizacion de sitio.')) return;

    this.busyAction.set('site-update');
    this.api
      .updateSite(siteId, {
        empresa_id: form.empresa_id,
        sub_empresa_id: form.sub_empresa_id,
        descripcion: form.descripcion,
        id_serial: form.id_serial,
        ubicacion: form.ubicacion || null,
        tipo_sitio: form.tipo_sitio,
        activo: form.activo,
      })
      .subscribe({
        next: (res) => {
          this.busyAction.set('');
          this.siteEditMode.set(false);
          this.setSuccess(res.message || 'Sitio actualizado.');
          this.loadDashboard();
        },
        error: (err: unknown) => {
          this.busyAction.set('');
          this.setError(this.errorMessage(err, 'No fue posible actualizar el sitio.'));
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
    if (!this.confirmAdminAction(`Eliminar ${site.descripcion}? Esta accion no se puede deshacer.`)) {
      return;
    }

    this.busyAction.set('site-delete');
    this.api.deleteSite(site.id).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.selectedSiteId.set('');
        this.siteEditMode.set(false);
        this.setSuccess(res.message || 'Sitio eliminado.');
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible eliminar el sitio.'));
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
      tipo_sitio: site.tipo_sitio || 'pozo',
      activo: site.activo !== false,
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
        this.loadDashboard();
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
    this.router.navigate(['/companies', site.id, 'water']);
  }

  countCompanySites(company: CompanyNode): number {
    return company.subCompanies.reduce((total, subCompany) => total + subCompany.sites.length, 0);
  }

  displayValue(value: SiteVariable['valor_dato']): string {
    if (value === null || value === undefined) return '-';
    return String(value);
  }

  siteTypeLabel(type: string): string {
    if (type === 'electrico') return 'Electrico';
    if (type === 'riles') return 'Riles';
    if (type === 'proceso') return 'Proceso';
    if (type === 'generico') return 'Generico';
    return 'Pozo';
  }

  siteTypeBadgeClass(type: string): string {
    const base = 'rounded-md px-2 py-1 text-xs font-bold';
    if (type === 'electrico') return `${base} bg-amber-50 text-amber-700`;
    if (type === 'riles') return `${base} bg-emerald-50 text-emerald-700`;
    if (type === 'proceso') return `${base} bg-indigo-50 text-indigo-700`;
    if (type === 'generico') return `${base} bg-slate-100 text-slate-600`;
    return `${base} bg-cyan-50 text-cyan-700`;
  }

  companyTypeBadgeClass(type: string): string {
    const base = 'rounded-md px-2 py-1 text-xs font-black';
    const normalized = this.normalizeSearchText(type);
    if (normalized.includes('electrico')) return `${base} bg-amber-50 text-amber-700`;
    if (normalized.includes('industrial')) return `${base} bg-indigo-50 text-indigo-700`;
    if (normalized.includes('riles')) return `${base} bg-emerald-50 text-emerald-700`;
    if (normalized.includes('proceso')) return `${base} bg-violet-50 text-violet-700`;
    if (normalized.includes('cliente')) return `${base} bg-slate-100 text-slate-600`;
    return `${base} bg-cyan-50 text-cyan-700`;
  }

  deviceDataCount(device: DetectedDevice): number {
    return Number(device.total_datos ?? 0);
  }

  deviceDataCountLabel(device: DetectedDevice): string {
    if (device.total_datos === undefined || device.total_datos === null) return 'No disponible';
    const count = this.deviceDataCount(device);
    return `${count} ${count === 1 ? 'dato' : 'datos'}`;
  }

  deviceLastSeenLabel(device: DetectedDevice): string {
    if (device.ultimo_registro_local) return this.readableDeviceDateTime(device.ultimo_registro_local);

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

  private readableDeviceDateTime(value: string): string {
    const cleaned = value.trim();
    const isoLike = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
    if (isoLike) return `${isoLike[3]}-${isoLike[2]}-${isoLike[1]} ${isoLike[4]}`;
    return cleaned.replace(',', '');
  }

  sectionButtonClass(section: SectionId): string {
    const base =
      `section-tab-button section-tab-${section} inline-flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-black transition-all`;
    return this.activeSection() === section
      ? `${base} section-tab-active`
      : `${base} text-slate-500 hover:text-cyan-800`;
  }

  rowClass(selected: boolean): string {
    const base = 'cursor-pointer transition-colors';
    return selected
      ? `${base} bg-cyan-50/80 shadow-[inset_3px_0_0_rgb(8_145_178)]`
      : `${base} bg-white hover:bg-slate-50`;
  }

  statusClass(): string {
    const base = 'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold';
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
    this.subCompanyPage.set(this.clampPage(this.subCompanyPage(), this.filteredSubCompanies().length));
    this.sitePage.set(this.clampPage(this.sitePage(), this.filteredSites().length));
    this.devicePage.set(this.clampPage(this.devicePage(), this.filteredDevices().length));
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

  private confirmAdminAction(message: string): boolean {
    return window.confirm(message);
  }

  private matchesSearch(query: string, values: Array<string | number | null | undefined>): boolean {
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
