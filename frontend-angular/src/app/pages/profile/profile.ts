import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AuthMode, UpdateUserProfilePayload, User } from '@emeltec/shared';
import { AuthService, type AuthUser } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { formatRutInput } from '../../shared/rut';

type AccountTab = 'users' | 'profile' | 'password';
type SecurityMode = AuthMode;
type EditableProfileField = 'nombre' | 'apellido' | 'rut_usuario' | 'telefono' | 'cargo';
const USERS_PAGE_SIZE = 20;

interface ProfileRow {
  label: string;
  value: string;
  icon: string;
  field?: EditableProfileField;
  locked?: boolean;
}

interface EditState {
  field: EditableProfileField;
  label: string;
  currentValue: string;
  value: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="min-h-full bg-[#F0F2F5] px-5 py-4">
      <div class="mb-3">
        <h1
          class="text-h4 font-bold leading-tight tracking-[0.03em] text-on-surface"
          style="font-family: 'Josefin Sans', sans-serif"
        >
          Cuenta
        </h1>
        <p class="mt-0.5 text-body-sm text-on-surface-muted">
          Perfil, seguridad y monitoreo de usuarios registrados.
        </p>
      </div>

      <nav
        class="mb-4 flex flex-wrap items-center gap-3 border-b border-[#dbe4ee] pb-3"
        aria-label="Secciones de cuenta"
      >
        @for (tab of visibleTabs(); track tab.key) {
          <button
            type="button"
            (click)="selectTab(tab.key)"
            class="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-body-sm font-bold transition-all"
            [ngClass]="
              activeTab() === tab.key
                ? 'border-primary-tint-35 bg-white text-primary shadow-[0_8px_24px_rgba(13,175,189,0.12)]'
                : 'border-transparent text-[#8b9bb4] hover:bg-white'
            "
          >
            <span class="material-symbols-outlined text-[21px]">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        }
      </nav>

      @if (errorMsg()) {
        <div
          class="anim-banner mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm font-semibold text-amber-800"
          role="status"
        >
          <span class="material-symbols-outlined text-[18px]">warning</span>
          {{ errorMsg() }}
        </div>
      }

      @if (activeTab() === 'users' && auth.canViewUsers()) {
        <section
          class="overflow-hidden rounded-xl border border-surface-container bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
        >
          <div
            class="flex flex-col gap-4 border-b border-surface-container px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
          >
            <div>
              <h2 class="text-body font-bold text-on-surface">Usuarios</h2>
              <p class="text-caption text-on-surface-muted">Registro, empresa y primer ingreso.</p>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label class="relative block min-w-0 sm:w-[320px]">
                <span
                  class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-muted"
                  >search</span
                >
                <input
                  type="search"
                  [ngModel]="userSearch()"
                  (ngModelChange)="setUserSearch($event)"
                  class="h-10 w-full rounded-lg border border-[#dbe4ee] bg-slate-50 pl-10 pr-3 text-body-sm font-semibold text-on-surface outline-none transition-colors placeholder:text-on-surface-muted focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-tint-20"
                  placeholder="Buscar usuario, correo o empresa"
                  aria-label="Buscar usuario"
                />
              </label>

              @if (usersLoading()) {
                <span
                  class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                  >Cargando</span
                >
              }
            </div>
          </div>

          @if (deleteError()) {
            <div
              class="anim-banner mx-5 mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-caption font-bold text-rose-700"
              role="alert"
            >
              <span class="material-symbols-outlined text-[17px]">error</span>
              {{ deleteError() }}
            </div>
          }

          @if (!auth.canViewUsers()) {
            <div class="px-5 py-10 text-center text-body-sm text-on-surface-variant">
              Tu perfil no tiene permisos para ver el listado de usuarios.
            </div>
          } @else {
            <div class="overflow-x-auto">
              <table class="responsive-table w-full text-left text-body-sm md:min-w-[900px]">
                <thead class="border-b border-surface-container bg-slate-50">
                  <tr>
                    <th
                      class="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                    >
                      Usuario
                    </th>
                    <th
                      class="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                    >
                      Correo
                    </th>
                    <th
                      class="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                    >
                      Empresa / Sub empresa
                    </th>
                    <th
                      class="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                    >
                      Estado
                    </th>
                    <th class="w-12 px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[#edf2f7]">
                  @for (user of pagedUsers(); track user.id) {
                    <tr class="group transition-colors hover:bg-slate-50/70">
                      <td class="px-5 py-4" data-label="Usuario">
                        <p class="font-bold text-on-surface">{{ fullName(user) }}</p>
                      </td>
                      <td class="px-5 py-4 text-on-surface-variant" data-label="Correo">
                        {{ user.email }}
                      </td>
                      <td
                        class="px-5 py-4 text-on-surface-variant"
                        data-label="Empresa / Sub empresa"
                      >
                        <p class="font-semibold text-[#475569]">
                          {{ displayValue(user.empresa_nombre, 'Por verse') }}
                        </p>
                        <p class="mt-0.5 text-caption text-on-surface-muted">
                          {{ displayValue(user.sub_empresa_nombre, 'Sin sub empresa') }}
                        </p>
                      </td>
                      <td class="px-5 py-4 text-right" data-label="Estado">
                        <span
                          class="inline-flex h-2.5 w-2.5 rounded-full ring-4"
                          [class.bg-emerald-500]="hasLoggedIn(user)"
                          [class.ring-emerald-100]="hasLoggedIn(user)"
                          [class.bg-slate-400]="!hasLoggedIn(user)"
                          [class.ring-slate-100]="!hasLoggedIn(user)"
                          [attr.aria-label]="
                            hasLoggedIn(user)
                              ? 'Primer ingreso realizado'
                              : 'Primer ingreso pendiente'
                          "
                          [attr.title]="
                            hasLoggedIn(user)
                              ? 'Primer ingreso realizado'
                              : 'Primer ingreso pendiente'
                          "
                        ></span>
                      </td>
                      <td class="px-3 py-4 text-right" data-label="">
                        @if (canDeleteUser(user)) {
                          <button
                            type="button"
                            (click)="openDeleteUser(user)"
                            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-muted opacity-0 transition-all hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-rose-200 group-hover:opacity-100"
                            aria-label="Eliminar usuario"
                            title="Eliminar usuario"
                          >
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        }
                      </td>
                    </tr>
                  }

                  @if (filteredUsers().length === 0) {
                    <tr>
                      <td
                        colspan="5"
                        class="px-5 py-10 text-center text-on-surface-muted"
                        data-label=""
                      >
                        No hay usuarios para mostrar.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (filteredUsers().length > 0) {
              <div
                class="flex flex-col gap-3 border-t border-surface-container px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p class="text-caption font-semibold text-on-surface-muted">
                  {{ usersPageStart() }}-{{ usersPageEnd() }} de {{ filteredUsers().length }}
                </p>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    (click)="goToUsersPage(currentUsersPage() - 1)"
                    [disabled]="currentUsersPage() === 1"
                    class="flex h-8 w-8 items-center justify-center rounded-lg border border-[#dbe4ee] text-on-surface-variant transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Pagina anterior"
                  >
                    <span class="material-symbols-outlined text-[18px]">chevron_left</span>
                  </button>

                  @for (page of visibleUserPages(); track page) {
                    <button
                      type="button"
                      (click)="goToUsersPage(page)"
                      class="h-8 min-w-8 rounded-lg border px-2 text-caption font-bold transition-colors"
                      [ngClass]="
                        page === currentUsersPage()
                          ? 'border-primary bg-primary text-white'
                          : 'border-[#dbe4ee] text-on-surface-variant hover:bg-slate-50'
                      "
                    >
                      {{ page }}
                    </button>
                  }

                  <button
                    type="button"
                    (click)="goToUsersPage(currentUsersPage() + 1)"
                    [disabled]="currentUsersPage() === totalUserPages()"
                    class="flex h-8 w-8 items-center justify-center rounded-lg border border-[#dbe4ee] text-on-surface-variant transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Pagina siguiente"
                  >
                    <span class="material-symbols-outlined text-[18px]">chevron_right</span>
                  </button>
                </div>
              </div>
            }
          }
        </section>
      }

      @if (deleteTarget(); as user) {
        <div
          class="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          (click)="closeDeleteUser()"
        >
          <section
            class="w-full max-w-md overflow-hidden rounded-2xl border border-surface-container bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
            (click)="$event.stopPropagation()"
          >
            <div class="border-b border-surface-container px-5 py-4">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600"
                >
                  <span class="material-symbols-outlined text-[21px]">delete</span>
                </span>
                <div>
                  <h2 class="text-body font-bold text-on-surface">Eliminar usuario</h2>
                  <p class="text-caption text-on-surface-muted">Esta accion elimina el registro.</p>
                </div>
              </div>
            </div>

            <div class="px-5 py-5">
              <p class="text-body-sm text-on-surface-variant">
                Confirma si realmente quieres eliminar a
                <strong class="font-bold text-on-surface">{{ fullName(user) }}</strong
                >.
              </p>
              <p class="mt-2 break-words text-caption font-semibold text-on-surface-muted">
                {{ user.email }}
              </p>
              @if (deleteError()) {
                <p
                  class="anim-banner mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-caption font-bold text-rose-700"
                >
                  {{ deleteError() }}
                </p>
              }
            </div>

            <div
              class="flex items-center justify-end gap-2 border-t border-surface-container bg-slate-50 px-5 py-4"
            >
              <button
                type="button"
                (click)="closeDeleteUser()"
                [disabled]="deleteSaving()"
                class="h-9 rounded-lg border border-surface-container bg-white px-4 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="confirmDeleteUser()"
                [disabled]="deleteSaving()"
                class="h-9 rounded-lg bg-rose-600 px-4 text-body-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {{ deleteSaving() ? 'Eliminando...' : 'Eliminar' }}
              </button>
            </div>
          </section>
        </div>
      }

      @if (passwordConfirmOpen()) {
        <div
          class="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          (click)="closePasswordConfirm()"
        >
          <section
            class="w-full max-w-md overflow-hidden rounded-2xl border border-surface-container bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
            (click)="$event.stopPropagation()"
          >
            <div class="border-b border-surface-container px-5 py-4">
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint-10 text-primary"
                >
                  <span class="material-symbols-outlined text-[22px]">shield_lock</span>
                </div>
                <div>
                  <h2 class="text-body font-bold text-on-surface">Confirmar cambio</h2>
                  <p class="text-caption text-on-surface-muted">
                    Tu proximo inicio usara esta clave.
                  </p>
                </div>
              </div>
            </div>
            <div class="px-5 py-5">
              <p class="text-body-sm leading-6 text-on-surface-variant">
                Estas seguro de cambiar tu contrasena?
              </p>
            </div>
            <div
              class="flex items-center justify-end gap-2 border-t border-surface-container bg-slate-50 px-5 py-4"
            >
              <button
                type="button"
                (click)="closePasswordConfirm()"
                [disabled]="passwordSaving()"
                class="h-9 rounded-lg border border-surface-container bg-white px-4 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="confirmPasswordChange()"
                [disabled]="passwordSaving()"
                class="h-9 rounded-lg bg-primary px-4 text-body-sm font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50"
              >
                {{ passwordSaving() ? 'Guardando...' : 'Confirmar' }}
              </button>
            </div>
          </section>
        </div>
      }

      @if (activeTab() === 'profile' && displayUser(); as user) {
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(260px,340px)_1fr]">
          <section
            class="rounded-xl border border-surface-container bg-white px-5 py-5 shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
          >
            <div class="flex items-start gap-4">
              <div
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-h6 font-bold text-white shadow-[0_8px_24px_rgba(13,175,189,0.24)]"
              >
                {{ initials(user) }}
              </div>
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-h6 font-bold text-on-surface">{{ fullName(user) }}</h2>
                <p class="mt-1 truncate text-body-sm font-semibold text-primary">
                  {{ displayValue(user.email) }}
                </p>
                <p
                  class="mt-3 flex items-center gap-1.5 text-body-sm font-semibold text-on-surface-variant"
                >
                  <span class="material-symbols-outlined text-[16px] text-on-surface-muted"
                    >work</span
                  >
                  {{ displayValue(user.cargo, 'Cargo no registrado') }}
                </p>
                @if (companyLine(user)) {
                  <p class="mt-1 flex items-center gap-1.5 text-caption text-on-surface-muted">
                    <span class="material-symbols-outlined text-[15px]">business</span>
                    {{ companyLine(user) }}
                  </p>
                }
              </div>
            </div>
          </section>

          <section
            class="rounded-xl border border-surface-container bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
          >
            <div class="border-b border-surface-container px-5 py-4">
              <h2 class="text-body font-bold text-on-surface">Datos personales</h2>
            </div>

            <div class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              @for (row of personalRows(); track row.label) {
                <button
                  type="button"
                  (click)="openEdit(row)"
                  [disabled]="!row.field"
                  class="group min-w-0 rounded-lg border border-surface-container bg-white px-4 py-3 text-left transition-all hover:border-primary-tint-35 hover:bg-primary-tint-08/40 hover:shadow-[0_4px_14px_rgba(13,175,189,0.10)] disabled:cursor-default disabled:hover:border-surface-container disabled:hover:bg-white disabled:hover:shadow-none"
                >
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <p
                      class="flex min-w-0 items-center gap-1.5 text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                    >
                      <span class="material-symbols-outlined text-[15px]">{{ row.icon }}</span>
                      {{ row.label }}
                    </p>
                    @if (row.locked) {
                      <span
                        class="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                      >
                        <span class="material-symbols-outlined text-[12px]">lock</span>
                        No editable
                      </span>
                    } @else {
                      <span
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <span class="material-symbols-outlined text-[17px]">edit</span>
                      </span>
                    }
                  </div>
                  <p class="break-words text-body-sm font-semibold text-on-surface">
                    {{ row.value }}
                  </p>
                </button>
              }
            </div>
          </section>

          <section
            class="rounded-xl border border-surface-container bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)] xl:col-span-2"
          >
            <div class="border-b border-surface-container px-5 py-4">
              <h2 class="text-body font-bold text-on-surface">Empresa asociada</h2>
            </div>
            <div class="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              @for (row of companyRows(); track row.label) {
                <div class="min-w-0 rounded-lg border border-surface-container bg-white px-4 py-3">
                  <p
                    class="mb-2 flex items-center gap-1.5 text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                  >
                    <span class="material-symbols-outlined text-[15px]">{{ row.icon }}</span>
                    {{ row.label }}
                  </p>
                  <p class="break-words text-body-sm font-semibold text-on-surface">
                    {{ row.value }}
                  </p>
                </div>
              }
            </div>
          </section>
        </div>
      }

      @if (activeTab() === 'password' && displayUser(); as user) {
        <div
          class="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]"
        >
          <section
            class="overflow-hidden rounded-xl border border-surface-container bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
          >
            <div class="border-b border-surface-container px-4 py-3">
              <h2 class="text-body font-bold text-on-surface">
                {{ user.has_password ? 'Cambiar contraseña' : 'Crear contraseña' }}
              </h2>
              <p class="text-caption text-on-surface-muted">
                La contraseña permite iniciar sesión sin pedir código inicial.
              </p>
            </div>
            @if (passwordMsg()) {
              <div class="anim-banner border-b border-emerald-100 bg-emerald-50 px-4 py-2">
                <p class="flex items-center gap-2 text-caption font-bold text-emerald-700">
                  <span class="material-symbols-outlined text-[17px]">check_circle</span>
                  {{ passwordMsg() }}
                </p>
              </div>
            }
            <form class="space-y-3 p-4" (submit)="savePassword($event)">
              @if (user.has_password) {
                <label class="grid gap-1">
                  <span
                    class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                  >
                    Contraseña actual
                  </span>
                  <div class="relative">
                    <span
                      class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-primary"
                      >lock</span
                    >
                    <input
                      [type]="showCurrentPassword() ? 'text' : 'password'"
                      [ngModel]="currentPassword()"
                      (ngModelChange)="currentPassword.set($event)"
                      name="currentPassword"
                      class="h-9 w-full rounded-lg border border-[#cbd5e1] bg-white pl-9 pr-10 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                    />
                    <button
                      type="button"
                      (click)="showCurrentPassword.set(!showCurrentPassword())"
                      class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-on-surface-muted transition-colors hover:bg-slate-100 hover:text-primary"
                      [attr.aria-label]="
                        showCurrentPassword()
                          ? 'Ocultar contrasena actual'
                          : 'Ver contrasena actual'
                      "
                    >
                      <span class="material-symbols-outlined text-[17px]">
                        {{ showCurrentPassword() ? 'visibility_off' : 'visibility' }}
                      </span>
                    </button>
                  </div>
                </label>
              }
              <label class="grid gap-1">
                <span
                  class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                >
                  Nueva contraseña
                </span>
                <div class="relative">
                  <span
                    class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-primary"
                    >lock</span
                  >
                  <input
                    [type]="showNewPassword() ? 'text' : 'password'"
                    minlength="8"
                    [ngModel]="newPassword()"
                    (ngModelChange)="newPassword.set($event)"
                    name="newPassword"
                    class="h-9 w-full rounded-lg border border-[#cbd5e1] bg-white pl-9 pr-10 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                  />
                  <button
                    type="button"
                    (click)="showNewPassword.set(!showNewPassword())"
                    class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-on-surface-muted transition-colors hover:bg-slate-100 hover:text-primary"
                    [attr.aria-label]="
                      showNewPassword() ? 'Ocultar nueva contrasena' : 'Ver nueva contrasena'
                    "
                  >
                    <span class="material-symbols-outlined text-[17px]">
                      {{ showNewPassword() ? 'visibility_off' : 'visibility' }}
                    </span>
                  </button>
                </div>
              </label>
              <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div class="mb-1.5 flex items-center justify-between gap-3">
                  <span
                    class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                  >
                    Seguridad
                  </span>
                  <span class="text-caption font-bold text-on-surface-variant">{{
                    passwordStrengthLabel()
                  }}</span>
                </div>
                <div class="grid grid-cols-4 gap-1.5">
                  @for (bar of [1, 2, 3, 4]; track bar) {
                    <span
                      class="h-1.5 rounded-full"
                      [ngClass]="
                        bar <= profilePasswordStrength() ? passwordStrengthColor() : 'bg-slate-200'
                      "
                    ></span>
                  }
                </div>
              </div>
              <label class="grid gap-1">
                <span
                  class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                >
                  Confirmar contraseña
                </span>
                <div class="relative">
                  <span
                    class="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-primary"
                    >lock</span
                  >
                  <input
                    [type]="showConfirmPassword() ? 'text' : 'password'"
                    [ngModel]="confirmPassword()"
                    (ngModelChange)="confirmPassword.set($event)"
                    name="confirmPassword"
                    class="h-9 w-full rounded-lg border bg-white pl-9 pr-10 text-body-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                    [style.border-color]="
                      confirmPassword() && !profilePasswordsMatch() ? '#fecaca' : '#cbd5e1'
                    "
                  />
                  <button
                    type="button"
                    (click)="showConfirmPassword.set(!showConfirmPassword())"
                    class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-on-surface-muted transition-colors hover:bg-slate-100 hover:text-primary"
                    [attr.aria-label]="
                      showConfirmPassword() ? 'Ocultar confirmacion' : 'Ver confirmacion'
                    "
                  >
                    <span class="material-symbols-outlined text-[17px]">
                      {{ showConfirmPassword() ? 'visibility_off' : 'visibility' }}
                    </span>
                  </button>
                </div>
                <p class="min-h-[16px] text-caption font-bold leading-4 text-rose-600">
                  @if (confirmPassword() && !profilePasswordsMatch()) {
                    Las contrasenas no coinciden.
                  }
                </p>
              </label>

              @if (passwordError()) {
                <p
                  class="anim-banner rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-caption font-bold text-rose-700"
                >
                  {{ passwordError() }}
                </p>
              }

              <button
                type="submit"
                [disabled]="passwordSaving() || !canSavePassword(user)"
                class="h-9 rounded-lg bg-primary px-4 text-body-sm font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
              >
                {{
                  passwordSaving()
                    ? 'Guardando...'
                    : user.has_password
                      ? 'Cambiar contraseña'
                      : 'Crear contraseña'
                }}
              </button>
            </form>
          </section>

          <section
            class="h-fit rounded-xl border border-primary-tint-25 bg-primary-tint-08/50 p-4 shadow-[0_1px_4px_rgba(15,23,42,0.04)]"
          >
            <h2 class="text-body font-bold text-on-surface">Métodos de inicio</h2>
            <p class="mt-1 text-caption text-on-surface-variant">
              Debe quedar al menos un método activo para no bloquear la cuenta.
            </p>

            <div class="mt-3 grid gap-2.5">
              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-all"
                [ngClass]="
                  securityMode() === 'password'
                    ? 'border-primary bg-white shadow-[0_6px_20px_rgba(13,175,189,0.10)]'
                    : 'border-primary-tint-20 bg-white hover:border-primary-tint-35'
                "
                [class.opacity-50]="!user.has_password"
              >
                <input
                  type="radio"
                  name="securityMode"
                  class="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  [checked]="securityMode() === 'password'"
                  [disabled]="!user.has_password"
                  (change)="setAuthMode('password')"
                />
                <span>
                  <span class="block text-body-sm font-bold text-on-surface">Solo contraseña</span>
                  <span class="text-caption text-on-surface-variant"
                    >Ingreso directo con tu contraseña.</span
                  >
                </span>
              </label>

              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-all"
                [ngClass]="
                  securityMode() === 'otp'
                    ? 'border-primary bg-white shadow-[0_6px_20px_rgba(13,175,189,0.10)]'
                    : 'border-primary-tint-20 bg-white hover:border-primary-tint-35'
                "
              >
                <input
                  type="radio"
                  name="securityMode"
                  class="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  [checked]="securityMode() === 'otp'"
                  (change)="setAuthMode('otp')"
                />
                <span>
                  <span class="block text-body-sm font-bold text-on-surface">Solo código OTP</span>
                  <span class="text-caption text-on-surface-variant"
                    >Enviaremos un código a tu correo.</span
                  >
                </span>
              </label>

              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-all"
                [ngClass]="
                  securityMode() === 'password_otp'
                    ? 'border-primary bg-white shadow-[0_6px_20px_rgba(13,175,189,0.10)]'
                    : 'border-primary-tint-20 bg-white hover:border-primary-tint-35'
                "
                [class.opacity-50]="!user.has_password"
              >
                <input
                  type="radio"
                  name="securityMode"
                  class="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  [checked]="securityMode() === 'password_otp'"
                  [disabled]="!user.has_password"
                  (change)="setAuthMode('password_otp')"
                />
                <span>
                  <span class="block text-body-sm font-bold text-on-surface">Contraseña + OTP</span>
                  <span class="text-caption text-on-surface-variant">
                    Primero contraseña, luego código por correo.
                  </span>
                </span>
              </label>
            </div>

            @if (securityMsg()) {
              <p
                class="anim-banner mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-caption font-bold text-emerald-700"
              >
                {{ securityMsg() }}
              </p>
            }
            @if (securityError()) {
              <p
                class="anim-banner mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-caption font-bold text-rose-700"
              >
                {{ securityError() }}
              </p>
            }

            <button
              type="button"
              (click)="saveSecurity()"
              [disabled]="securitySaving()"
              class="mt-3 h-9 rounded-lg bg-primary px-4 text-body-sm font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            >
              {{ securitySaving() ? 'Guardando...' : 'Guardar métodos' }}
            </button>
          </section>
        </div>
      }

      @if (editState(); as edit) {
        <div
          class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          (click)="closeEdit()"
        >
          <section
            class="w-full max-w-md overflow-hidden rounded-2xl border border-surface-container bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
            (click)="$event.stopPropagation()"
          >
            <div
              class="flex items-center justify-between border-b border-surface-container px-5 py-4"
            >
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[19px] text-primary">edit</span>
                <h2 class="text-body font-bold text-on-surface">Editar {{ edit.label }}</h2>
              </div>
              <button
                type="button"
                (click)="closeEdit()"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-muted transition-colors hover:bg-slate-100 hover:text-[#475569]"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div class="space-y-4 px-5 py-5">
              <label class="grid gap-1.5">
                <span
                  class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                >
                  Actual
                </span>
                <input
                  type="text"
                  [value]="edit.currentValue || 'No registrado'"
                  disabled
                  class="h-10 rounded-lg border border-surface-container bg-slate-50 px-3 text-body-sm font-semibold text-on-surface-variant"
                />
              </label>

              <label class="grid gap-1.5">
                <span
                  class="text-caption-xs font-bold uppercase tracking-[0.14em] text-on-surface-muted"
                >
                  Nuevo
                </span>
                <input
                  #editInput
                  type="text"
                  [ngModel]="edit.value"
                  (ngModelChange)="setEditValue($event)"
                  [attr.inputmode]="edit.field === 'telefono' ? 'tel' : 'text'"
                  class="h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-body-sm font-semibold text-on-surface outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-tint-20"
                />
              </label>

              @if (editError()) {
                <div
                  class="anim-banner rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-caption font-semibold text-rose-700"
                  role="alert"
                >
                  {{ editError() }}
                </div>
              }
            </div>

            <div
              class="flex items-center justify-end gap-2 border-t border-surface-container bg-slate-50 px-5 py-4"
            >
              <button
                type="button"
                (click)="closeEdit()"
                class="h-9 rounded-lg border border-surface-container bg-white px-4 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="saveEdit()"
                [disabled]="editSaving() || !canSaveEdit(edit)"
                class="h-9 rounded-lg bg-primary px-4 text-body-sm font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
              >
                {{ editSaving() ? 'Guardando...' : 'Confirmar' }}
              </button>
            </div>
          </section>
        </div>
      }
    </section>
  `,
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);

  @ViewChild('editInput') editInputRef?: ElementRef<HTMLInputElement>;

  readonly tabs: { key: AccountTab; label: string; icon: string }[] = [
    { key: 'profile', label: 'Mi perfil', icon: 'person' },
    { key: 'password', label: 'Contraseña', icon: 'shield_lock' },
    { key: 'users', label: 'Usuarios', icon: 'groups' },
  ];

  readonly visibleTabs = computed(() =>
    this.auth.canViewUsers() ? this.tabs : this.tabs.filter((tab) => tab.key !== 'users'),
  );

  readonly activeTab = signal<AccountTab>('profile');
  // AuthUser: hasta hidratar desde /api/users/me, la sesión restaurada solo
  // trae la proyección mínima (sin email/RUT/teléfono).
  readonly profile = signal<AuthUser | null>(null);
  readonly users = signal<User[]>([]);
  readonly userSearch = signal('');
  readonly usersPage = signal(1);
  readonly loading = signal(true);
  readonly usersLoading = signal(false);
  readonly errorMsg = signal('');
  readonly deleteTarget = signal<User | null>(null);
  readonly deleteSaving = signal(false);
  readonly deleteError = signal('');
  readonly editState = signal<EditState | null>(null);
  readonly editSaving = signal(false);
  readonly editError = signal('');

  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly showCurrentPassword = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly passwordConfirmOpen = signal(false);
  readonly passwordSaving = signal(false);
  readonly passwordMsg = signal('');
  readonly passwordError = signal('');
  readonly profilePasswordStrength = computed(() => this.scorePassword(this.newPassword()));
  readonly profilePasswordsMatch = computed(
    () => !this.confirmPassword() || this.newPassword() === this.confirmPassword(),
  );
  readonly securityMode = signal<SecurityMode>('password');
  readonly securitySaving = signal(false);
  readonly securityMsg = signal('');
  readonly securityError = signal('');

  readonly displayUser = computed(() => this.profile() ?? this.auth.user());

  readonly filteredUsers = computed(() => {
    const query = this.normalizeUserSearch(this.userSearch());
    if (!query) return this.users();

    return this.users().filter((user) =>
      this.normalizeUserSearch(
        [this.fullName(user), user.email, user.empresa_nombre, user.sub_empresa_nombre, user.cargo]
          .filter(Boolean)
          .join(' '),
      ).includes(query),
    );
  });

  readonly totalUserPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredUsers().length / USERS_PAGE_SIZE)),
  );

  readonly currentUsersPage = computed(() =>
    Math.min(Math.max(this.usersPage(), 1), this.totalUserPages()),
  );

  readonly pagedUsers = computed(() => {
    const start = (this.currentUsersPage() - 1) * USERS_PAGE_SIZE;
    return this.filteredUsers().slice(start, start + USERS_PAGE_SIZE);
  });

  readonly usersPageStart = computed(() => {
    if (this.filteredUsers().length === 0) return 0;
    return (this.currentUsersPage() - 1) * USERS_PAGE_SIZE + 1;
  });

  readonly usersPageEnd = computed(() =>
    Math.min(this.currentUsersPage() * USERS_PAGE_SIZE, this.filteredUsers().length),
  );

  readonly visibleUserPages = computed(() => {
    const total = this.totalUserPages();
    const current = this.currentUsersPage();
    const start = Math.max(1, Math.min(current - 2, total - 4));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });

  readonly personalRows = computed<ProfileRow[]>(() => {
    const user = this.displayUser();
    if (!user) return [];

    return [
      { label: 'Nombre', value: this.displayValue(user.nombre), icon: 'badge', field: 'nombre' },
      {
        label: 'Apellido',
        value: this.displayValue(user.apellido, 'No registrado'),
        icon: 'badge',
        field: 'apellido',
      },
      {
        label: 'RUT',
        value: this.displayValue(user.rut_usuario, 'No registrado'),
        icon: 'fingerprint',
        field: 'rut_usuario',
      },
      {
        label: 'Teléfono',
        value: this.displayValue(user.telefono, 'No registrado'),
        icon: 'call',
        field: 'telefono',
      },
      {
        label: 'Cargo',
        value: this.displayValue(user.cargo, 'No registrado'),
        icon: 'work',
        field: 'cargo',
      },
      { label: 'Correo', value: this.displayValue(user.email), icon: 'mail', locked: true },
    ];
  });

  readonly companyRows = computed<ProfileRow[]>(() => {
    const user = this.displayUser();
    if (!user) return [];

    return [
      {
        label: 'Empresa',
        value: this.displayValue(user.empresa_nombre, 'Sin empresa asignada'),
        icon: 'business',
      },
      {
        label: 'Sub empresa',
        value: this.displayValue(user.sub_empresa_nombre, 'Sin sub empresa asignada'),
        icon: 'groups',
      },
    ];
  });

  ngOnInit(): void {
    this.loadProfile();
    this.loadUsers();
  }

  selectTab(tab: AccountTab): void {
    if (tab === 'users' && !this.auth.canViewUsers()) {
      this.activeTab.set('profile');
      return;
    }

    this.activeTab.set(tab);
  }

  loadProfile(): void {
    this.profile.set(this.auth.user());
    this.loading.set(true);
    this.errorMsg.set('');

    this.userService.getCurrentUser().subscribe({
      next: (res) => {
        if (res.ok) this.setProfile(res.data);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMsg.set(
          err.error?.error ?? err.error?.message ?? 'No se pudo actualizar la ficha del perfil.',
        );
      },
    });
  }

  loadUsers(): void {
    if (!this.auth.canViewUsers()) {
      this.users.set([]);
      if (this.activeTab() === 'users') this.activeTab.set('profile');
      return;
    }

    this.usersLoading.set(true);
    this.userService.getUsers().subscribe({
      next: (res) => {
        this.users.set(res.ok ? res.data : []);
        this.goToUsersPage(this.currentUsersPage());
        this.usersLoading.set(false);
      },
      error: () => {
        this.users.set([]);
        this.usersLoading.set(false);
      },
    });
  }

  setUserSearch(value: string): void {
    this.userSearch.set(value);
    this.usersPage.set(1);
  }

  goToUsersPage(page: number): void {
    this.usersPage.set(Math.min(Math.max(page, 1), this.totalUserPages()));
  }

  canDeleteUser(user: User): boolean {
    return user.id !== this.auth.user()?.id && this.auth.isSuperAdmin();
  }

  openDeleteUser(user: User): void {
    if (!this.canDeleteUser(user)) return;
    this.deleteTarget.set(user);
    this.deleteError.set('');
  }

  closeDeleteUser(): void {
    if (this.deleteSaving()) return;
    this.deleteTarget.set(null);
    this.deleteError.set('');
  }

  confirmDeleteUser(): void {
    const user = this.deleteTarget();
    if (!user || !this.canDeleteUser(user)) return;

    this.deleteSaving.set(true);
    this.deleteError.set('');

    this.userService.deleteUser(user.id).subscribe({
      next: (res) => {
        if (res.ok) {
          this.users.set(this.users().filter((item) => item.id !== user.id));
          this.deleteTarget.set(null);
          this.goToUsersPage(this.currentUsersPage());
        } else {
          this.deleteError.set(res.error ?? res.message ?? 'No se pudo eliminar el usuario.');
        }
        this.deleteSaving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.deleteSaving.set(false);
        this.deleteError.set(
          err.error?.error ?? err.error?.message ?? 'No se pudo eliminar el usuario.',
        );
      },
    });
  }

  openEdit(row: ProfileRow): void {
    if (!row.field) return;
    const currentValue = this.editableValue(row.field);
    this.editState.set({ field: row.field, label: row.label, currentValue, value: currentValue });
    this.editError.set('');
    setTimeout(() => this.editInputRef?.nativeElement.focus(), 0);
  }

  setEditValue(value: string): void {
    const edit = this.editState();
    if (!edit) return;
    this.editState.set({
      ...edit,
      value: edit.field === 'rut_usuario' ? formatRutInput(value) : value,
    });
  }

  closeEdit(): void {
    if (this.editSaving()) return;
    this.editState.set(null);
    this.editError.set('');
  }

  saveEdit(): void {
    const edit = this.editState();
    if (!edit || !this.canSaveEdit(edit)) return;

    const value = edit.value.trim();
    const payload: UpdateUserProfilePayload = {};
    if (edit.field === 'nombre') payload.nombre = value;
    else payload[edit.field] = value || null;

    this.editSaving.set(true);
    this.editError.set('');

    this.userService.updateCurrentUser(payload).subscribe({
      next: (res) => {
        if (res.ok) {
          this.setProfile(res.data);
          this.editState.set(null);
        }
        this.editSaving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.editSaving.set(false);
        this.editError.set(
          err.error?.error ?? err.error?.message ?? 'No se pudo actualizar este dato.',
        );
      },
    });
  }

  savePassword(event: Event): void {
    event.preventDefault();
    const user = this.displayUser();
    if (!user) return;
    if (!this.canSavePassword(user)) {
      this.passwordMsg.set('');
      this.passwordError.set(this.getPasswordValidationMessage(user));
      return;
    }

    this.passwordError.set('');
    this.passwordConfirmOpen.set(true);
  }

  closePasswordConfirm(): void {
    if (this.passwordSaving()) return;
    this.passwordConfirmOpen.set(false);
  }

  confirmPasswordChange(): void {
    const user = this.displayUser();
    if (!user || !this.canSavePassword(user)) {
      this.passwordConfirmOpen.set(false);
      return;
    }

    this.passwordSaving.set(true);
    this.passwordMsg.set('');
    this.passwordError.set('');

    this.userService
      .updateCurrentPassword({
        current_password: this.currentPassword(),
        new_password: this.newPassword(),
      })
      .subscribe({
        next: (res) => {
          if (res.ok) {
            this.setProfile(res.data);
            this.currentPassword.set('');
            this.newPassword.set('');
            this.confirmPassword.set('');
            this.showCurrentPassword.set(false);
            this.showNewPassword.set(false);
            this.showConfirmPassword.set(false);
            this.passwordConfirmOpen.set(false);
            this.passwordMsg.set('Contraseña actualizada.');
          }
          this.passwordSaving.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.passwordSaving.set(false);
          this.passwordConfirmOpen.set(false);
          this.passwordError.set(
            err.error?.error ?? err.error?.message ?? 'No se pudo guardar la contraseña.',
          );
        },
      });
  }

  saveSecurity(): void {
    const user = this.displayUser();
    const authMode = this.securityMode();

    if (!user) return;
    if (['password', 'password_otp'].includes(authMode) && !user.has_password) {
      this.securityMsg.set('');
      this.securityError.set('Crea una contraseña antes de activar este método.');
      return;
    }

    this.securitySaving.set(true);
    this.securityMsg.set('');
    this.securityError.set('');

    this.userService
      .updateCurrentSecurity({
        auth_mode: authMode,
      })
      .subscribe({
        next: (res) => {
          if (res.ok) {
            this.setProfile(res.data);
            this.securityMsg.set('Métodos actualizados.');
          }
          this.securitySaving.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.securitySaving.set(false);
          this.securityError.set(
            err.error?.error ?? err.error?.message ?? 'No se pudieron guardar los métodos.',
          );
        },
      });
  }

  setAuthMode(mode: SecurityMode): void {
    this.securityMode.set(mode);
  }

  canSaveEdit(edit: EditState): boolean {
    const value = edit.value.trim();
    if (edit.field === 'nombre' && !value) return false;
    return value !== edit.currentValue.trim();
  }

  canSavePassword(user: AuthUser): boolean {
    if (this.newPassword().length < 8) return false;
    if (this.profilePasswordStrength() < 2) return false;
    if (this.newPassword() !== this.confirmPassword()) return false;
    if (user.has_password && !this.currentPassword()) return false;
    return true;
  }

  passwordStrengthLabel(): string {
    return ['Muy debil', 'Debil', 'Media', 'Buena', 'Fuerte'][this.profilePasswordStrength()];
  }

  passwordStrengthColor(): string {
    return ['bg-rose-400', 'bg-orange-400', 'bg-amber-400', 'bg-teal-400', 'bg-emerald-500'][
      this.profilePasswordStrength()
    ];
  }

  hasLoggedIn(user: User): boolean {
    return Boolean(user.activated_at);
  }

  fullName(user: User): string {
    return [user.nombre, user.apellido].filter(Boolean).join(' ').trim() || 'Usuario';
  }

  initials(user: User): string {
    const first = user.nombre?.charAt(0) ?? '';
    const last = user.apellido?.charAt(0) ?? '';
    return `${first}${last}`.trim().toUpperCase() || this.fullName(user).slice(0, 2).toUpperCase();
  }

  companyLine(user: User): string {
    return [user.empresa_nombre, user.sub_empresa_nombre].filter(Boolean).join(' · ');
  }

  displayValue(value: string | null | undefined, fallback = 'No informado'): string {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  private normalizeUserSearch(value: string | null | undefined): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private getPasswordValidationMessage(user: AuthUser): string {
    if (user.has_password && !this.currentPassword()) return 'Ingresa tu contraseña actual.';
    if (this.newPassword().length < 8)
      return 'La nueva contraseña debe tener al menos 8 caracteres.';
    if (this.profilePasswordStrength() < 2)
      return 'Usa una contraseña con mayusculas, numeros o simbolos.';
    if (this.newPassword() !== this.confirmPassword()) return 'Las contraseñas no coinciden.';
    return 'Revisa los datos antes de continuar.';
  }

  private scorePassword(value: string): number {
    if (!value) return 0;

    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    if (value.length >= 12 && score < 4) score += 1;

    return Math.min(score, 4);
  }

  private setProfile(user: User): void {
    this.profile.set(user);
    this.auth.updateUser(user);
    this.securityMode.set(user.auth_mode ?? (user.has_password ? 'password' : 'otp'));
  }

  private editableValue(field: EditableProfileField): string {
    const user = this.displayUser();
    if (!user) return '';
    return this.displayValue(user[field], '');
  }
}
