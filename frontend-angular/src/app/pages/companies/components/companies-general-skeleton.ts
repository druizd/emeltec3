import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-companies-general-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6 animate-in fade-in duration-500">
      <div class="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="flex flex-col gap-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="space-y-3">
              <div class="skeleton h-6 w-40 rounded-full"></div>
              <div class="skeleton h-4 w-24 rounded-full"></div>
            </div>

            <div class="flex flex-wrap gap-3">
              <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200">
                  <div class="skeleton h-5 w-5 rounded-lg"></div>
                </div>
                <div class="space-y-2">
                  <div class="skeleton h-3 w-20 rounded-full"></div>
                  <div class="skeleton h-4 w-28 rounded-full"></div>
                </div>
              </div>

              <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200">
                  <div class="skeleton h-5 w-5 rounded-lg"></div>
                </div>
                <div class="space-y-2">
                  <div class="skeleton h-3 w-16 rounded-full"></div>
                  <div class="skeleton h-4 w-24 rounded-full"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <div class="rounded-3xl bg-gradient-to-br from-cyan-800 via-sky-800 to-sky-700 p-5 shadow-lg shadow-sky-900/20">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 space-y-3">
                  <div class="h-3 w-24 rounded-full bg-white/20"></div>
                  <div class="h-8 w-28 rounded-full bg-white/30"></div>
                  <div class="h-3 w-20 rounded-full bg-white/20"></div>
                </div>
                <div class="h-10 w-10 rounded-xl bg-white/15"></div>
              </div>
            </div>

            <div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 space-y-3">
                  <div class="skeleton h-3 w-20 rounded-full"></div>
                  <div class="skeleton h-8 w-16 rounded-full"></div>
                  <div class="skeleton h-3 w-24 rounded-full"></div>
                </div>
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                  <div class="skeleton h-5 w-5 rounded-lg"></div>
                </div>
              </div>
            </div>

            <div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 space-y-3">
                  <div class="skeleton h-3 w-16 rounded-full"></div>
                  <div class="skeleton h-8 w-20 rounded-full"></div>
                  <div class="skeleton h-3 w-28 rounded-full"></div>
                </div>
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                  <div class="skeleton h-5 w-5 rounded-lg"></div>
                </div>
              </div>
            </div>

            <div class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 space-y-3">
                  <div class="skeleton h-3 w-24 rounded-full"></div>
                  <div class="skeleton h-8 w-16 rounded-full"></div>
                  <div class="skeleton h-3 w-24 rounded-full"></div>
                </div>
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                  <div class="skeleton h-5 w-5 rounded-lg"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <div class="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-6 space-y-3">
            <div class="skeleton h-6 w-48 rounded-full"></div>
            <div class="skeleton h-4 w-32 rounded-full"></div>
          </div>

          <div class="relative h-[340px] overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
            <div
              class="absolute inset-0"
              style="background-image: linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px); background-size: 16% 22%;"
            ></div>

            <div class="absolute left-5 right-5 top-5 flex justify-between">
              <div class="skeleton h-3 w-16 rounded-full"></div>
              <div class="skeleton h-3 w-12 rounded-full"></div>
            </div>

            <svg viewBox="0 0 100 100" class="absolute inset-6 h-[calc(100%-3rem)] w-[calc(100%-3rem)]">
              <polyline points="4,68 16,63 28,65 40,51 52,52 66,38 80,47 94,72" fill="none" stroke="#5c7ed6" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"></polyline>
              <polyline points="4,82 16,80 28,78 40,71 52,69 66,65 80,71 94,77" fill="none" stroke="#8cbf6d" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"></polyline>
              <polyline points="4,88 16,88 28,32 40,36 52,82 66,80 80,81 94,86" fill="none" stroke="#efc557" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"></polyline>
            </svg>

            <div class="absolute bottom-5 left-5 right-5 flex flex-wrap justify-center gap-4">
              <div class="flex items-center gap-2">
                <div class="h-2.5 w-2.5 rounded-full bg-[#5c7ed6]"></div>
                <div class="skeleton h-3 w-24 rounded-full"></div>
              </div>
              <div class="flex items-center gap-2">
                <div class="h-2.5 w-2.5 rounded-full bg-[#8cbf6d]"></div>
                <div class="skeleton h-3 w-24 rounded-full"></div>
              </div>
              <div class="flex items-center gap-2">
                <div class="h-2.5 w-2.5 rounded-full bg-[#efc557]"></div>
                <div class="skeleton h-3 w-24 rounded-full"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-6 flex items-center justify-between gap-4">
            <div class="space-y-3">
              <div class="skeleton h-6 w-28 rounded-full"></div>
              <div class="skeleton h-4 w-24 rounded-full"></div>
            </div>
            <div class="rounded-full bg-amber-50 px-4 py-2">
              <div class="skeleton h-3 w-16 rounded-full"></div>
            </div>
          </div>

          <div class="relative h-[340px] overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 via-slate-100/60 to-sky-50/40">
            <div
              class="absolute inset-0 opacity-70"
              style="background-image: linear-gradient(to right, rgba(203,213,225,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(203,213,225,0.55) 1px, transparent 1px); background-size: 12% 16%;"
            ></div>

            <div class="absolute left-6 top-6 h-10 w-16 rounded-xl bg-slate-200/70"></div>
            <div class="absolute right-6 top-16 h-14 w-12 rounded-xl bg-slate-200/70"></div>
            <div class="absolute bottom-8 left-10 h-8 w-20 rounded-xl bg-slate-200/60"></div>
            <div class="absolute right-8 bottom-14 h-10 w-14 rounded-xl bg-slate-200/60"></div>

            <div class="absolute left-[32%] top-[28%] h-6 w-6 rounded-full border-4 border-cyan-700 bg-white shadow-sm"></div>
            <div class="absolute left-[52%] top-[48%] h-6 w-6 rounded-full border-4 border-cyan-700 bg-white shadow-sm"></div>
            <div class="absolute left-[74%] top-[43%] h-6 w-6 rounded-full border-4 border-cyan-700 bg-white shadow-sm"></div>

            <div class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
              <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <div class="skeleton h-6 w-6 rounded-lg"></div>
              </div>
              <div class="skeleton h-3 w-28 rounded-full"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-6 space-y-3">
          <div class="skeleton h-6 w-52 rounded-full"></div>
          <div class="skeleton h-4 w-40 rounded-full"></div>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 space-y-3">
                <div class="skeleton h-3 w-20 rounded-full"></div>
                <div class="skeleton h-7 w-24 rounded-full"></div>
                <div class="skeleton h-3 w-16 rounded-full"></div>
              </div>
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-200">
                <div class="skeleton h-5 w-5 rounded-lg"></div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 space-y-3">
                <div class="skeleton h-3 w-24 rounded-full"></div>
                <div class="skeleton h-7 w-20 rounded-full"></div>
                <div class="skeleton h-3 w-24 rounded-full"></div>
              </div>
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-200">
                <div class="skeleton h-5 w-5 rounded-lg"></div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 space-y-3">
                <div class="skeleton h-3 w-16 rounded-full"></div>
                <div class="skeleton h-7 w-24 rounded-full"></div>
                <div class="skeleton h-3 w-20 rounded-full"></div>
              </div>
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-200">
                <div class="skeleton h-5 w-5 rounded-lg"></div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 space-y-3">
                <div class="skeleton h-3 w-[4.5rem] rounded-full"></div>
                <div class="skeleton h-7 w-[4.5rem] rounded-full"></div>
                <div class="skeleton h-3 w-24 rounded-full"></div>
              </div>
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-200">
                <div class="skeleton h-5 w-5 rounded-lg"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-5 flex justify-end">
          <div class="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2">
            <div class="skeleton h-3 w-24 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CompaniesGeneralSkeletonComponent {}
