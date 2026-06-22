// MonitorScreen.jsx — Emeltec Cloud UI Kit
const { useState: useMonitorState } = React;

const DGA_RECORDS = [
  { date:'31/03/2026 21:00', nivel:3.2, caudal:19.75, total:530806.375, estado:'Enviado' },
  { date:'31/03/2026 22:00', nivel:3.5, caudal:19.75, total:530858.938, estado:'Enviado' },
  { date:'31/03/2026 23:00', nivel:3.4, caudal:19.75, total:530900.188, estado:'Enviado' },
  { date:'01/04/2026 00:00', nivel:1.5, caudal:0,     total:530921.625, estado:'Enviado' },
  { date:'01/04/2026 01:00', nivel:3.1, caudal:19.88, total:530956.188, estado:'Enviado' },
  { date:'01/04/2026 02:00', nivel:3.4, caudal:19.63, total:530986.75,  estado:'Enviado' },
  { date:'01/04/2026 03:00', nivel:3.3, caudal:19.75, total:531009.375, estado:'Enviado' },
  { date:'01/04/2026 04:00', nivel:1.5, caudal:0,     total:531038.375, estado:'Enviado' },
  { date:'01/04/2026 05:00', nivel:3.3, caudal:19.75, total:531060.063, estado:'Pendiente' },
  { date:'01/04/2026 06:00', nivel:1.6, caudal:0,     total:531100,     estado:'Enviado' },
];

function MiniChart({ points, color = '#0DAFBD', height = 48 }) {
  const w = 240, h = height;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 6)}`);
  const path = `M ${coords.join(' L ')}`;
  const fill = `M ${coords[0]} L ${coords.join(' L ')} L ${(points.length - 1) * step},${h} L 0,${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#g${color.replace('#','')})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Well Diagram ──────────────────────────────────────────────
function WellDiagram({ totalDepth = 18, freatLevel = 14.70, sensorDepth = 16.5 }) {
  const W = 220, H = 220;
  const wellL = 72, wellR = 148, wellTop = 30, wellBot = H - 10;
  const wellH = wellBot - wellTop;
  const pct = Math.min(1, freatLevel / totalDepth);
  const waterY = wellTop + (1 - pct) * wellH;
  const sensorY = wellTop + (sensorDepth / totalDepth) * wellH;
  const fillPct = Math.round(pct * 100);

  // wavy water surface path
  const waveY = waterY;
  const wavePath = `M${wellL+4},${waveY} q10,-5 20,0 q10,5 20,0 q10,-5 20,0 L${wellR-4},${waveY}`;

  return (
    <div style={{ background:'#FFFFFF', border:'1px solid rgba(13,175,189,0.3)', borderRadius:12, padding:'14px 16px',
      boxShadow:'0 0 0 1px rgba(13,175,189,0.08),0 2px 10px rgba(0,0,0,0.06)', flexShrink:0 }}>
      <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'#94A3B8', marginBottom:8 }}>
        Diagrama del Pozo
      </div>
      <div style={{ display:'flex', gap:14, alignItems:'center' }}>
        <svg width={W} height={H} style={{ flexShrink:0, overflow:'visible' }}>
          <defs>
            <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0DAFBD" stopOpacity="0.7"/>
              <stop offset="100%" stopColor="#067D88" stopOpacity="0.9"/>
            </linearGradient>
            <linearGradient id="soilg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D4A96A" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#B8956A" stopOpacity="0.2"/>
            </linearGradient>
            <pattern id="dots" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="#F5EDD8"/>
              <circle cx="3" cy="3" r="1" fill="#C4A882" opacity="0.6"/>
              <circle cx="7" cy="7" r="0.7" fill="#C4A882" opacity="0.4"/>
            </pattern>
            <clipPath id="wellClip">
              <rect x={wellL+4} y={wellTop} width={wellR-wellL-8} height={wellH}/>
            </clipPath>
          </defs>

          {/* Soil background left */}
          <rect x={0} y={wellTop} width={wellL} height={wellH} fill="url(#dots)"/>
          {/* Soil background right */}
          <rect x={wellR} y={wellTop} width={W-wellR} height={wellH} fill="url(#dots)"/>

          {/* Tierra café + pasto — contexto visual de superficie */}
          <rect x={0} y={0} width={W} height={wellTop} fill="#8B7355" opacity="0.18"/>
          <line x1={0} y1={wellTop} x2={W} y2={wellTop} stroke="#8B7355" strokeWidth="2"/>
          {[6,14,22,32,44,54,158,168,178,190,202,212].map((x,i) => (
            <line key={i} x1={x} y1={wellTop} x2={x-3} y2={wellTop-7} stroke="#6B9B37" strokeWidth="1.5" strokeLinecap="round"/>
          ))}

          {/* ── LÍNEA DE SUPERFICIE sobre la boca del pozo ──
              Marca horizontal justo donde comienza el pozo;
              desde aquí se mide el nivel freático al espejo de agua */}
          <line x1={wellL-4} y1={wellTop} x2={wellR+4} y2={wellTop} stroke="#8B7355" strokeWidth="3"/>
          {/* Ticks verticales en los extremos */}
          <line x1={wellL-4} y1={wellTop-6} x2={wellL-4} y2={wellTop+4} stroke="#8B7355" strokeWidth="2"/>
          <line x1={wellR+4} y1={wellTop-6} x2={wellR+4} y2={wellTop+4} stroke="#8B7355" strokeWidth="2"/>
          {/* Label centrado sobre la boca del pozo */}
          <text x={(wellL+wellR)/2} y={wellTop-9} fontSize="9" fill="#8B7355" fontWeight="700"
            fontFamily="DM Sans" textAnchor="middle">Superficie</text>

          {/* Well casing — empty upper portion */}
          <rect x={wellL+4} y={wellTop} width={wellR-wellL-8} height={waterY-wellTop} fill="#F0F9FF" opacity="0.9"/>

          {/* Water fill */}
          <rect x={wellL+4} y={waterY} width={wellR-wellL-8} height={wellBot-waterY} fill="url(#wg)" clipPath="url(#wellClip)"/>

          {/* Water wave surface */}
          <path d={wavePath} fill="none" stroke="#0DAFBD" strokeWidth="1.5" opacity="0.8"/>
          <path d={`M${wellL+4},${waveY} q10,-5 20,0 q10,5 20,0 q10,-5 20,0 L${wellR-4},${waveY} L${wellR-4},${waveY+3} q-10,5 -20,0 q-10,-5 -20,0 q-10,5 -20,0 Z`}
            fill="#0DAFBD" opacity="0.2"/>

          {/* Fill % label inside water */}
          {pct > 0.15 && (
            <text x={(wellL+wellR)/2} y={waterY + (wellBot-waterY)*0.45 + 6}
              fontSize="14" fontWeight="700" fill="white" textAnchor="middle"
              fontFamily="JetBrains Mono" opacity="0.9">{fillPct}%</text>
          )}

          {/* Well walls */}
          <rect x={wellL} y={wellTop} width={7} height={wellH} fill="#94A3B8" rx="2"/>
          <rect x={wellR-7} y={wellTop} width={7} height={wellH} fill="#94A3B8" rx="2"/>
          <rect x={wellL} y={wellBot-6} width={wellR-wellL} height={6} fill="#64748B" rx="2"/>

          {/* ── NIVEL FREÁTICO — espejo de agua ── */}
          <line x1={wellL-22} y1={waterY} x2={wellR+2} y2={waterY} stroke="#0DAFBD" strokeWidth="1.5" strokeDasharray="4 2"/>
          <circle cx={wellL-22} cy={waterY} r={3} fill="#0DAFBD"/>
          <text x={wellL-24} y={waterY-4} fontSize="9" fill="#0DAFBD" fontWeight="600" fontFamily="DM Sans" textAnchor="end">Nivel</text>
          <text x={wellL-24} y={waterY+10} fontSize="9" fill="#0DAFBD" fontWeight="600" fontFamily="DM Sans" textAnchor="end">Freático</text>

          {/* ── BRACKET derecho: Superficie → Nivel Freático = profundidad freática ── */}
          <line x1={wellR+32} y1={wellTop} x2={wellR+32} y2={waterY} stroke="#0DAFBD" strokeWidth="1" strokeDasharray="2 2" opacity="0.5"/>
          <line x1={wellR+28} y1={wellTop} x2={wellR+36} y2={wellTop} stroke="#0DAFBD" strokeWidth="1" opacity="0.5"/>
          <line x1={wellR+28} y1={waterY} x2={wellR+36} y2={waterY} stroke="#0DAFBD" strokeWidth="1" opacity="0.5"/>
          <text x={wellR+38} y={(wellTop+waterY)/2-3} fontSize="8" fill="#0DAFBD" fontFamily="JetBrains Mono" fontWeight="600">{freatLevel}</text>
          <text x={wellR+38} y={(wellTop+waterY)/2+8} fontSize="7" fill="#94A3B8" fontFamily="DM Sans">m prof.</text>

          {/* Sensor */}
          <line x1={wellR+2} y1={sensorY} x2={wellR+22} y2={sensorY} stroke="#F97316" strokeWidth="1.5" strokeDasharray="3 2"/>
          <rect x={wellR+22} y={sensorY-5} width={10} height={10} fill="#F97316" rx="2"/>
          <text x={wellR+35} y={sensorY+4} fontSize="9" fill="#F97316" fontFamily="DM Sans" fontWeight="600">Sensor</text>

          {/* Total depth arrow */}
          <line x1={wellL-10} y1={wellTop+2} x2={wellL-10} y2={wellBot-2} stroke="#CBD5E1" strokeWidth="1"/>
          <line x1={wellL-14} y1={wellTop+2} x2={wellL-6} y2={wellTop+2} stroke="#CBD5E1" strokeWidth="1"/>
          <line x1={wellL-14} y1={wellBot-2} x2={wellL-6} y2={wellBot-2} stroke="#CBD5E1" strokeWidth="1"/>
          <text x={wellL-12} y={(wellTop+wellBot)/2+4} fontSize="9" fill="#94A3B8" fontFamily="JetBrains Mono"
            textAnchor="middle" transform={`rotate(-90,${wellL-12},${(wellTop+wellBot)/2})`}>{totalDepth}m prof.</text>
        </svg>

        {/* Stats column */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ background:'rgba(13,175,189,0.06)', border:'1px solid rgba(13,175,189,0.2)', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#94A3B8', marginBottom:3 }}>Nivel Freático</div>
            <div style={{ fontFamily:'JetBrains Mono', fontSize:24, fontWeight:700, color:'#0DAFBD', lineHeight:1 }}>
              {freatLevel}<span style={{ fontSize:13, color:'#64748B', marginLeft:3 }}>m</span>
            </div>
            <div style={{ fontSize:10, color:'#94A3B8', marginTop:2 }}>desde superficie</div>
          </div>
          <div style={{ background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#94A3B8', marginBottom:3 }}>Llenado</div>
            <div style={{ fontFamily:'JetBrains Mono', fontSize:22, fontWeight:700, color:'#1E293B', lineHeight:1 }}>
              {fillPct}<span style={{ fontSize:12, color:'#64748B' }}>%</span>
            </div>
            <div style={{ marginTop:6, height:5, background:'#E2E8F0', borderRadius:999, overflow:'hidden' }}>
              <div style={{ width:`${fillPct}%`, height:'100%', background:'linear-gradient(90deg,#0DAFBD,#22C55E)', borderRadius:999 }}/>
            </div>
          </div>
          <div style={{ background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#94A3B8', marginBottom:3 }}>Prof. Total</div>
            <div style={{ fontFamily:'JetBrains Mono', fontSize:18, fontWeight:600, color:'#475569', lineHeight:1 }}>{totalDepth} m</div>
          </div>
          <div style={{ background:'#FFF7F0', border:'1px solid #FED7AA', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#F97316', marginBottom:3, display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ width:6, height:6, borderRadius:2, background:'#F97316', display:'inline-block' }}></span>Sensor
            </div>
            <div style={{ fontFamily:'JetBrains Mono', fontSize:18, fontWeight:600, color:'#475569', lineHeight:1 }}>{sensorDepth} m</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DGA Tab ──────────────────────────────────────────────────
function DGATab({ onDownload }) {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#16A34A', marginBottom: 4 }}>Enviados</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 32, fontWeight: 700, color: '#16A34A' }}>622</div>
          <div style={{ fontSize: 11, color: '#16A34A', opacity: 0.7 }}>registros exitosos</div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 4 }}>Último Envío</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 600, color: '#1E293B', marginTop: 6 }}>26 abr 2026</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>21:00</div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 4 }}>Tasa de Éxito</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 32, fontWeight: 700, color: '#1E293B' }}>100<span style={{ fontSize: 16 }}>%</span></div>
        </div>
        <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#F87171', marginBottom: 4 }}>Rechazados</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 32, fontWeight: 700, color: '#F87171' }}>0</div>
          <div style={{ fontSize: 11, color: '#F87171', opacity: 0.7 }}>por la DGA</div>
        </div>
      </div>

      {/* Well diagram + metric cards */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <WellDiagram totalDepth={18} freatLevel={14.70} sensorDepth={16.5} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Caudal */}
          <div style={{ background: '#FFFFFF', border: '1px solid rgba(13,175,189,0.35)', borderRadius: 10, padding: 16, boxShadow: '0 0 0 1px rgba(13,175,189,0.1),0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 6 }}>Caudal Actual</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 32, fontWeight: 700, color: '#0DAFBD' }}>0.00</span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 15, color: '#64748B' }}>L/s</span>
            </div>
            <div style={{ fontSize: 11, color: '#16A34A', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <i data-lucide="shield-check" style={{ width: 11, height: 11 }}></i>
              Límite DGA: 25.0 L/s
            </div>
            <div style={{ marginTop: 8 }}>
              <MiniChart points={[0,0,0.3,0.9,1.2,0.8,0.3,0,0,0]} color="#0DAFBD" height={36} />
            </div>
          </div>
          {/* Quick actions */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', marginBottom: 10 }}>Acciones Rápidas</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { icon: 'database', label: 'Datos Históricos', sub: 'Ver registros', color: '#0DAFBD', onClick: onDownload },
                { icon: 'download', label: 'Descargar', sub: 'Exportar Excel', color: '#16A34A', onClick: onDownload },
                { icon: 'external-link', label: 'Ver en DGA', sub: 'Portal oficial', color: '#2563EB' },
                { icon: 'file-text', label: 'Reporte DGA', sub: 'Formato oficial', color: '#7C3AED' },
              ].map(a => (
                <button key={a.label} onClick={a.onClick} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(13,175,189,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#E2E8F0'}>
                  <i data-lucide={a.icon} style={{ width: 14, height: 14, color: a.color }}></i>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', marginTop: 5 }}>{a.label}</div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{a.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Records table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>Detalle de Registros</span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>720 registros en el período</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
              {['Fecha','Nv. Freático [m]','Caudal [l/s]','Totalizador [m³]','Estado'].map(h => (
                <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94A3B8', fontFamily: 'Josefin Sans' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DGA_RECORDS.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '9px 16px', fontFamily: 'JetBrains Mono', fontSize: 12, color: '#94A3B8' }}>{r.date}</td>
                <td style={{ padding: '9px 16px', fontFamily: 'JetBrains Mono', fontSize: 12, color: '#1E293B' }}>{r.nivel}</td>
                <td style={{ padding: '9px 16px', fontFamily: 'JetBrains Mono', fontSize: 12, color: '#1E293B' }}>{r.caudal}</td>
                <td style={{ padding: '9px 16px', fontFamily: 'JetBrains Mono', fontSize: 12, color: '#1E293B' }}>{r.total.toLocaleString()}</td>
                <td style={{ padding: '9px 16px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 9999, padding: '3px 8px', fontSize: 11, fontWeight: 600,
                    background: r.estado === 'Enviado' ? '#F0FDF4' : '#FFFBEB',
                    color: r.estado === 'Enviado' ? '#16A34A' : '#D97706',
                    border: `1px solid ${r.estado === 'Enviado' ? '#BBF7D0' : '#FDE68A'}` }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: r.estado === 'Enviado' ? '#16A34A' : '#D97706', display: 'inline-block' }}></span>
                    {r.estado}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #F1F5F9', background: '#F8FAFC' }}>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>Filas por página: 10 · 1–10 de 720</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {['←','→'].map(a => <button key={a} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '4px 10px', color: '#475569', cursor: 'pointer', fontSize: 12 }}>{a}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Operación Tab (merged: real-time banner + shifts) ────────
function OperacionTab() {
  const realtimePoints = [0,0,0,0.3,0.6,0.9,1.2,0.9,0.6,0.3,0,0,0,0,0,0,0,0,0,0];
  const shifts = [
    { name: 'Turno 1', time: '07:00 – 14:59', value: '0.0', bg: 'linear-gradient(135deg,#04606A,#0DAFBD)', active: true },
    { name: 'Turno 2', time: '15:00 – 22:59', value: '0.0', bg: 'linear-gradient(135deg,#065F46,#22C55E)', active: true },
    { name: 'Turno 3', time: '23:00 – 06:59', value: null, bg: '#F1F5F9', active: false },
    { name: 'Total del Día', time: '24 horas', value: '0.0', bg: '#F8FAFC', border: '#E2E8F0', active: true },
  ];
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Real-time banner */}
      <div style={{ background: 'linear-gradient(135deg,#04606A,#0D8A96,#0DAFBD)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: 'Josefin Sans', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)' }}>Datos en tiempo real</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>actualización cada minuto</div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'JetBrains Mono', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }}></span>
            26/04/2026 21:44
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
          {[['Caudal Actual','0.00','L/s'],['Totalizador','541,551','m³'],['Nivel de Agua','14.70','m'],['Consumo Hoy','0.0','m³']].map(([l,v,u]) => (
            <div key={l}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 4, letterSpacing: '0.04em', fontFamily: 'Josefin Sans', textTransform: 'uppercase', fontWeight: 600 }}>{l}</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{v} <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.7 }}>{u}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* Real-time chart */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>Caudal en <span style={{ color: '#0DAFBD' }}>Tiempo Real</span></span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>Últimos 60 registros</span>
        </div>
        <MiniChart points={realtimePoints} color="#0DAFBD" height={72} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          {['21:25','21:35','21:45','21:55','22:05','22:15'].map(t => <span key={t} style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'JetBrains Mono' }}>{t}</span>)}
        </div>
      </div>

      {/* Shift cards */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>Consumo por Turnos</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748B' }}>
            <i data-lucide="chevron-left" style={{ width: 13, height: 13 }}></i>
            <i data-lucide="calendar" style={{ width: 12, height: 12 }}></i>
            Hoy 26/04/2026
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {shifts.map(s => (
            <div key={s.name} style={{ background: s.bg, border: s.border ? `1px solid ${s.border}` : 'none', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'Josefin Sans', fontSize: 11, fontWeight: 700, color: s.active ? 'rgba(255,255,255,0.85)' : '#CBD5E1', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: s.active ? 'rgba(255,255,255,0.5)' : '#E2E8F0', marginTop: 2 }}>{s.time}</div>
                </div>
                {s.active && s.value && <i data-lucide="download" style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.5)' }}></i>}
              </div>
              {s.value ? (
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 26, fontWeight: 700, color: s.bg.includes('1E293B') || s.border ? '#1E293B' : '#fff', marginTop: 10, lineHeight: 1 }}>
                  {s.value} <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.65 }}>m³</span>
                </div>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 600, color: '#CBD5E1', marginTop: 12 }}>No Iniciado</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Distribution */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>Distribución de Consumo por Turno</span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>% del total diario</span>
        </div>
        {['Turno 1','Turno 2','Turno 3'].map((t,i) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#64748B', width: 55, flexShrink: 0 }}>{t}</span>
            <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: '0%', height: '100%', background: ['#0DAFBD','#22C55E','#94A3B8'][i], borderRadius: 999 }}></div>
            </div>
            <span style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'JetBrains Mono', width: 30, textAlign: 'right' }}>0%</span>
            <span style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'JetBrains Mono', width: 48, textAlign: 'right' }}>0.0 m³</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonitorScreen({ installation, onDownload }) {
  const [tab, setTab] = useMonitorState('DGA');
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', padding: '0 20px', display: 'flex', gap: 0 }}>
        {['DGA','Operación'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '12px 16px',
            fontSize: 13, fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? '#0899A5' : '#64748B',
            borderBottom: tab === t ? '2px solid #0DAFBD' : '2px solid transparent',
            fontFamily: 'DM Sans', transition: 'all 0.12s',
          }}>
            <i data-lucide={t === 'DGA' ? 'layers' : 'activity'} style={{ width: 13, height: 13 }}></i>
            {t}
          </button>
        ))}
      </div>
      {tab === 'DGA' ? <DGATab onDownload={onDownload} /> : <OperacionTab />}
    </div>
  );
}

Object.assign(window, { MonitorScreen, MiniChart });
