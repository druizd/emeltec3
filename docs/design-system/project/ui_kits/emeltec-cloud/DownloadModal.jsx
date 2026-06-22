// DownloadModal.jsx — Emeltec Cloud UI Kit
const { useState: useDlState } = React;

function DownloadModal({ onClose }) {
  const [selected, setSelected] = useDlState(null);
  const options = [
    { key: 'period', icon: 'calendar', color: '#A78BFA', btnColor: '#7C3AED', btnBg: 'rgba(124,58,237,1)', label: 'Sólo este período', desc: 'Descarga los datos minuto a minuto del período elegido en el selector mensual.' },
    { key: 'selected', icon: 'calendar-range', color: '#0DAFBD', btnColor: '#0DAFBD', btnBg: '#0DAFBD', label: 'Período seleccionado', desc: 'Descarga exactamente el rango de fechas que tienes aplicado en pantalla.' },
    { key: 'all', icon: 'database', color: '#EC4899', btnColor: '#EC4899', btnBg: '#EC4899', label: 'Todos los Períodos', desc: 'Descarga los datos minuto a minuto de todos los períodos. El archivo puede pesar y puede tardar unos minutos en llegar.' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(240,242,245,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 28, width: 560, boxShadow: '0 16px 48px rgba(0,0,0,0.3)', position: 'relative' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'Josefin Sans', fontSize: 17, fontWeight: 700, color: '#1E293B', letterSpacing: '0.02em' }}>Descargar Datos Históricos</div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Elige el período que deseas exportar</div>
          </div>
          <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}>
            <i data-lucide="x" style={{ width: 14, height: 14 }}></i>
          </button>
        </div>

        {/* Options */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
          {options.map(opt => (
            <div key={opt.key} onClick={() => setSelected(opt.key)}
              style={{
                background: selected === opt.key ? '#F8FAFC' : '#F8FAFC',
                border: `1px solid ${selected === opt.key ? opt.color + '55' : '#E2E8F0'}`,
                borderRadius: 12, padding: 16, cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: selected === opt.key ? `0 0 0 1px ${opt.color}22, 0 4px 12px rgba(0,0,0,0.06)` : 'none',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
              {/* Month selector for first option */}
              {opt.key === 'period' ? (
                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748B' }}>
                  <span>Abril 2026</span>
                  <i data-lucide="chevron-down" style={{ width: 12, height: 12 }}></i>
                </div>
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${opt.color}18`, border: `1px solid ${opt.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i data-lucide={opt.icon} style={{ width: 18, height: 18, color: opt.color }}></i>
                </div>
              )}
              <div style={{ fontFamily: 'Josefin Sans', fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.3 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.5 }}>{opt.desc}</div>
              <button style={{
                background: opt.key === 'selected' ? '#0DAFBD' : opt.key === 'all' ? '#EC4899' : 'rgba(124,58,237,0.85)',
                border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 700,
                color: '#fff', cursor: 'pointer', fontFamily: 'DM Sans', width: '100%',
                marginTop: 'auto', transition: 'opacity 0.12s',
              }} onClick={e => { e.stopPropagation(); onClose(); }}>
                {opt.label}
              </button>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
          Los archivos se envían a <span style={{ color: '#0DAFBD' }}>druiz@emeltec.cl</span> cuando están listos.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DownloadModal });
