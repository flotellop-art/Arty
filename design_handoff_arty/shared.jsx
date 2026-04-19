// Shared UI primitives used across all directions

const SCREENS = ['login','home','chat','sidebar','brief','tasks','settings','report'];

function useT(lang) {
  return window.COPY[lang] || window.COPY.fr;
}

// Striped placeholder
function Placeholder({ w = '100%', h = 80, label, stripe = 'rgba(0,0,0,0.04)', bg = 'transparent', color = 'rgba(0,0,0,0.4)', radius = 12 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: `repeating-linear-gradient(135deg, ${bg} 0 10px, ${stripe} 10px 11px)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10, color,
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>{label}</div>
  );
}

// Arty mark — Prism. Two triangles meeting at apex; left half at 0.55 opacity.
// Named `Star` for API compatibility with existing direction files.
function Star({ size = 24, color = 'currentColor', fill = false }) {
  const sw = Math.max(1.4, size / 16);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ display: 'block' }}>
      {fill ? (
        <>
          <path d="M32 6 L58 54 L32 40 Z" fill={color} />
          <path d="M32 6 L6 54 L32 40 Z" fill={color} opacity="0.55" />
        </>
      ) : (
        <>
          <path d="M32 6 L58 54 L32 40 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M32 6 L6 54 L32 40 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" opacity="0.55" />
        </>
      )}
    </svg>
  );
}

// Phone-frame style shell for each direction — not Material, theme-owned
function PhoneFrame({ bg, children, width = 380, height = 780 }) {
  return (
    <div style={{
      width, height,
      background: bg,
      borderRadius: 36,
      padding: 6,
      boxShadow: '0 40px 80px -20px rgba(40,20,10,0.35), 0 8px 20px rgba(40,20,10,0.1)',
      border: '1px solid rgba(0,0,0,0.08)',
    }}>
      <div style={{
        width: '100%', height: '100%',
        borderRadius: 30, overflow: 'hidden', position: 'relative',
        background: bg,
      }}>
        {children}
      </div>
    </div>
  );
}

// Minimal status bar — theme-owned colors
function StatusBar({ color = '#111', bg = 'transparent' }) {
  return (
    <div style={{
      height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 22px', color, background: bg, flexShrink: 0,
      fontFamily: 'ui-sans-serif, system-ui', fontSize: 13, fontWeight: 500,
      position: 'relative', zIndex: 2,
    }}>
      <span>9:30</span>
      <div style={{
        position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)',
        width: 18, height: 18, borderRadius: 100, background: '#111',
      }} />
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <svg width="14" height="10" viewBox="0 0 14 10"><path d="M0 7 L14 7 M2 5 L12 5 M4 3 L10 3 M6 1 L8 1" stroke={color} strokeWidth="1.4" strokeLinecap="round"/></svg>
        <svg width="14" height="10" viewBox="0 0 14 10"><path d="M7 9 L0 2 A10 10 0 0 1 14 2 L7 9Z" fill={color}/></svg>
        <svg width="22" height="10" viewBox="0 0 22 10"><rect x="0.5" y="0.5" width="19" height="9" rx="2" fill="none" stroke={color} strokeWidth="1"/><rect x="2" y="2" width="13" height="6" rx="1" fill={color}/><rect x="20" y="3" width="2" height="4" rx="1" fill={color}/></svg>
      </div>
    </div>
  );
}

function NavPill({ color = '#111' }) {
  return (
    <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <div style={{ width: 108, height: 4, borderRadius: 2, background: color, opacity: 0.4 }} />
    </div>
  );
}

Object.assign(window, { SCREENS, useT, Placeholder, Star, PhoneFrame, StatusBar, NavPill });
