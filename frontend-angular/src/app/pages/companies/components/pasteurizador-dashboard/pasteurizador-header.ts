import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-pasteurizador-header',
  standalone: true,
  template: `
    <header class="scada-header">
      <div class="site-heading">
        <span class="site-icon">
          <span class="material-symbols-outlined">factory</span>
        </span>
        <div class="title-block">
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>
      </div>

      @if (showSettings) {
        <button
          type="button"
          aria-label="Configurar variables del sitio"
          (click)="settingsClick.emit()"
        >
          <span class="material-symbols-outlined">settings</span>
        </button>
      }
    </header>
  `,
  styles: [
    `
      .scada-header {
        display: flex;
        min-height: 76px;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        border: 1px solid #e2e8f0;
        border-radius: 14px 14px 0 0;
        background: #ffffff;
        padding: 14px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .site-heading {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 13px;
      }

      .site-icon {
        display: grid;
        height: 48px;
        width: 48px;
        flex-shrink: 0;
        place-items: center;
        border: 1px solid rgba(13, 175, 189, 0.25);
        border-radius: 14px;
        background: rgba(13, 175, 189, 0.08);
        color: #0899a5;
      }

      .site-icon .material-symbols-outlined {
        font-size: 25px;
      }

      .title-block p {
        color: #94a3b8;
        font-size: 12px;
        font-weight: 800;
      }

      h1 {
        color: #0f172a;
        font-size: 22px;
        font-weight: 900;
        line-height: 1.1;
      }

      button {
        display: grid;
        height: 38px;
        width: 38px;
        flex-shrink: 0;
        place-items: center;
        border: 1px solid #dbe3ee;
        border-radius: 10px;
        background: #ffffff;
        color: #64748b;
      }

      button:hover {
        border-color: rgba(13, 175, 189, 0.35);
        color: #0899a5;
      }

      button .material-symbols-outlined {
        font-size: 22px;
      }
    `,
  ],
})
export class PasteurizadorHeaderComponent {
  @Input({ required: true }) title = 'Pasteurizador 1';
  @Input() subtitle = 'Matthei';
  @Input() showSettings = false;

  @Output() settingsClick = new EventEmitter<void>();
}
