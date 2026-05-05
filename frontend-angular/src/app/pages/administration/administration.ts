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
  SiteVariable,
  SiteVariablesPayload,
  SubCompanyNode,
  VariableMapping,
} from '../../services/administration.service';
import { CompanyService } from '../../services/company.service';

type SectionId = 'empresas' | 'subempresas' | 'sitios' | 'equipos' | 'variables';
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
  alias: string;
  d1: string;
  d2: string;
  tipo_dato: string;
  unidad: string;
}

@Component({
  selector: 'app-administration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-[calc(100vh-4rem)] bg-slate-50 px-5 py-5 font-['Inter'] text-slate-800">
      <div class="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header class="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center md:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-[22px] text-cyan-700">settings_applications</span>
              <p class="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-700">SuperAdmin</p>
            </div>
            <h1 class="mt-1 text-2xl font-black text-slate-900">Administracion</h1>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p class="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Empresas</p>
              <p class="text-lg font-black text-slate-900">{{ hierarchy().length }}</p>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p class="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Sitios</p>
              <p class="text-lg font-black text-slate-900">{{ allSites().length }}</p>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p class="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Seriales</p>
              <p class="text-lg font-black text-slate-900">{{ detectedDevices().length }}</p>
            </div>
            <button
              type="button"
              (click)="loadDashboard()"
              [disabled]="loading()"
              class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="Actualizar"
            >
              <span class="material-symbols-outlined text-[19px]">refresh</span>
            </button>
          </div>
        </header>

        @if (status().message) {
          <div [class]="statusClass()" role="alert">
            <span class="material-symbols-outlined text-[19px]">{{ status().type === 'success' ? 'check_circle' : 'error' }}</span>
            <span>{{ status().message }}</span>
          </div>
        }

        <div class="grid gap-5 xl:grid-cols-[270px_1fr]">
          <aside class="h-fit rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <nav class="flex flex-col gap-1">
              @for (item of sectionItems; track item.id) {
                <button
                  type="button"
                  (click)="setSection(item.id)"
                  [class]="sectionButtonClass(item.id)"
                >
                  <span class="material-symbols-outlined text-[20px]">{{ item.icon }}</span>
                  <span>{{ item.label }}</span>
                </button>
              }
            </nav>
          </aside>

          <main class="min-w-0">
            @if (loading()) {
              <section class="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
                <div class="flex items-center gap-3 text-sm font-bold text-slate-500">
                  <span class="material-symbols-outlined animate-spin text-[22px] text-cyan-600">progress_activity</span>
                  Cargando administracion
                </div>
              </section>
            } @else {
              @if (activeSection() === 'empresas') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Empresas padre</h2>
                  </div>

                  <div class="grid gap-6 p-6 lg:grid-cols-[420px_1fr]">
                    <form (submit)="createCompany($event)" class="space-y-4">
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Nombre</label>
                        <input
                          required
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
                      <button type="submit" [disabled]="busyAction() === 'company'" class="primary-button">
                        <span class="material-symbols-outlined text-[18px]">domain_add</span>
                        {{ busyAction() === 'company' ? 'Guardando' : 'Crear empresa' }}
                      </button>
                    </form>

                    <div class="overflow-hidden rounded-lg border border-slate-200">
                      <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th class="px-4 py-3">Nombre</th>
                            <th class="px-4 py-3">RUT</th>
                            <th class="px-4 py-3">Tipo</th>
                            <th class="px-4 py-3 text-right">Sitios</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (company of hierarchy(); track company.id) {
                            <tr class="bg-white">
                              <td class="px-4 py-3 font-bold text-slate-800">{{ company.nombre }}</td>
                              <td class="px-4 py-3 text-slate-500">{{ company.rut }}</td>
                              <td class="px-4 py-3"><span class="rounded-md bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700">{{ company.tipo_empresa }}</span></td>
                              <td class="px-4 py-3 text-right font-bold text-slate-600">{{ countCompanySites(company) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              }

              @if (activeSection() === 'subempresas') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Subempresas</h2>
                  </div>

                  <div class="grid gap-6 p-6 lg:grid-cols-[420px_1fr]">
                    <form (submit)="createSubCompany($event)" class="space-y-4">
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Empresa padre</label>
                        <select
                          required
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
                          name="sub-company-rut"
                          [ngModel]="subCompanyForm().rut"
                          (ngModelChange)="updateSubCompanyForm('rut', $event)"
                          class="field-control"
                          placeholder="76000000-0"
                        />
                      </div>
                      <button type="submit" [disabled]="busyAction() === 'subcompany'" class="primary-button">
                        <span class="material-symbols-outlined text-[18px]">add_business</span>
                        {{ busyAction() === 'subcompany' ? 'Guardando' : 'Crear subempresa' }}
                      </button>
                    </form>

                    <div class="overflow-hidden rounded-lg border border-slate-200">
                      <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th class="px-4 py-3">Nombre</th>
                            <th class="px-4 py-3">Empresa</th>
                            <th class="px-4 py-3">RUT</th>
                            <th class="px-4 py-3 text-right">Sitios</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (sub of allSubCompanies(); track sub.id) {
                            <tr class="bg-white">
                              <td class="px-4 py-3 font-bold text-slate-800">{{ sub.nombre }}</td>
                              <td class="px-4 py-3 text-slate-500">{{ sub.companyName }}</td>
                              <td class="px-4 py-3 text-slate-500">{{ sub.rut }}</td>
                              <td class="px-4 py-3 text-right font-bold text-slate-600">{{ sub.sites.length }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              }

              @if (activeSection() === 'sitios') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Sitios</h2>
                  </div>

                  <div class="grid gap-6 p-6 lg:grid-cols-[420px_1fr]">
                    <form (submit)="createSite($event)" class="space-y-4">
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Empresa padre</label>
                        <select
                          required
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
                        <label class="mb-1 block text-xs font-bold text-slate-500">Subempresa</label>
                        <select
                          required
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
                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Tipo de sitio</label>
                          <select
                            name="site-type"
                            [ngModel]="siteForm().tipo_sitio"
                            (ngModelChange)="updateSiteForm('tipo_sitio', $event)"
                            class="field-control"
                          >
                            <option value="pozo">Pozo</option>
                            <option value="electrico">Electrico</option>
                            <option value="generico">Generico</option>
                          </select>
                        </div>
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Estado</label>
                          <select
                            name="site-active"
                            [ngModel]="siteForm().activo ? 'true' : 'false'"
                            (ngModelChange)="updateSiteActive($event)"
                            class="field-control"
                          >
                            <option value="true">Activo</option>
                            <option value="false">Inactivo</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Nombre del sitio</label>
                        <input
                          required
                          name="site-description"
                          [ngModel]="siteForm().descripcion"
                          (ngModelChange)="updateSiteForm('descripcion', $event)"
                          class="field-control"
                          placeholder="Pozo, planta o instalacion"
                        />
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Serial del equipo</label>
                        <input
                          required
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
                          [ngModel]="siteForm().ubicacion"
                          (ngModelChange)="updateSiteForm('ubicacion', $event)"
                          class="field-control"
                          placeholder="Ciudad, faena o coordenadas"
                        />
                      </div>
                      @if (siteForm().tipo_sitio === 'pozo') {
                        <div class="rounded-lg border border-cyan-100 bg-cyan-50/50 p-4">
                          <div class="mb-3 flex items-center gap-2">
                            <span class="material-symbols-outlined text-[18px] text-cyan-700">water_drop</span>
                            <h3 class="text-sm font-black text-slate-800">Configuracion de pozo</h3>
                          </div>
                          <div class="grid gap-3 md:grid-cols-2">
                            <div>
                              <label class="mb-1 block text-xs font-bold text-slate-500">Profundidad del pozo (m)</label>
                              <input
                                name="well-depth"
                                type="number"
                                step="0.01"
                                [ngModel]="siteForm().profundidad_pozo_m"
                                (ngModelChange)="updateSiteForm('profundidad_pozo_m', $event)"
                                class="field-control"
                                placeholder="18"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-xs font-bold text-slate-500">Profundidad del sensor (m)</label>
                              <input
                                name="sensor-depth"
                                type="number"
                                step="0.01"
                                [ngModel]="siteForm().profundidad_sensor_m"
                                (ngModelChange)="updateSiteForm('profundidad_sensor_m', $event)"
                                class="field-control"
                                placeholder="16.5"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-xs font-bold text-slate-500">Nivel estatico manual (m)</label>
                              <input
                                name="static-level"
                                type="number"
                                step="0.01"
                                [ngModel]="siteForm().nivel_estatico_manual_m"
                                (ngModelChange)="updateSiteForm('nivel_estatico_manual_m', $event)"
                                class="field-control"
                                placeholder="14.7"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-xs font-bold text-slate-500">Obra DGA</label>
                              <input
                                name="dga-work"
                                [ngModel]="siteForm().obra_dga"
                                (ngModelChange)="updateSiteForm('obra_dga', $event)"
                                class="field-control"
                                placeholder="OB-0601-292"
                              />
                            </div>
                            <div class="md:col-span-2">
                              <label class="mb-1 block text-xs font-bold text-slate-500">Slug</label>
                              <input
                                name="well-slug"
                                [ngModel]="siteForm().slug"
                                (ngModelChange)="updateSiteForm('slug', $event)"
                                class="field-control"
                                placeholder="pozo-vertiente-01"
                              />
                            </div>
                          </div>
                        </div>
                      }
                      <button type="submit" [disabled]="busyAction() === 'site'" class="primary-button">
                        <span class="material-symbols-outlined text-[18px]">add_location_alt</span>
                        {{ busyAction() === 'site' ? 'Guardando' : 'Crear sitio' }}
                      </button>
                      @if (selectedSiteId()) {
                        <button type="button" (click)="saveSelectedSite()" [disabled]="busyAction() === 'site-update'" class="secondary-button w-full">
                          <span class="material-symbols-outlined text-[18px]">save</span>
                          {{ busyAction() === 'site-update' ? 'Actualizando' : 'Actualizar seleccionado' }}
                        </button>
                      }
                    </form>

                    <div class="space-y-4">
                      <div class="overflow-hidden rounded-lg border border-slate-200">
                        <table class="w-full text-left text-sm">
                          <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                            <tr>
                              <th class="px-4 py-3">Sitio</th>
                              <th class="px-4 py-3">Tipo</th>
                              <th class="px-4 py-3">Serial</th>
                              <th class="px-4 py-3">Subempresa</th>
                              <th class="px-4 py-3 text-right">Accion</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-slate-100">
                            @for (site of allSites(); track site.id) {
                              <tr [class]="selectedSiteId() === site.id ? 'bg-cyan-50/70' : 'bg-white'">
                                <td class="px-4 py-3 font-bold text-slate-800">{{ site.descripcion }}</td>
                                <td class="px-4 py-3">
                                  <span [class]="siteTypeBadgeClass(site.tipo_sitio)">{{ siteTypeLabel(site.tipo_sitio) }}</span>
                                </td>
                                <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ site.id_serial }}</td>
                                <td class="px-4 py-3 text-slate-500">{{ site.subCompanyName }}</td>
                                <td class="px-4 py-3">
                                  <div class="flex justify-end gap-2">
                                    <button type="button" (click)="selectSite(site.id)" class="icon-button" title="Seleccionar">
                                      <span class="material-symbols-outlined text-[18px]">check_circle</span>
                                    </button>
                                    <button type="button" (click)="openSite(site)" class="icon-button" title="Abrir sitio">
                                      <span class="material-symbols-outlined text-[18px]">monitoring</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
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

                  <div class="p-6">
                    <div class="mb-4 grid gap-3 md:grid-cols-[1fr_280px]">
                      <select
                        name="device-target-site"
                        [ngModel]="selectedSiteId()"
                        (ngModelChange)="selectSite($event)"
                        class="field-control"
                      >
                        <option value="">Selecciona sitio</option>
                        @for (site of allSites(); track site.id) {
                          <option [value]="site.id">{{ site.descripcion }} - {{ site.id_serial }}</option>
                        }
                      </select>
                      <button type="button" (click)="loadDashboard()" class="secondary-button">
                        <span class="material-symbols-outlined text-[18px]">sync</span>
                        Actualizar
                      </button>
                    </div>

                    <div class="overflow-hidden rounded-lg border border-slate-200">
                      <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th class="px-4 py-3">Serial</th>
                            <th class="px-4 py-3">Ultimo registro</th>
                            <th class="px-4 py-3 text-right">Registros</th>
                            <th class="px-4 py-3">Sitio</th>
                            <th class="px-4 py-3 text-right">Accion</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (device of detectedDevices(); track device.id_serial) {
                            <tr class="bg-white">
                              <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">{{ device.id_serial }}</td>
                              <td class="px-4 py-3 text-slate-500">{{ device.ultimo_registro }}</td>
                              <td class="px-4 py-3 text-right font-bold text-slate-700">{{ device.total_registros }}</td>
                              <td class="px-4 py-3">
                                <span [class]="device.sitio_id ? 'rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700' : 'rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700'">
                                  {{ device.sitio_descripcion || 'Sin asignar' }}
                                </span>
                              </td>
                              <td class="px-4 py-3">
                                <div class="flex justify-end gap-2">
                                  <button type="button" (click)="useDeviceInSiteForm(device)" class="icon-button" title="Usar serial">
                                    <span class="material-symbols-outlined text-[18px]">input</span>
                                  </button>
                                  <button type="button" (click)="assignDeviceToSelectedSite(device)" [disabled]="!selectedSiteId() || busyAction() === 'assign-device'" class="icon-button disabled:cursor-not-allowed disabled:opacity-40" title="Asignar">
                                    <span class="material-symbols-outlined text-[18px]">link</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              }

              @if (activeSection() === 'variables') {
                <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div class="border-b border-slate-200 px-6 py-4">
                    <h2 class="text-lg font-black text-slate-900">Variables del sitio</h2>
                  </div>

                  <div class="grid gap-6 p-6 lg:grid-cols-[420px_1fr]">
                    <form (submit)="createVariableMap($event)" class="space-y-4">
                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Sitio</label>
                        <select
                          required
                          name="variable-site"
                          [ngModel]="selectedSiteId()"
                          (ngModelChange)="selectSite($event)"
                          class="field-control"
                        >
                          <option value="" disabled>Selecciona sitio</option>
                          @for (site of allSites(); track site.id) {
                            <option [value]="site.id">{{ site.descripcion }} - {{ site.id_serial }}</option>
                          }
                        </select>
                      </div>

                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Dato original</label>
                        <select
                          required
                          name="variable-key"
                          [ngModel]="variableForm().d1"
                          (ngModelChange)="updateVariableForm('d1', $event)"
                          class="field-control"
                        >
                          <option value="" disabled>Selecciona variable</option>
                          @for (variable of siteVariables().variables; track variable.nombre_dato) {
                            <option [value]="variable.nombre_dato">{{ variable.nombre_dato }}</option>
                          }
                        </select>
                      </div>

                      <div>
                        <label class="mb-1 block text-xs font-bold text-slate-500">Alias</label>
                        <input
                          required
                          name="variable-alias"
                          [ngModel]="variableForm().alias"
                          (ngModelChange)="updateVariableForm('alias', $event)"
                          class="field-control"
                          placeholder="Nivel freatico, caudal, energia"
                        />
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Tipo</label>
                          <select
                            name="variable-type"
                            [ngModel]="variableForm().tipo_dato"
                            (ngModelChange)="updateVariableForm('tipo_dato', $event)"
                            class="field-control"
                          >
                            <option value="FLOAT">FLOAT</option>
                            <option value="INTEGER">INTEGER</option>
                            <option value="BOOLEAN">BOOLEAN</option>
                            <option value="TEXT">TEXT</option>
                          </select>
                        </div>
                        <div>
                          <label class="mb-1 block text-xs font-bold text-slate-500">Unidad</label>
                          <input
                            name="variable-unit"
                            [ngModel]="variableForm().unidad"
                            (ngModelChange)="updateVariableForm('unidad', $event)"
                            class="field-control"
                            placeholder="m, %, L/s"
                          />
                        </div>
                      </div>

                      <button type="submit" [disabled]="!selectedSiteId() || busyAction() === 'variable'" class="primary-button">
                        <span class="material-symbols-outlined text-[18px]">label</span>
                        {{ busyAction() === 'variable' ? 'Guardando' : 'Guardar variable' }}
                      </button>
                    </form>

                    <div class="overflow-hidden rounded-lg border border-slate-200">
                      <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          <tr>
                            <th class="px-4 py-3">Dato</th>
                            <th class="px-4 py-3">Valor</th>
                            <th class="px-4 py-3">Alias</th>
                            <th class="px-4 py-3 text-right">Accion</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                          @for (variable of siteVariables().variables; track variable.nombre_dato) {
                            <tr class="bg-white">
                              <td class="px-4 py-3 font-mono text-xs font-bold text-slate-700">{{ variable.nombre_dato }}</td>
                              <td class="px-4 py-3 font-bold text-slate-900">{{ displayValue(variable.valor_dato) }}</td>
                              <td class="px-4 py-3">
                                @if (variable.mapping) {
                                  <div>
                                    <p class="font-bold text-slate-800">{{ variable.mapping.alias }}</p>
                                    <p class="text-xs text-slate-400">{{ variable.mapping.tipo_dato }} {{ variable.mapping.unidad || '' }}</p>
                                  </div>
                                } @else {
                                  <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">Sin alias</span>
                                }
                              </td>
                              <td class="px-4 py-3">
                                <div class="flex justify-end gap-2">
                                  <button type="button" (click)="prepareVariableMap(variable)" class="icon-button" title="Editar formulario">
                                    <span class="material-symbols-outlined text-[18px]">edit_square</span>
                                  </button>
                                  @if (variable.mapping) {
                                    <button type="button" (click)="deleteVariableMap(variable.mapping)" class="icon-button text-red-500" title="Eliminar alias">
                                      <span class="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                  }
                                </div>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              }
            }
          </main>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .field-control {
      width: 100%;
      border-radius: 0.5rem;
      border: 1px solid rgb(203 213 225);
      background: rgb(248 250 252);
      padding: 0.625rem 0.75rem;
      font-size: 0.875rem;
      color: rgb(15 23 42);
      outline: none;
      transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
    }

    .field-control:focus {
      border-color: rgb(6 182 212);
      background: white;
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.14);
    }

    .primary-button,
    .secondary-button,
    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .primary-button {
      min-height: 2.5rem;
      width: 100%;
      border-radius: 0.5rem;
      background: rgb(8 145 178);
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 800;
      color: white;
    }

    .primary-button:hover:not(:disabled) {
      background: rgb(14 116 144);
    }

    .primary-button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .secondary-button {
      min-height: 2.5rem;
      border-radius: 0.5rem;
      border: 1px solid rgb(203 213 225);
      background: white;
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
      font-weight: 800;
      color: rgb(71 85 105);
    }

    .secondary-button:hover {
      background: rgb(248 250 252);
    }

    .icon-button {
      height: 2rem;
      width: 2rem;
      border-radius: 0.5rem;
      border: 1px solid rgb(226 232 240);
      background: white;
      color: rgb(71 85 105);
    }

    .icon-button:hover:not(:disabled) {
      border-color: rgb(165 243 252);
      background: rgb(236 254 255);
      color: rgb(8 145 178);
    }
  `],
})
export class AdministrationComponent implements OnInit {
  private api = inject(AdministrationService);
  private companyService = inject(CompanyService);
  private router = inject(Router);

  readonly sectionItems: Array<{ id: SectionId; icon: string; label: string }> = [
    { id: 'empresas', icon: 'domain', label: 'Empresas' },
    { id: 'subempresas', icon: 'add_business', label: 'Subempresas' },
    { id: 'sitios', icon: 'location_on', label: 'Sitios' },
    { id: 'equipos', icon: 'memory', label: 'Equipos' },
    { id: 'variables', icon: 'data_object', label: 'Variables' },
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
  siteVariables = signal<SiteVariablesPayload>({ site: this.emptySite(), pozo_config: null, variables: [], mappings: [] });

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
  variableForm = signal<VariableForm>({ alias: '', d1: '', d2: '', tipo_dato: 'FLOAT', unidad: '' });

  allSubCompanies = computed<SubCompanyOption[]>(() =>
    this.hierarchy().flatMap((company) =>
      company.subCompanies.map((subCompany) => ({
        ...subCompany,
        companyName: company.nombre,
      }))
    )
  );

  allSites = computed<SiteOption[]>(() =>
    this.hierarchy().flatMap((company) =>
      company.subCompanies.flatMap((subCompany) =>
        subCompany.sites.map((site) => ({
          ...site,
          companyName: company.nombre,
          subCompanyName: subCompany.nombre,
        }))
      )
    )
  );

  subCompaniesForSiteForm = computed<SubCompanyOption[]>(() =>
    this.allSubCompanies().filter((subCompany) => subCompany.empresa_id === this.siteForm().empresa_id)
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
      devices: this.api.getDetectedDevices(200),
    }).subscribe({
      next: ({ hierarchy, devices }) => {
        this.hierarchy.set(hierarchy.ok ? hierarchy.data : []);
        this.detectedDevices.set(devices.ok ? devices.data : []);
        this.seedSelections();
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

  updateVariableForm(field: keyof VariableForm, value: string): void {
    this.variableForm.update((form) => ({ ...form, [field]: value }));
  }

  createCompany(event: Event): void {
    event.preventDefault();
    this.busyAction.set('company');

    this.api.createCompany(this.companyForm()).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Empresa creada.');
        this.companyForm.set({ nombre: '', rut: '', tipo_empresa: 'Agua' });
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible crear la empresa.'));
      },
    });
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
        this.subCompanyForm.update((current) => ({ ...current, nombre: '', rut: '' }));
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible crear la subempresa.'));
      },
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
    this.api.createSite(form.empresa_id, form.sub_empresa_id, {
      descripcion: form.descripcion,
      id_serial: form.id_serial,
      ubicacion: form.ubicacion || null,
      tipo_sitio: form.tipo_sitio,
      activo: form.activo,
      pozo_config: this.buildPozoConfigPayload(),
    }).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Sitio creado.');
        this.selectedSiteId.set(res.data.id);
        this.siteForm.update((current) => ({
          ...current,
          descripcion: '',
          ubicacion: '',
          profundidad_pozo_m: '',
          profundidad_sensor_m: '',
          nivel_estatico_manual_m: '',
          obra_dga: '',
          slug: '',
        }));
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible crear el sitio.'));
      },
    });
  }

  saveSelectedSite(): void {
    const siteId = this.selectedSiteId();
    const form = this.siteForm();

    if (!siteId) {
      this.setError('Selecciona un sitio.');
      return;
    }

    this.busyAction.set('site-update');
    this.api.updateSite(siteId, {
      descripcion: form.descripcion,
      id_serial: form.id_serial,
      ubicacion: form.ubicacion || null,
      tipo_sitio: form.tipo_sitio,
      activo: form.activo,
      pozo_config: this.buildPozoConfigPayload(),
    }).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Sitio actualizado.');
        this.loadDashboard();
      },
      error: (err: unknown) => {
        this.busyAction.set('');
        this.setError(this.errorMessage(err, 'No fue posible actualizar el sitio.'));
      },
    });
  }

  selectCompanyForSite(companyId: string): void {
    const firstSubCompany = this.allSubCompanies().find((subCompany) => subCompany.empresa_id === companyId);
    this.siteForm.update((form) => ({
      ...form,
      empresa_id: companyId,
      sub_empresa_id: firstSubCompany?.id || '',
    }));
  }

  selectSite(siteId: string): void {
    this.selectedSiteId.set(siteId);
    const site = this.allSites().find((item) => item.id === siteId);
    if (!site) {
      this.siteVariables.set({ site: this.emptySite(), pozo_config: null, variables: [], mappings: [] });
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
      error: (err: unknown) => this.setError(this.errorMessage(err, 'No fue posible cargar variables.')),
    });
  }

  useDeviceInSiteForm(device: DetectedDevice): void {
    this.activeSection.set('sitios');
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
    this.variableForm.set({
      alias: variable.mapping?.alias || variable.nombre_dato,
      d1: variable.nombre_dato,
      d2: variable.mapping?.d2 || '',
      tipo_dato: variable.mapping?.tipo_dato || this.guessDataType(variable.valor_dato),
      unidad: variable.mapping?.unidad || '',
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
    };

    this.busyAction.set('variable');
    this.api.createSiteVariableMap(siteId, payload).subscribe({
      next: (res) => {
        this.busyAction.set('');
        this.setSuccess(res.message || 'Variable guardada.');
        this.variableForm.set({ alias: '', d1: '', d2: '', tipo_dato: 'FLOAT', unidad: '' });
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
    if (type === 'generico') return 'Generico';
    return 'Pozo';
  }

  siteTypeBadgeClass(type: string): string {
    const base = 'rounded-md px-2 py-1 text-xs font-bold';
    if (type === 'electrico') return `${base} bg-amber-50 text-amber-700`;
    if (type === 'generico') return `${base} bg-slate-100 text-slate-600`;
    return `${base} bg-cyan-50 text-cyan-700`;
  }

  sectionButtonClass(section: SectionId): string {
    const base = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition-all';
    return this.activeSection() === section
      ? `${base} bg-cyan-50 text-cyan-800 ring-1 ring-cyan-100`
      : `${base} text-slate-500 hover:bg-slate-50 hover:text-slate-800`;
  }

  statusClass(): string {
    const base = 'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold';
    return this.status().type === 'success'
      ? `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
      : `${base} border-red-200 bg-red-50 text-red-700`;
  }

  private seedSelections(): void {
    const firstCompany = this.hierarchy()[0];
    const currentCompanyExists = this.hierarchy().some((company) => company.id === this.selectedCompanyId());
    const companyId = currentCompanyExists ? this.selectedCompanyId() : firstCompany?.id || '';
    const firstSubCompany = this.allSubCompanies().find((subCompany) => subCompany.empresa_id === companyId);
    const currentSiteExists = this.allSites().some((site) => site.id === this.selectedSiteId());

    this.selectedCompanyId.set(companyId);
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
      nivel_estatico_manual_m: this.numberOrNull(this.siteForm().nivel_estatico_manual_m),
      obra_dga: this.siteForm().obra_dga || null,
      slug: this.siteForm().slug || null,
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

  private numberOrNull(value: string): number | null {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private configNumberToString(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }
}
