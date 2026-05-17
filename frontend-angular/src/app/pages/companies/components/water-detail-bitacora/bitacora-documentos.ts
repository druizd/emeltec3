import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DocumentoRow,
  DocumentoService,
  DocumentoTipo,
  TIPO_LABELS,
  formatBytes,
} from '../../../../services/documento.service';

type TipoFiltro = DocumentoTipo | 'todos';

interface DraftUpload {
  titulo: string;
  tipo: DocumentoTipo;
  descripcion: string;
  version: string;
  fecha_vigencia: string;
}

function emptyDraft(): DraftUpload {
  return {
    titulo: '',
    tipo: 'otro',
    descripcion: '',
    version: '1.0',
    fecha_vigencia: '',
  };
}

const TIPOS: DocumentoTipo[] = [
  'ficha_tecnica',
  'datasheet',
  'certificado',
  'manual',
  'plano',
  'otro',
];

@Component({
  selector: 'app-bitacora-documentos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      @if (errorMsg()) {
        <p class="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{{ errorMsg() }}</p>
      }

      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-2">
          @for (tipo of tiposFiltro; track tipo.key) {
            <button
              type="button"
              (click)="filtroActivo.set(tipo.key)"
              [class]="filtroClass(tipo.key)"
            >
              {{ tipo.label }}
              <span
                class="ml-1 rounded-full px-1.5 text-[10px] font-black"
                [class]="filtroBadgeClass(tipo.key)"
              >
                {{ contarPorTipo(tipo.key) }}
              </span>
            </button>
          }
        </div>
        <button
          type="button"
          (click)="toggleSubida()"
          class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[12px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[16px]">{{
            mostrandoSubida() ? 'close' : 'upload_file'
          }}</span>
          {{ mostrandoSubida() ? 'Cancelar' : 'Subir documento' }}
        </button>
      </header>

      @if (mostrandoSubida()) {
        <article class="rounded-2xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 p-4">
          <p class="mb-3 text-[10px] font-black uppercase tracking-widest text-cyan-700">
            Nuevo documento
          </p>
          <div class="space-y-3">
            <div>
              <label
                class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                >Archivo (mÃ¡x 25 MB)</label
              >
              <input
                #fileInput
                type="file"
                (change)="onFileChange($event)"
                class="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />
              @if (archivoSeleccionado()) {
                <p class="mt-1 text-[11px] text-slate-500">
                  {{ archivoSeleccionado()!.name }} ({{ formatBytes(archivoSeleccionado()!.size) }})
                </p>
              }
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >TÃ­tulo</label
                >
                <input
                  type="text"
                  [(ngModel)]="draft.titulo"
                  placeholder="Ej. Cert. calibraciÃ³n caudalÃ­metro"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </div>
              <div>
                <label
                  class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >Tipo</label
                >
                <select
                  [(ngModel)]="draft.tipo"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                >
                  @for (t of tipos; track t) {
                    <option [value]="t">{{ tipoLabel(t) }}</option>
                  }
                </select>
              </div>
              <div>
                <label
                  class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >VersiÃ³n</label
                >
                <input
                  type="text"
                  [(ngModel)]="draft.version"
                  placeholder="1.0"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700"
                />
              </div>
              <div>
                <label
                  class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                  >Vigente hasta (opcional)</label
                >
                <input
                  type="date"
                  min="2020-01-01"
                  [(ngModel)]="draft.fecha_vigencia"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </div>
            </div>

            <div>
              <label
                class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                >DescripciÃ³n (opcional)</label
              >
              <textarea
                rows="2"
                [(ngModel)]="draft.descripcion"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              ></textarea>
            </div>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                (click)="toggleSubida()"
                class="rounded-xl bg-slate-100 px-4 py-2 text-[12px] font-bold text-slate-600 hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                [disabled]="uploading() || !puedeSubir()"
                (click)="subir()"
                class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                <span class="material-symbols-outlined text-[16px]">cloud_upload</span>
                {{ uploading() ? 'Subiendoâ€¦' : 'Subir' }}
              </button>
            </div>
          </div>
        </article>
      }

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Documento
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Tipo
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  VersiÃ³n
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Cargado
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @if (loading()) {
                <tr>
                  <td colspan="5" class="px-4 py-10 text-center text-[12px] text-slate-400">
                    Cargando documentosâ€¦
                  </td>
                </tr>
              } @else {
                @for (doc of documentosFiltrados(); track doc.id) {
                  <tr class="group hover:bg-slate-50/60">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2">
                        <span
                          [class]="tipoIconClass(doc.tipo)"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        >
                          <span class="material-symbols-outlined text-[18px]">{{
                            tipoIcon(doc.tipo)
                          }}</span>
                        </span>
                        <div class="min-w-0">
                          <p class="truncate font-semibold text-slate-800">{{ doc.titulo }}</p>
                          <p class="truncate text-[11px] text-slate-400">
                            {{ doc.nombre_original }} Â· {{ formatBytes(doc.size_bytes) }}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <span
                        [class]="tipoLabelClass(doc.tipo)"
                        class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      >
                        {{ tipoLabel(doc.tipo) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 font-mono text-[12px] text-slate-700">
                      v{{ doc.version || 'â€”' }}
                    </td>
                    <td class="px-4 py-3 text-[11px] text-slate-500">
                      <p>{{ formatFecha(doc.created_at) }}</p>
                      @if (doc.uploader_nombre_completo) {
                        <p class="text-[10px] text-slate-400">
                          por {{ doc.uploader_nombre_completo }}
                        </p>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          (click)="descargar(doc)"
                          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"
                          [attr.aria-label]="'Descargar ' + doc.titulo"
                        >
                          <span class="material-symbols-outlined text-[18px]">download</span>
                        </button>
                        <button
                          type="button"
                          (click)="eliminar(doc)"
                          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          [attr.aria-label]="'Eliminar ' + doc.titulo"
                        >
                          <span class="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="px-4 py-10 text-center">
                      <span class="material-symbols-outlined text-3xl text-slate-300"
                        >folder_open</span
                      >
                      <p class="mt-2 text-sm font-semibold text-slate-400">
                        Sin documentos con estos filtros
                      </p>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class BitacoraDocumentosComponent {
  private readonly documentoService = inject(DocumentoService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly tipos = TIPOS;

  readonly documentos = signal<DocumentoRow[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly filtroActivo = signal<TipoFiltro>('todos');
  readonly mostrandoSubida = signal(false);
  readonly archivoSeleccionado = signal<File | null>(null);

  draft: DraftUpload = emptyDraft();

  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly tiposFiltro: { key: TipoFiltro; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'ficha_tecnica', label: 'Ficha tÃ©cnica' },
    { key: 'datasheet', label: 'Datasheet' },
    { key: 'certificado', label: 'Certificados' },
    { key: 'manual', label: 'Manuales' },
    { key: 'plano', label: 'Planos' },
    { key: 'otro', label: 'Otros' },
  ];

  constructor() {
    effect(() => {
      const sid = this.sitioId();
      if (sid) this.recargar();
    });
  }

  private recargar(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.loading.set(true);
    this.errorMsg.set(null);
    this.documentoService.listar({ sitio_id: sid, limit: 200 }).subscribe({
      next: (rows) => {
        this.documentos.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'Error cargando documentos');
        this.loading.set(false);
      },
    });
  }

  readonly documentosFiltrados = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.documentos() : this.documentos().filter((d) => d.tipo === f);
  });

  contarPorTipo(key: TipoFiltro): number {
    return key === 'todos'
      ? this.documentos().length
      : this.documentos().filter((d) => d.tipo === key).length;
  }

  toggleSubida(): void {
    if (this.mostrandoSubida()) {
      this.mostrandoSubida.set(false);
      this.draft = emptyDraft();
      this.archivoSeleccionado.set(null);
      const input = this.fileInput()?.nativeElement;
      if (input) input.value = '';
    } else {
      this.draft = emptyDraft();
      this.mostrandoSubida.set(true);
    }
  }

  onFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) {
      this.archivoSeleccionado.set(null);
      return;
    }
    this.archivoSeleccionado.set(f);
    if (!this.draft.titulo) {
      this.draft.titulo = f.name.replace(/\.[^.]+$/, '');
    }
  }

  puedeSubir(): boolean {
    return !!(
      this.archivoSeleccionado() &&
      this.draft.titulo.trim() &&
      this.sitioId() &&
      this.empresaId()
    );
  }

  subir(): void {
    const file = this.archivoSeleccionado();
    if (!file) return;
    this.uploading.set(true);
    this.errorMsg.set(null);
    this.documentoService
      .subir({
        file,
        sitio_id: this.sitioId(),
        empresa_id: this.empresaId(),
        titulo: this.draft.titulo.trim(),
        tipo: this.draft.tipo,
        descripcion: this.draft.descripcion.trim() || null,
        version: this.draft.version.trim() || '1.0',
        fecha_vigencia: this.draft.fecha_vigencia || null,
      })
      .subscribe({
        next: (row) => {
          this.documentos.update((ds) => [row, ...ds]);
          this.toggleSubida();
          this.uploading.set(false);
        },
        error: (err) => {
          this.errorMsg.set(err?.error?.error || 'Error subiendo documento');
          this.uploading.set(false);
        },
      });
  }

  descargar(doc: DocumentoRow): void {
    this.documentoService.descargar(doc.id).subscribe({
      next: (r) => {
        window.open(r.url, '_blank', 'noopener');
      },
      error: (err) => this.errorMsg.set(err?.error?.error || 'Error generando descarga'),
    });
  }

  eliminar(doc: DocumentoRow): void {
    if (!confirm(`Â¿Eliminar "${doc.titulo}"? El archivo y su metadata se borran.`)) return;
    this.documentoService.eliminar(doc.id).subscribe({
      next: () => this.documentos.update((ds) => ds.filter((d) => d.id !== doc.id)),
      error: (err) => this.errorMsg.set(err?.error?.error || 'Error eliminando'),
    });
  }

  tipoLabel(t: DocumentoTipo): string {
    return TIPO_LABELS[t];
  }

  tipoIcon(t: DocumentoTipo): string {
    const map: Record<DocumentoTipo, string> = {
      ficha_tecnica: 'description',
      datasheet: 'table_chart',
      certificado: 'verified',
      manual: 'menu_book',
      plano: 'architecture',
      otro: 'draft',
    };
    return map[t];
  }

  tipoIconClass(t: DocumentoTipo): string {
    const map: Record<DocumentoTipo, string> = {
      ficha_tecnica: 'bg-cyan-50 text-cyan-700',
      datasheet: 'bg-emerald-50 text-emerald-700',
      certificado: 'bg-amber-50 text-amber-700',
      manual: 'bg-violet-50 text-violet-700',
      plano: 'bg-blue-50 text-blue-700',
      otro: 'bg-slate-100 text-slate-600',
    };
    return map[t];
  }

  tipoLabelClass(t: DocumentoTipo): string {
    return this.tipoIconClass(t);
  }

  filtroClass(key: TipoFiltro): string {
    const active = this.filtroActivo() === key;
    return [
      'inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  filtroBadgeClass(key: TipoFiltro): string {
    const active = this.filtroActivo() === key;
    return active ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-500';
  }

  formatBytes(b: number): string {
    return formatBytes(b);
  }

  formatFecha(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
