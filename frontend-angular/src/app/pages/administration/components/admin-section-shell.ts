import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-admin-section-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 px-6 py-4">
        <h2 class="text-lg font-semibold text-slate-900">{{ title() }}</h2>
      </div>
      <div class="space-y-5 p-6">
        <ng-content></ng-content>
      </div>
    </section>
  `,
})
export class AdminSectionShellComponent {
  readonly title = input.required<string>();
}
