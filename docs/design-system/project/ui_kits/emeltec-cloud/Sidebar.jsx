// Sidebar.jsx — Emeltec Cloud UI Kit (Light Mode, module tree)
const { useState } = React;

const MODULES = [
  {
    key: 'agua', label: 'Consumo de Agua', icon: 'droplets', color: '#0DAFBD', bg: 'rgba(13,175,189,0.1)',
    companies: [
      { name: 'Cachantún', plants: ['Cachantún Coinco'] },
      { name: 'Cementos Melón', plants: ['Planta Melón'] },
      { name: 'CCU', plants: ['Cervecera CCU'] },
      { name: 'Matthei', plants: ['Pozo'] },
    ]
  },
  { key: 'riles', label: 'Generación de Riles', icon: 'waves', color: '#22C55E', bg: 'rgba(34,197,94,0.08)',
    companies: [{ name: 'Matthei', plants: ['Riles'] }]
  },
  { key: 'proceso', label: 'Variables de Proceso', icon: 'cpu', color: '#6366F1', bg: 'rgba(99,102,241,0.08)',
    companies: [{ name: 'Matthei', plants: ['Pasteurizador 1'] }]
  },
  { key: 'electrico', label: 'Consumo Eléctrico', icon: 'zap', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',
    companies: [{ name: 'Matthei', plants: ['Planta 1'] }]
  },
  { key: 'maletas', label: 'Maletas Piloto', icon: 'rocket', color: '#F97316', bg: 'rgba(249,115,22,0.08)',
    companies: []
  },
];

function Sidebar({ activeModule, activePlant, onSelectPlant, collapsed, onToggle }) {
  const [openModule, setOpenModule] = useState('agua');

  const toggleModule = (key) => setOpenModule(k => k === key ? null : key);

  return (
    <div style={{
      width: collapsed ? 60 : 248, minWidth: collapsed ? 60 : 248,
      background: '#FFFFFF', borderRight: '1px solid #E2E8F0',
      display: 'flex', flexDirection: 'column', height: '100vh',
      transition: 'width 0.2s ease, min-width 0.2s ease', overflow: 'hidden', flexShrink: 0,
      boxShadow: '1px 0 4px rgba(0,0,0,0.04)',
    }}>
      {/* Brand */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 60 }}>
        {!collapsed && (
          <img src="../../assets/logo.avif" alt="Emeltec" style={{ height: 30, objectFit: 'contain' }} />
        )}
        <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 4, borderRadius: 4, display: 'flex', marginLeft: collapsed ? 'auto' : 0 }}>
          <i data-lucide={collapsed ? "chevrons-right" : "chevrons-left"} style={{ width: 16, height: 16 }}></i>
        </button>
      </div>

      {/* User */}
      {!collapsed && (
        <div style={{ margin: '10px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0DAFBD,#04606A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, position: 'relative' }}>
              DR
              <span style={{ position: 'absolute', bottom: 1, right: 1, width: 8, height: 8, borderRadius: '50%', background: '#22C55E', border: '2px solid #F8FAFC' }}></span>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>Dylan Ruiz</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>Admin</div>
            </div>
          </div>
        </div>
      )}

      {/* Modules */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
        {MODULES.map(mod => {
          const isOpen = openModule === mod.key;
          const isActive = activeModule === mod.key;
          return (
            <div key={mod.key} style={{ margin: '2px 8px' }}>
              {/* Module header */}
              <div onClick={() => { toggleModule(mod.key); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 9,
                  justifyContent: collapsed ? 'center' : 'space-between',
                  padding: collapsed ? '9px 0' : '8px 10px',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', borderRadius: 8,
                  color: isActive ? '#0899A5' : '#475569',
                  background: isActive ? 'rgba(13,175,189,0.06)' : 'transparent',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F1F5F9'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: mod.bg, border: `1px solid ${mod.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i data-lucide={mod.icon} style={{ width: 14, height: 14, color: mod.color }}></i>
                  </div>
                  {!collapsed && <span>{mod.label}</span>}
                </div>
                {!collapsed && mod.companies.length > 0 && (
                  <i data-lucide="chevron-right" style={{ width: 13, height: 13, color: '#CBD5E1', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}></i>
                )}
              </div>

              {/* Company/plant tree */}
              {!collapsed && isOpen && mod.companies.length > 0 && (
                <div style={{ paddingLeft: 16, marginBottom: 4 }}>
                  {mod.companies.map(company => (
                    <div key={company.name}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '5px 10px 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <i data-lucide="building-2" style={{ width: 10, height: 10, opacity: 0.5 }}></i>
                        {company.name}
                      </div>
                      <div style={{ position: 'relative', paddingLeft: 14 }}>
                        <div style={{ position: 'absolute', left: 4, top: 0, bottom: 6, width: 1, background: '#E2E8F0' }}></div>
                        {company.plants.map(plant => {
                          const isPlantActive = activePlant === plant;
                          return (
                            <div key={plant} onClick={() => onSelectPlant(mod.key, plant)}
                              style={{
                                position: 'relative', fontSize: 12, color: isPlantActive ? '#0899A5' : '#64748B',
                                padding: '5px 10px 5px 12px', borderRadius: 6, cursor: 'pointer',
                                fontWeight: isPlantActive ? 600 : 400,
                                background: isPlantActive ? 'rgba(13,175,189,0.06)' : 'transparent',
                                marginBottom: 1, transition: 'all 0.12s',
                              }}
                              onMouseEnter={e => { if (!isPlantActive) e.currentTarget.style.background = '#F1F5F9'; }}
                              onMouseLeave={e => { if (!isPlantActive) e.currentTarget.style.background = isPlantActive ? 'rgba(13,175,189,0.06)' : 'transparent'; }}>
                              <span style={{ position: 'absolute', left: -10, top: '50%', display: 'block', width: 8, height: 1, background: isPlantActive ? '#0DAFBD' : '#E2E8F0' }}></span>
                              {plant}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar });
