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
    <div
      [class]="getContainerClass()"
      role="tablist"
      [attr.aria-label]="ariaLabel"
      (keydown.arrowright)="cycleTab(1); $event.preventDefault()"
      (keydown.arrowleft)="cycleTab(-1); $event.preventDefault()"
      (keydown.home)="firstTab(); $event.preventDefault()"
      (keydown.end)="lastTab(); $event.preventDefault()"
    >
      @for (tab of tabs; track tab.key) {
        <button
          type="button"
          role="tab"
          (click)="selectTab(tab.key)"
          [class]="getButtonClass(tab.key)"
          [attr.aria-selected]="activeTab === tab.key"
          [attr.aria-controls]="wireAriaControls ? 'tabpanel-' + tab.key : null"
          [attr.id]="wireAriaControls ? 'tab-' + tab.key : null"
          [attr.tabindex]="activeTab === tab.key ? 0 : -1"
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
  /**
   * Cuando true, emite `aria-controls="tabpanel-{key}"` + `id="tab-{key}"` en
   * cada tab button. Solo activar cuando el parent component también wrap
   * cada panel con `<div role="tabpanel" id="tabpanel-{key}" aria-labelledby
   * ="tab-{key}">`. Default false para no romper consumers que aún no
   * implementan tabpanel wrappers — orphan aria-controls es peor que faltar.
   */
  @Input() wireAriaControls = false;

  @Output() activeTabChange = new EventEmitter<string>();

  selectTab(tab: string): void {
    this.activeTabChange.emit(tab);
  }

  /** WAI-ARIA tablist roving-tabindex cycle. delta=1 → siguiente, -1 → anterior. */
  cycleTab(delta: 1 | -1): void {
    if (this.tabs.length === 0) return;
    const idx = this.tabs.findIndex((t) => t.key === this.activeTab);
    const nextIdx = (idx + delta + this.tabs.length) % this.tabs.length;
    this.selectTab(this.tabs[nextIdx].key);
  }

  firstTab(): void {
    if (this.tabs.length > 0) this.selectTab(this.tabs[0].key);
  }

  lastTab(): void {
    if (this.tabs.length > 0) this.selectTab(this.tabs[this.tabs.length - 1].key);
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
        'group relative inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-body-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]',
        isActive
          ? 'bg-white text-primary-container shadow-primary-glow-md ring-1 ring-primary-tint-25'
          : 'text-slate-400 hover:bg-white hover:text-slate-700',
      ].join(' ');
    }

    return [
      'flex items-center gap-2 rounded-lg px-4 py-2 text-caption font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]',
      isActive
        ? 'bg-white text-primary-container shadow-sm ring-1 ring-slate-200'
        : 'text-slate-400 hover:bg-slate-100',
    ].join(' ');
  }

  getLabelClass(): string {
    return this.variant === 'superadmin' ? 'tracking-tight' : 'uppercase tracking-widest';
  }

  getIconClass(): string {
    return this.variant === 'superadmin' ? 'text-h5' : 'text-h6';
  }
}
