import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-companies-site-detail-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-8 animate-in fade-in duration-500">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="flex items-center gap-4">
          <div class="skeleton h-14 w-14 rounded-2xl"></div>
          <div class="space-y-3">
            <div class="skeleton h-8 w-64 rounded-full"></div>
            <div class="skeleton h-4 w-40 rounded-full"></div>
          </div>
        </div>

        <div class="flex flex-wrap gap-3">
          <div class="skeleton h-14 w-44 rounded-2xl"></div>
          <div class="skeleton h-14 w-56 rounded-2xl"></div>
          <div class="skeleton h-14 w-48 rounded-2xl"></div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex gap-3">
          <div class="skeleton h-12 w-32 rounded-2xl"></div>
          <div class="skeleton h-12 w-32 rounded-2xl"></div>
        </div>

        <div class="flex flex-wrap gap-3">
          <div class="skeleton h-14 w-48 rounded-2xl"></div>
          <div class="skeleton h-14 w-48 rounded-2xl"></div>
          <div class="skeleton h-14 w-28 rounded-2xl"></div>
          <div class="skeleton h-12 w-12 rounded-2xl"></div>
        </div>
      </div>

      <div class="h-1.5 rounded-full bg-cyan-600/80"></div>

      <div class="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
        <div class="space-y-6">
          <div class="flex gap-4">
            <div class="skeleton h-10 w-20 rounded-full"></div>
            <div class="skeleton h-10 w-24 rounded-full"></div>
          </div>

          <div
            class="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(360px,1.4fr)]"
          >
            <div class="skeleton h-56 rounded-[28px]"></div>
            <div class="skeleton h-56 rounded-[28px]"></div>

            <div class="rounded-[28px] border border-slate-200 bg-slate-50/60 p-5">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="skeleton h-28 rounded-2xl"></div>
                <div class="skeleton h-28 rounded-2xl"></div>
                <div class="skeleton h-28 rounded-2xl"></div>
                <div class="skeleton h-28 rounded-2xl"></div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div class="skeleton h-[360px] rounded-[28px]"></div>
            <div class="skeleton h-[360px] rounded-[28px]"></div>
          </div>

          <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div class="skeleton h-[360px] rounded-[28px]"></div>
            <div class="skeleton h-[360px] rounded-[28px]"></div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CompaniesSiteDetailSkeletonComponent {}
