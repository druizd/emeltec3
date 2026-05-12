import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-md transition-shadow"
    >
      <div class="flex justify-between mb-4">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">{{
          label
        }}</span>
        <div
          class="h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100"
        >
          <ng-content></ng-content>
        </div>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-3xl font-black text-primary tracking-tighter">{{ value }}</span>
        <span *ngIf="unit" class="text-xs font-bold text-slate-400">{{ unit }}</span>
      </div>
      <div class="flex items-center gap-1.5 mt-2">
        <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{{ trend }}</p>
      </div>
    </div>
  `,
})
export class KpiCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() unit = '';
  @Input() trend = '';
}
