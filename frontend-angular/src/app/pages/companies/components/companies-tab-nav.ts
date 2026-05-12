import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface CompaniesTabItem {
  key: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-companies-tab-nav',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="getContainerClass()" role="tablist" [attr.aria-label]="ariaLabel">
      @for (tab of tabs; track tab.key) {
        <button
          type="button"
          role="tab"
          (click)="selectTab(tab.key)"
          [class]="getButtonClass(tab.key)"
          [attr.aria-selected]="activeTab === tab.key"
          [attr.aria-controls]="'tabpanel-' + tab.key"
        >
          <span [class]="'material-symbols-outlined ' + getIconClass()" aria-hidden="true">{{
            tab.icon
          }}</span>
          <span [class]="getLabelClass()">{{ tab.label }}</span>
        </button>
      }
    </div>
  `,
})
export class CompaniesTabNavComponent {
  @Input() tabs: CompaniesTabItem[] = [];
  @Input() activeTab = '';
  @Input() variant: 'default' | 'superadmin' = 'default';
  @Input() ariaLabel = 'Pestañas de navegación';

  @Output() activeTabChange = new EventEmitter<string>();

  selectTab(tab: string): void {
    this.activeTabChange.emit(tab);
  }

  getContainerClass(): string {
    if (this.variant === 'superadmin') {
      return 'mb-6 flex flex-wrap items-center gap-1 border-b border-[#E2E8F0] pb-2';
    }

    return 'mb-8 flex flex-wrap gap-4';
  }

  getButtonClass(tabKey: string): string {
    const isActive = this.activeTab === tabKey;

    if (this.variant === 'superadmin') {
      return [
        'group relative inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]',
        isActive
          ? 'bg-white text-cyan-700 shadow-[0_2px_8px_rgba(13,175,189,0.15)] ring-1 ring-[rgba(13,175,189,0.25)]'
          : 'text-slate-400 hover:bg-white hover:text-slate-700',
      ].join(' ');
    }

    return [
      'flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]',
      isActive
        ? 'bg-white text-primary-container shadow-sm ring-1 ring-slate-200'
        : 'text-slate-400 hover:bg-slate-100',
    ].join(' ');
  }

  getLabelClass(): string {
    return this.variant === 'superadmin' ? 'tracking-tight' : 'uppercase tracking-widest';
  }

  getIconClass(): string {
    return this.variant === 'superadmin' ? 'text-[18px]' : 'text-lg';
  }
}
