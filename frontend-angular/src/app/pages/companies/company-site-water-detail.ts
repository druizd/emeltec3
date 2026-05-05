import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CompanyService } from '../../services/company.service';
import { AuthService } from '../../services/auth.service';
import { CompaniesSiteDetailSkeletonComponent } from './components/companies-site-detail-skeleton';

interface SiteContext { company: any; subCompany: any; site: any; }
interface DgaRecord { fecha: string; nivel: string; caudal: string; totalizador: string; estado: 'Enviado' | 'Pendiente'; }

@Component({
  selector: 'app-company-site-water-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, CompaniesSiteDetailSkeletonComponent],
  template: `
    <div class="min-h-full" style="background: #F0F2F5;">

      @if (loading() && !siteContext()) {
        <app-companies-site-detail-skeleton />
      } @else if (siteContext(); as context) {

        <!-- ── Site header strip ──────────────────────────── -->
        <div style="background: #F8FAFC; border-bottom: 2px solid #0DAFBD; padding: 10px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <div style="width: 38px; height: 38px; border-radius: 9px; background: rgba(13,175,189,0.08); border: 1px solid rgba(13,175,189,0.2); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <span class="material-symbols-outlined" style="font-size: 18px; color: #0DAFBD;">water_drop</span>
          </div>
          <div>
            <div style="font-family: 'Josefin Sans', sans-serif; font-size: 16px; font-weight: 700; color: #1E293B; letter-spacing: 0.02em; line-height: 1.1;">{{ getSiteName(context) }}</div>
            <div style="font-size: 11px; color: #94A3B8; margin-top: 2px;">{{ context.subCompany.nombre }}</div>
          </div>
          <div style="display: flex; gap: 6px; margin-left: 12px; flex-wrap: wrap;">
            <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 500; color: #16A34A; display: flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: #22C55E; display: inline-block;"></span>
              hace 0 segundos
            </div>
            <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #2563EB; display: flex; align-items: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 10px;">schedule</span>
              26 abr 2026, 22:23
            </div>
            <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #16A34A; display: flex; align-items: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 10px;">check_circle</span>
              Reporte DGA · Aceptado · 17:00
            </div>
          </div>
          <div style="margin-left: auto; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 12px; color: #94A3B8;">Desde</span>
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 5px;">
              <span class="material-symbols-outlined" style="font-size: 12px;">calendar_month</span>25-04-2026
            </div>
            <span style="font-size: 12px; color: #94A3B8;">Hasta</span>
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: #475569; display: flex; align-items: center; gap: 5px;">
              <span class="material-symbols-outlined" style="font-size: 12px;">calendar_month</span>26-04-2026
            </div>
            <button type="button" style="background: #0DAFBD; border: none; border-radius: 4px; padding: 5px 14px; font-size: 11px; font-weight: 700; color: #fff; cursor: pointer; font-family: 'Josefin Sans', sans-serif; letter-spacing: 0.08em; text-transform: uppercase;">Aplicar</button>
            <button type="button" style="background: none; border: none; cursor: pointer; color: #94A3B8; padding: 4px; display: flex; align-items: center; justify-content: center;">
              <span class="material-symbols-outlined" style="font-size: 16px;">settings</span>
            </button>
          </div>
        </div>

        <!-- ── Inner tabs: DGA / Operación ──────────────────── -->
        <div style="background: #FFFFFF; border-bottom: 1px solid #E2E8F0; padding: 0 20px; display: flex; gap: 0;">
          @for (tab of ['DGA','Operación']; track tab) {
            <button (click)="activeMonitorTab.set(tab)"
              [style.color]="activeMonitorTab() === tab ? '#0899A5' : '#64748B'"
              [style.border-bottom]="activeMonitorTab() === tab ? '2px solid #0DAFBD' : '2px solid transparent'"
              style="display: flex; align-items: center; gap: 5px; padding: 12px 16px; font-size: 13px; font-weight: 500; background: none; border: none; border-top: 2px solid transparent; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s;">
              <span class="material-symbols-outlined" style="font-size: 13px;">{{ tab === 'DGA' ? 'layers' : 'monitoring' }}</span>
              {{ tab }}
            </button>
          }
        </div>

        <!-- ══ DGA TAB ═══════════════════════════════════════ -->
        @if (activeMonitorTab() === 'DGA') {
          <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">

            <!-- KPI row -->
            <div style="display: grid; grid-template-columns: repeat(4,1fr); gap: 8px;">
              <div style="background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: 10px; padding: 12px 16px; text-align: center;">
                <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #16A34A; margin-bottom: 4px; font-family: 'Josefin Sans', sans-serif;">Enviados</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: #16A34A;">622</div>
                <div style="font-size: 11px; color: #16A34A; opacity: 0.7;">registros exitosos</div>
              </div>
              <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 16px; text-align: center;">
                <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 4px; font-family: 'Josefin Sans', sans-serif;">Último Envío</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: #1E293B; margin-top: 6px;">26 abr 2026</div>
                <div style="font-size: 11px; color: #64748B;">21:00</div>
              </div>
              <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 16px; text-align: center;">
                <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 4px; font-family: 'Josefin Sans', sans-serif;">Tasa de Éxito</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: #1E293B;">100<span style="font-size: 16px;">%</span></div>
              </div>
              <div style="background: rgba(248,113,113,0.06); border: 1px solid rgba(248,113,113,0.15); border-radius: 10px; padding: 12px 16px; text-align: center;">
                <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #F87171; margin-bottom: 4px; font-family: 'Josefin Sans', sans-serif;">Rechazados</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: #F87171;">0</div>
                <div style="font-size: 11px; color: #F87171; opacity: 0.7;">por la DGA</div>
              </div>
            </div>

            <!-- Well diagram + metric panels + Caudal + Quick actions -->
            <div style="display: flex; gap: 10px; align-items: flex-start;">

              <!-- Well diagram card -->
              <div style="background: #FFFFFF; border: 1px solid rgba(13,175,189,0.3); border-radius: 12px; padding: 14px 16px; box-shadow: 0 0 0 1px rgba(13,175,189,0.08), 0 2px 10px rgba(0,0,0,0.06); flex-shrink: 0;">
                <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 8px; font-family: 'Josefin Sans', sans-serif;">Diagrama del Pozo</div>
                <div style="display: flex; gap: 14px; align-items: center;">

                  <!-- SVG Well -->
                  <svg width="200" height="220" style="flex-shrink: 0; overflow: visible;">
                    <defs>
                      <linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.7"/>
                        <stop offset="100%" stop-color="#067D88" stop-opacity="0.9"/>
                      </linearGradient>
                      <pattern id="soil2" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                        <rect width="8" height="8" fill="#F5EDD8"/>
                        <circle cx="3" cy="3" r="1" fill="#C4A882" opacity="0.6"/>
                        <circle cx="7" cy="7" r="0.7" fill="#C4A882" opacity="0.4"/>
                      </pattern>
                      <clipPath id="wc2">
                        <rect x="76" y="30" width="68" height="180"/>
                      </clipPath>
                    </defs>
                    <!-- Soil -->
                    <rect x="0" y="30" width="72" height="180" fill="url(#soil2)"/>
                    <rect x="144" y="30" width="56" height="180" fill="url(#soil2)"/>
                    <!-- Surface -->
                    <rect x="0" y="0" width="200" height="30" fill="#8B7355" opacity="0.15"/>
                    <line x1="0" y1="30" x2="200" y2="30" stroke="#8B7355" stroke-width="2"/>
                    <!-- Grass marks -->
                    <line x1="8" y1="30" x2="5" y2="24" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="18" y1="30" x2="15" y2="24" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="28" y1="30" x2="25" y2="24" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="155" y1="30" x2="152" y2="24" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="168" y1="30" x2="165" y2="24" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="180" y1="30" x2="177" y2="24" stroke="#6B9B37" stroke-width="1.5" stroke-linecap="round"/>
                    <!-- Empty upper well -->
                    <rect x="76" y="30" width="68" height="36" fill="#F0F9FF" opacity="0.9"/>
                    <!-- Water fill -->
                    <rect x="76" y="66" width="68" height="144" fill="url(#wg2)" clip-path="url(#wc2)"/>
                    <!-- Wave surface -->
                    <path d="M76,66 q10,-4 20,0 q10,4 20,0 q10,-4 20,0" fill="none" stroke="#0DAFBD" stroke-width="1.5" opacity="0.8"/>
                    <!-- Fill % -->
                    <text x="110" y="138" font-size="14" font-weight="700" fill="white" text-anchor="middle" font-family="JetBrains Mono" opacity="0.9">82%</text>
                    <!-- Well walls -->
                    <rect x="72" y="30" width="7" height="180" fill="#94A3B8" rx="2"/>
                    <rect x="141" y="30" width="7" height="180" fill="#94A3B8" rx="2"/>
                    <rect x="72" y="204" width="76" height="6" fill="#64748B" rx="2"/>
                    <!-- Nivel freático line -->
                    <line x1="48" y1="66" x2="148" y2="66" stroke="#0DAFBD" stroke-width="1.5" stroke-dasharray="4 2"/>
                    <circle cx="48" cy="66" r="3" fill="#0DAFBD"/>
                    <text x="46" y="61" font-size="9" fill="#0DAFBD" font-weight="600" font-family="DM Sans" text-anchor="end">Nivel</text>
                    <text x="46" y="78" font-size="9" fill="#0DAFBD" font-weight="600" font-family="DM Sans" text-anchor="end">Freático</text>
                    <!-- Sensor -->
                    <line x1="148" y1="186" x2="168" y2="186" stroke="#F97316" stroke-width="1.5" stroke-dasharray="3 2"/>
                    <rect x="168" y="181" width="10" height="10" fill="#F97316" rx="2"/>
                    <text x="182" y="190" font-size="9" fill="#F97316" font-family="DM Sans" font-weight="600">Sensor</text>
                    <!-- Surface label -->
                    <text x="196" y="26" font-size="9" fill="#64748B" font-family="DM Sans" text-anchor="end">Superficie</text>
                    <!-- Depth arrow -->
                    <line x1="60" y1="32" x2="60" y2="208" stroke="#CBD5E1" stroke-width="1"/>
                    <line x1="56" y1="32" x2="64" y2="32" stroke="#CBD5E1" stroke-width="1"/>
                    <line x1="56" y1="208" x2="64" y2="208" stroke="#CBD5E1" stroke-width="1"/>
                    <text x="58" y="120" font-size="9" fill="#94A3B8" font-family="JetBrains Mono"
                      text-anchor="middle" transform="rotate(-90,58,120)">18m prof.</text>
                  </svg>

                  <!-- Stats column -->
                  <div style="display: flex; flex-direction: column; gap: 10px;">
                    <div style="background: rgba(13,175,189,0.06); border: 1px solid rgba(13,175,189,0.2); border-radius: 8px; padding: 10px 14px;">
                      <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 3px; font-family: 'Josefin Sans', sans-serif;">Nivel Freático</div>
                      <div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: #0DAFBD; line-height: 1;">14.70<span style="font-size: 13px; color: #64748B; margin-left: 3px;">m</span></div>
                      <div style="font-size: 10px; color: #94A3B8; margin-top: 2px;">desde superficie</div>
                    </div>
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 14px;">
                      <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 3px; font-family: 'Josefin Sans', sans-serif;">Llenado</div>
                      <div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: #1E293B; line-height: 1;">82<span style="font-size: 12px; color: #64748B;">%</span></div>
                      <div style="margin-top: 6px; height: 5px; background: #E2E8F0; border-radius: 999px; overflow: hidden;">
                        <div style="width: 82%; height: 100%; background: linear-gradient(90deg,#0DAFBD,#22C55E); border-radius: 999px;"></div>
                      </div>
                    </div>
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 14px;">
                      <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 3px; font-family: 'Josefin Sans', sans-serif;">Prof. Total</div>
                      <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 600; color: #475569; line-height: 1;">18 m</div>
                    </div>
                    <div style="background: #FFF7F0; border: 1px solid #FED7AA; border-radius: 8px; padding: 10px 14px;">
                      <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #F97316; margin-bottom: 3px; font-family: 'Josefin Sans', sans-serif; display: flex; align-items: center; gap: 4px;">
                        <span style="width: 6px; height: 6px; border-radius: 2px; background: #F97316; display: inline-block;"></span>Sensor
                      </div>
                      <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 600; color: #475569; line-height: 1;">16.5 m</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right column: Caudal + Quick actions -->
              <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0;">

                <!-- Caudal card -->
                <div style="background: #FFFFFF; border: 1px solid rgba(13,175,189,0.35); border-radius: 10px; padding: 16px; box-shadow: 0 0 0 1px rgba(13,175,189,0.1), 0 2px 8px rgba(0,0,0,0.06);">
                  <div style="font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 6px; font-family: 'Josefin Sans', sans-serif;">Caudal Actual</div>
                  <div style="display: flex; align-items: baseline; gap: 4px;">
                    <span style="font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: #0DAFBD;">0.00</span>
                    <span style="font-family: 'JetBrains Mono', monospace; font-size: 15px; color: #64748B;">L/s</span>
                  </div>
                  <div style="font-size: 11px; color: #16A34A; margin-top: 5px; display: flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-outlined" style="font-size: 11px;">shield</span>
                    Límite DGA: 25.0 L/s
                  </div>
                  <div style="margin-top: 8px;">
                    <svg viewBox="0 0 240 36" style="width: 100%; height: 36px; display: block;">
                      <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.25"/>
                          <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02"/>
                        </linearGradient>
                      </defs>
                      <path d="M0 32 L26 32 L52 30 L78 20 L104 10 L130 18 L156 28 L182 32 L208 32 L240 32 L240 36 L0 36 Z" fill="url(#cg)"/>
                      <path d="M0 32 L26 32 L52 30 L78 20 L104 10 L130 18 L156 28 L182 32 L208 32 L240 32" fill="none" stroke="#0DAFBD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>

                <!-- Quick actions -->
                <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px;">
                  <div style="font-size: 12px; font-weight: 600; color: #1E293B; margin-bottom: 10px;">Acciones Rápidas</div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    @for (action of quickActions; track action.title) {
                      <button type="button" (click)="action.onClick && action.onClick()"
                        style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px; text-align: left; cursor: pointer; transition: all 0.12s;"
                        (mouseenter)="$event.currentTarget.style.borderColor='rgba(13,175,189,0.3)'"
                        (mouseleave)="$event.currentTarget.style.borderColor='#E2E8F0'">
                        <span class="material-symbols-outlined" [style.color]="action.color" style="font-size: 14px;">{{ action.icon }}</span>
                        <div style="font-size: 12px; font-weight: 600; color: #1E293B; margin-top: 5px;">{{ action.title }}</div>
                        <div style="font-size: 10px; color: #94A3B8;">{{ action.subtitle }}</div>
                      </button>
                    }
                  </div>
                </div>
              </div>
            </div>

            <!-- Records table -->
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
              <div style="padding: 12px 16px; border-bottom: 1px solid #F1F5F9; display: flex; justify-content: space-between; align-items: center; background: #F8FAFC;">
                <span style="font-size: 13px; font-weight: 600; color: #1E293B;">Detalle de Registros</span>
                <span style="font-size: 11px; color: #94A3B8;">720 registros en el período</span>
              </div>
              <div style="overflow-x: auto;">
                <table style="width: 100%; min-width: 700px; border-collapse: collapse; font-size: 12px;">
                  <thead>
                    <tr style="border-bottom: 1px solid #F1F5F9; background: #F8FAFC;">
                      @for (h of ['Fecha','Nv. Freático [m]','Caudal [l/s]','Totalizador [m³]','Estado']; track h) {
                        <th style="padding: 8px 16px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94A3B8; font-family: 'Josefin Sans', sans-serif;">{{ h }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of records; track row.fecha) {
                      <tr style="border-bottom: 1px solid #F1F5F9; transition: background 0.1s;"
                        (mouseenter)="$event.currentTarget.style.background='#F8FAFC'"
                        (mouseleave)="$event.currentTarget.style.background='transparent'">
                        <td style="padding: 9px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #94A3B8;">{{ row.fecha }}</td>
                        <td style="padding: 9px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #1E293B;">{{ row.nivel }}</td>
                        <td style="padding: 9px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #1E293B;">{{ row.caudal }}</td>
                        <td style="padding: 9px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #1E293B;">{{ row.totalizador }}</td>
                        <td style="padding: 9px 16px;">
                          <span [style.background]="row.estado === 'Enviado' ? '#F0FDF4' : '#FFFBEB'"
                            [style.color]="row.estado === 'Enviado' ? '#16A34A' : '#D97706'"
                            [style.border]="'1px solid ' + (row.estado === 'Enviado' ? '#BBF7D0' : '#FDE68A')"
                            style="display: inline-flex; align-items: center; gap: 4px; border-radius: 9999px; padding: 3px 8px; font-size: 11px; font-weight: 600;">
                            <span [style.background]="row.estado === 'Enviado' ? '#16A34A' : '#D97706'"
                              style="width: 5px; height: 5px; border-radius: 50%; display: inline-block;"></span>
                            {{ row.estado }}
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div style="padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #F1F5F9; background: #F8FAFC;">
                <span style="font-size: 12px; color: #94A3B8;">Filas por página: 10 · 1–10 de 720</span>
                <div style="display: flex; gap: 4px;">
                  <button type="button" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 4px 10px; color: #475569; cursor: pointer; font-size: 12px;">←</button>
                  <button type="button" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 4px 10px; color: #475569; cursor: pointer; font-size: 12px;">→</button>
                </div>
              </div>
            </div>

          </div>
        }

        <!-- ══ OPERACIÓN TAB ══════════════════════════════════ -->
        @if (activeMonitorTab() === 'Operación') {
          <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">

            <!-- Real-time banner -->
            <div style="background: linear-gradient(135deg, #04606A, #0D8A96, #0DAFBD); border-radius: 12px; padding: 16px 20px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
                <div>
                  <div style="font-family: 'Josefin Sans', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.65);">Datos en tiempo real</div>
                  <div style="font-size: 10px; color: rgba(255,255,255,0.45); margin-top: 2px;">actualización cada minuto</div>
                </div>
                <div style="font-size: 11px; color: rgba(255,255,255,0.6); font-family: 'JetBrains Mono', monospace; display: flex; align-items: center; gap: 5px;">
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: #22C55E; display: inline-block;"></span>
                  26/04/2026 21:44
                </div>
              </div>
              <div style="display: grid; grid-template-columns: repeat(4,1fr); gap: 16px;">
                @for (m of realtimeMetrics; track m.label) {
                  <div>
                    <div style="font-size: 10px; color: rgba(255,255,255,0.55); margin-bottom: 4px; letter-spacing: 0.04em; font-family: 'Josefin Sans', sans-serif; text-transform: uppercase; font-weight: 600;">{{ m.label }}</div>
                    <div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: #fff; line-height: 1;">{{ m.value }} <span style="font-size: 13px; font-weight: 400; opacity: 0.7;">{{ m.unit }}</span></div>
                  </div>
                }
              </div>
            </div>

            <!-- Real-time chart -->
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 13px; font-weight: 600; color: #1E293B;">Caudal en <span style="color: #0DAFBD;">Tiempo Real</span></span>
                <span style="font-size: 11px; color: #94A3B8;">Últimos 60 registros</span>
              </div>
              <svg viewBox="0 0 480 72" style="width: 100%; height: 72px; display: block;">
                <defs>
                  <linearGradient id="rtg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02"/>
                  </linearGradient>
                </defs>
                <path d="M0 68 L24 68 L48 68 L72 62 L96 50 L120 36 L144 26 L168 36 L192 50 L216 62 L240 68 L480 68 L480 72 L0 72 Z" fill="url(#rtg)"/>
                <path d="M0 68 L24 68 L48 68 L72 62 L96 50 L120 36 L144 26 L168 36 L192 50 L216 62 L240 68 L480 68" fill="none" stroke="#0DAFBD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <div style="display: flex; justify-content: space-between; margin-top: 6px;">
                @for (t of chartTimes; track t) {
                  <span style="font-size: 10px; color: #94A3B8; font-family: 'JetBrains Mono', monospace;">{{ t }}</span>
                }
              </div>
            </div>

            <!-- Shift cards -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 13px; font-weight: 600; color: #1E293B;">Consumo por Turnos</span>
                <div style="display: flex; align-items: center; gap: 5px; font-size: 12px; color: #64748B;">
                  <span class="material-symbols-outlined" style="font-size: 13px;">calendar_month</span>
                  Hoy 26/04/2026
                </div>
              </div>
              <div style="display: grid; grid-template-columns: repeat(4,1fr); gap: 10px;">
                @for (shift of shiftCards; track shift.name) {
                  <div [style.background]="shift.bg" [style.border]="shift.border" style="border-radius: 12px; padding: 14px;">
                    <div>
                      <div [style.color]="shift.active ? 'rgba(255,255,255,0.85)' : '#CBD5E1'" style="font-family: 'Josefin Sans', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">{{ shift.name }}</div>
                      <div [style.color]="shift.active ? 'rgba(255,255,255,0.5)' : '#94A3B8'" style="font-size: 10px; margin-top: 2px;">{{ shift.time }}</div>
                    </div>
                    @if (shift.value !== null) {
                      <div [style.color]="shift.textColor" style="font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 700; margin-top: 10px; line-height: 1;">
                        {{ shift.value }} <span style="font-size: 13px; font-weight: 400; opacity: 0.65;">m³</span>
                      </div>
                    } @else {
                      <div style="font-size: 15px; font-weight: 600; color: #CBD5E1; margin-top: 12px;">No Iniciado</div>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Distribution bars -->
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="font-size: 13px; font-weight: 600; color: #1E293B;">Distribución de Consumo por Turno</span>
                <span style="font-size: 11px; color: #94A3B8;">% del total diario</span>
              </div>
              @for (turno of turnos; track turno.name) {
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <span style="font-size: 12px; color: #64748B; width: 55px; flex-shrink: 0;">{{ turno.name }}</span>
                  <div style="flex: 1; height: 6px; background: #F1F5F9; border-radius: 999px; overflow: hidden;">
                    <div [style.width]="turno.pct + '%'" [style.background]="turno.color" style="height: 100%; border-radius: 999px;"></div>
                  </div>
                  <span style="font-size: 11px; color: #94A3B8; font-family: 'JetBrains Mono', monospace; width: 30px; text-align: right;">{{ turno.pct }}%</span>
                  <span style="font-size: 11px; color: #94A3B8; font-family: 'JetBrains Mono', monospace; width: 48px; text-align: right;">{{ turno.value }} m³</span>
                </div>
              }
            </div>

          </div>
        }

      } @else {
        <div style="margin: 16px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px; padding: 16px; font-size: 14px; font-weight: 600; color: #DC2626;">
          No se encontró la instalación solicitada.
        </div>
      }

      <!-- ══ DOWNLOAD MODAL ══════════════════════════════════ -->
      @if (showDownload()) {
        <div (click)="showDownload.set(false)"
          style="position: fixed; inset: 0; background: rgba(240,242,245,0.85); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px);">
          <div (click)="$event.stopPropagation()"
            style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 28px; width: 560px; max-width: calc(100vw - 32px); box-shadow: 0 16px 48px rgba(0,0,0,0.2); position: relative;">

            <!-- Modal header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <div>
                <div style="font-family: 'Josefin Sans', sans-serif; font-size: 17px; font-weight: 700; color: #1E293B; letter-spacing: 0.02em;">Descargar Datos Históricos</div>
                <div style="font-size: 12px; color: #94A3B8; margin-top: 2px;">Elige el período que deseas exportar</div>
              </div>
              <button (click)="showDownload.set(false)"
                style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748B;">
                <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
              </button>
            </div>

            <!-- Options grid -->
            <div style="display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 20px;">
              @for (opt of downloadOptions; track opt.key) {
                <div (click)="selectedDownload.set(opt.key)"
                  [style.border]="selectedDownload() === opt.key ? '1px solid ' + opt.color + '55' : '1px solid #E2E8F0'"
                  [style.box-shadow]="selectedDownload() === opt.key ? '0 0 0 1px ' + opt.color + '22, 0 4px 12px rgba(0,0,0,0.06)' : 'none'"
                  style="background: #F8FAFC; border-radius: 12px; padding: 16px; cursor: pointer; display: flex; flex-direction: column; gap: 10px; transition: all 0.15s;">
                  <div [style.background]="opt.color + '18'" [style.border]="'1px solid ' + opt.color + '33'"
                    style="width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                    <span class="material-symbols-outlined" [style.color]="opt.color" style="font-size: 18px;">{{ opt.icon }}</span>
                  </div>
                  <div style="font-family: 'Josefin Sans', sans-serif; font-size: 13px; font-weight: 600; color: #1E293B; line-height: 1.3;">{{ opt.label }}</div>
                  <div style="font-size: 11px; color: #64748B; line-height: 1.5; flex: 1;">{{ opt.desc }}</div>
                  <button (click)="$event.stopPropagation(); showDownload.set(false)"
                    [style.background]="opt.color"
                    style="border: none; border-radius: 8px; padding: 8px 0; font-size: 12px; font-weight: 700; color: #fff; cursor: pointer; font-family: 'DM Sans', sans-serif; width: 100%; transition: opacity 0.12s;"
                    (mouseenter)="$event.currentTarget.style.opacity='0.85'"
                    (mouseleave)="$event.currentTarget.style.opacity='1'">
                    Descargar
                  </button>
                </div>
              }
            </div>

            <div style="font-size: 11px; color: #94A3B8; text-align: center;">
              Los archivos se envían a <span style="color: #0DAFBD;">{{ userEmail() }}</span> cuando están listos.
            </div>
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `],
})
export class CompanySiteWaterDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly companyService = inject(CompanyService);
  private readonly auth = inject(AuthService);

  siteContext = signal<SiteContext | null>(null);
  loading = signal(true);
  activeMonitorTab = signal<string>('DGA');
  showDownload = signal(false);
  selectedDownload = signal<string | null>(null);

  readonly quickActions = [
    { icon: 'database', title: 'Datos Históricos', subtitle: 'Ver registros', color: '#0DAFBD', onClick: () => this.showDownload.set(true) },
    { icon: 'download', title: 'Descargar', subtitle: 'Exportar Excel', color: '#16A34A', onClick: () => this.showDownload.set(true) },
    { icon: 'open_in_new', title: 'Ver en DGA', subtitle: 'Portal oficial', color: '#2563EB', onClick: undefined },
    { icon: 'description', title: 'Reporte DGA', subtitle: 'Formato oficial', color: '#7C3AED', onClick: undefined },
  ];

  readonly records: DgaRecord[] = [
    { fecha: '31/03/2026 21:00', nivel: '3.2',  caudal: '19.75', totalizador: '530.806,375', estado: 'Enviado' },
    { fecha: '31/03/2026 22:00', nivel: '3.5',  caudal: '19.75', totalizador: '530.858,938', estado: 'Enviado' },
    { fecha: '31/03/2026 23:00', nivel: '3.4',  caudal: '19.75', totalizador: '530.900,188', estado: 'Enviado' },
    { fecha: '01/04/2026 00:00', nivel: '1.5',  caudal: '0',     totalizador: '530.921,625', estado: 'Enviado' },
    { fecha: '01/04/2026 01:00', nivel: '3.1',  caudal: '19.88', totalizador: '530.956,188', estado: 'Enviado' },
    { fecha: '01/04/2026 02:00', nivel: '3.4',  caudal: '19.63', totalizador: '530.986,75',  estado: 'Enviado' },
    { fecha: '01/04/2026 03:00', nivel: '3.3',  caudal: '19.75', totalizador: '531.009,375', estado: 'Enviado' },
    { fecha: '01/04/2026 04:00', nivel: '1.5',  caudal: '0',     totalizador: '531.038,375', estado: 'Enviado' },
    { fecha: '01/04/2026 05:00', nivel: '3.3',  caudal: '19.75', totalizador: '531.060,063', estado: 'Pendiente' },
    { fecha: '01/04/2026 06:00', nivel: '1.6',  caudal: '0',     totalizador: '531.100',     estado: 'Enviado' },
  ];

  readonly realtimeMetrics = [
    { label: 'Caudal Actual', value: '0.00',    unit: 'L/s' },
    { label: 'Totalizador',   value: '541,551', unit: 'm³' },
    { label: 'Nivel de Agua', value: '14.70',   unit: 'm'  },
    { label: 'Consumo Hoy',   value: '0.0',     unit: 'm³' },
  ];

  readonly chartTimes = ['21:25', '21:35', '21:45', '21:55', '22:05', '22:15'];

  readonly shiftCards = [
    { name: 'Turno 1',    time: '07:00 – 14:59', value: '0.0', bg: 'linear-gradient(135deg, #04606A, #0DAFBD)', border: 'none',            active: true,  textColor: '#fff' },
    { name: 'Turno 2',    time: '15:00 – 22:59', value: '0.0', bg: 'linear-gradient(135deg, #065F46, #22C55E)', border: 'none',            active: true,  textColor: '#fff' },
    { name: 'Turno 3',    time: '23:00 – 06:59', value: null,  bg: '#F1F5F9',                                   border: 'none',            active: false, textColor: '#CBD5E1' },
    { name: 'Total del Día', time: '24 horas',   value: '0.0', bg: '#F8FAFC',                                   border: '1px solid #E2E8F0', active: true, textColor: '#1E293B' },
  ];

  readonly turnos = [
    { name: 'Turno 1', pct: 0, color: '#0DAFBD', value: '0.0' },
    { name: 'Turno 2', pct: 0, color: '#22C55E', value: '0.0' },
    { name: 'Turno 3', pct: 0, color: '#94A3B8', value: '0.0' },
  ];

  readonly downloadOptions = [
    { key: 'period',   icon: 'calendar_month', color: '#A78BFA', label: 'Sólo este período',   desc: 'Descarga los datos minuto a minuto del período elegido en el selector mensual.' },
    { key: 'selected', icon: 'date_range',     color: '#0DAFBD', label: 'Período seleccionado', desc: 'Descarga exactamente el rango de fechas que tienes aplicado en pantalla.'     },
    { key: 'all',      icon: 'database',       color: '#EC4899', label: 'Todos los Períodos',   desc: 'Descarga los datos minuto a minuto de todos los períodos. El archivo puede tardar unos minutos.' },
  ];

  userEmail(): string {
    const u = this.auth.user() as any;
    return u?.email || u?.correo || 'druiz@emeltec.cl';
  }

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    if (!siteId) { this.router.navigate(['/companies']); return; }

    this.companyService.fetchHierarchy().subscribe({
      next: (res: any) => {
        if (!res.ok) { this.router.navigate(['/companies']); return; }
        const match = this.findAccessibleSite(res.data, siteId);
        if (!match) { this.router.navigate(['/companies']); return; }
        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.loadHydratedSite(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  getSiteName(context: SiteContext): string {
    return context.site?.descripcion || context.subCompany?.nombre || 'Instalación de agua';
  }

  private loadHydratedSite(match: SiteContext): void {
    this.companyService.getSites(match.subCompany.id).subscribe({
      next: (json: any) => {
        const hydratedSite = json.ok ? (json.data || []).find((s: any) => s.id === match.site.id) : null;
        this.siteContext.set({ ...match, site: { ...match.site, ...(hydratedSite || {}) } });
        this.loading.set(false);
      },
      error: () => { this.siteContext.set(match); this.loading.set(false); },
    });
  }

  private findAccessibleSite(tree: any[], siteId: string): SiteContext | null {
    for (const company of tree || []) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((s: any) => s.id === siteId);
        if (site) return { company, subCompany, site };
      }
    }
    return null;
  }
}
