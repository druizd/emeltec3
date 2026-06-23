// TopNav.jsx — Emeltec Cloud UI Kit (Light Mode)
const TopNav = ({ activeTab, onTabChange, site }) => (
  <div style={{ background: '#FFFFFF', borderBottom: '1px solid #E2E8F0', flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
    {/* Tab bar */}
    <div style={{ height: 52, display: 'flex', alignItems: 'stretch', padding: '0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {['Dashboard', 'Dynamic'].map(tab => (
          <button key={tab} onClick={() => onTabChange(tab)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 16px', fontSize: 14, fontWeight: 500,
              color: activeTab === tab ? '#0899A5' : '#94A3B8',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #0DAFBD' : '2px solid transparent',
              fontFamily: 'DM Sans', transition: 'all 0.12s',
            }}>
            <i data-lucide={tab === 'Dashboard' ? 'layout-dashboard' : 'activity'} style={{ width: 15, height: 15 }}></i>
            {tab}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }}></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Theme toggle */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 20, padding: 3, gap: 2 }}>
          <div style={{ width: 26, height: 26, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF', color: '#0899A5', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', cursor: 'pointer' }}>
            <i data-lucide="sun" style={{ width: 13, height: 13 }}></i>
          </div>
          <div style={{ width: 26, height: 26, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', cursor: 'pointer' }}>
            <i data-lucide="moon" style={{ width: 13, height: 13 }}></i>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: '#D97706', cursor: 'pointer' }}>
          <i data-lucide="wrench" style={{ width: 12, height: 12 }}></i>WIP
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#64748B', fontSize: 13, cursor: 'pointer', padding: '5px 8px', borderRadius: 6 }}>
          <i data-lucide="headphones" style={{ width: 13, height: 13 }}></i>Contáctanos
        </div>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#0DAFBD,#04606A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>DR</div>
      </div>
    </div>

    {/* Site header */}
    {site && (
      <div style={{ borderTop: '1px solid #E2E8F0', borderBottom: '2px solid #0DAFBD', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, background: '#F8FAFC' }}>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(13,175,189,0.08)', border: '1px solid rgba(13,175,189,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i data-lucide="droplets" style={{ width: 18, height: 18, color: '#0DAFBD' }}></i>
        </div>
        <div>
          <div style={{ fontFamily: 'Josefin Sans', fontSize: 16, fontWeight: 700, color: '#1E293B', letterSpacing: '0.02em', lineHeight: 1.1 }}>{site.name}</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, fontFamily: 'DM Sans' }}>{site.code}</div>
        </div>
        <div style={{ marginLeft: 12, display: 'flex', gap: 6 }}>
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 500, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }}></span>
            hace 0 segundos
          </div>
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#2563EB', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i data-lucide="clock" style={{ width: 10, height: 10 }}></i>
            26 abr 2026, 22:23
          </div>
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i data-lucide="check-circle" style={{ width: 10, height: 10 }}></i>
            Reporte DGA · Aceptado · 17:00
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {site.dateRange && (
            <>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>Desde</span>
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i data-lucide="calendar" style={{ width: 12, height: 12 }}></i>25-04-2026
              </div>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>Hasta</span>
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i data-lucide="calendar" style={{ width: 12, height: 12 }}></i>26-04-2026
              </div>
              <button style={{ background: '#0DAFBD', border: 'none', borderRadius: 4, padding: '5px 14px', fontSize: 11, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'Josefin Sans', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Aplicar</button>
            </>
          )}
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
            <i data-lucide="settings" style={{ width: 16, height: 16 }}></i>
          </button>
        </div>
      </div>
    )}
  </div>
);

Object.assign(window, { TopNav });
