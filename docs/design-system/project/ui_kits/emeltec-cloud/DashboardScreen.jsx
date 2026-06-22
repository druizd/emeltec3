// DashboardScreen.jsx — Emeltec Cloud UI Kit
const INSTALLATIONS = [
  { id:'OB-0601-292', name:'vertiente 3', company:'Aguas Cachantún', depth:'18m', status:'live' },
  { id:'OB-0601-293', name:'vertiente 2', company:'Aguas Cachantún', depth:'18m', status:'nodata' },
  { id:'OB-0601-294', name:'vertiente 1', company:'Aguas Cachantún', depth:'18m', status:'nodata' },
  { id:'riles-cachantun', name:'riles-cachantun', company:'Aguas Cachantún', depth:'—', status:'nodata' },
  { id:'Melón-Catemu', name:'Melón - Catemu', company:'Cementos Melón', depth:'84m', status:'data' },
  { id:'Melon Pozo 1', name:'Noviciado', company:'Cementos Melón', depth:'54m', status:'nodata' },
  { id:'Melon Pozo 2', name:'Tongoy', company:'Cementos Melón', depth:'12m', status:'nodata' },
  { id:'OB-1306-137', name:'pozo 11', company:'Cervecera CCU', depth:'80m', status:'data' },
  { id:'OB-1306-1642', name:'Pozo 8', company:'Cervecera CCU', depth:'100m', status:'data' },
  { id:'OB-1306-323', name:'pozo 4', company:'Cervecera CCU', depth:'124m', status:'nodata' },
  { id:'OB-1306-327', name:'pozo 7', company:'Cervecera CCU', depth:'124m', status:'nodata' },
  { id:'OB-1306-98', name:'Pozo 10', company:'Cervecera CCU', depth:'190m', status:'data' },
  { id:'OB-0602-95', name:'', company:'Contenedores San Fernando', depth:'40m', status:'nodata' },
  { id:'OB-1306-897', name:'', company:'Cotaco', depth:'100m', status:'nodata' },
  { id:'OB-0503-1069', name:'', company:'Cristal Chile Llay Llay', depth:'54m', status:'nodata' },
  { id:'OB-0503-1071', name:'', company:'Cristal Chile Llay Llay', depth:'54m', status:'nodata' },
];

function InstallCard({ inst, onClick }) {
  const statusColor = inst.status === 'live' ? '#22C55E' : inst.status === 'data' ? '#0DAFBD' : '#94A3B8';
  const statusLabel = inst.status === 'live' ? 'En vivo' : inst.status === 'data' ? 'Con datos' : 'Sin datos';
  return (
    <div onClick={onClick} style={{
      background: '#FFFFFF', border: `1px solid ${inst.status === 'live' ? 'rgba(34,197,94,0.25)' : '#E2E8F0'}`,
      borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.15s',
      display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: inst.status === 'live' ? '0 0 0 1px rgba(34,197,94,0.1), 0 2px 8px rgba(0,0,0,0.06)' : '0 2px 6px rgba(0,0,0,0.06)',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = inst.status === 'live' ? 'rgba(34,197,94,0.4)' : 'rgba(13,175,189,0.3)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.borderColor = inst.status === 'live' ? 'rgba(34,197,94,0.25)' : '#E2E8F0'; }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(13,175,189,0.1)', border: '1px solid rgba(13,175,189,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i data-lucide="gauge" style={{ width: 13, height: 13, color: '#0DAFBD' }}></i>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.2 }}>{inst.id}</div>
            {inst.name && <div style={{ fontSize: 11, color: '#64748B' }}>{inst.name}</div>}
          </div>
        </div>
        <i data-lucide="chevron-right" style={{ width: 14, height: 14, color: '#94A3B8' }}></i>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>{inst.company}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {inst.depth !== '—' && <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'JetBrains Mono' }}>Prof. {inst.depth}</span>}
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: statusColor }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function DashboardScreen({ onSelectInstallation }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'Josefin Sans', fontSize: 22, fontWeight: 700, color: '#1E293B', letterSpacing: '0.03em' }}>Instalaciones</div>
        <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 3 }}>89 sitios registrados</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {INSTALLATIONS.map(inst => (
          <InstallCard key={inst.id} inst={inst} onClick={() => onSelectInstallation(inst)} />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DashboardScreen });
