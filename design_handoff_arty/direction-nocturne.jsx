// Direction 3 — NOCTURNE: warm dark, candlelit, OLED-first
// Midnight cacao bg, amber typography, ember as glow. Rethinks hierarchy for dark.

const NOCTURNE = {
  name: 'Nocturne',
  desc: 'Warm dark · candlelit',
  bg: '#14100B',
  bgDeep: '#0C0906',
  card: '#1E1812',
  cardHi: '#28201A',
  ink: '#F5E6D0',
  inkSoft: '#D9C4A5',
  muted: '#8A7A66',
  line: 'rgba(245,230,208,0.08)',
  accent: '#F59A4B',     // candlelit amber
  accentGlow: 'rgba(245,154,75,0.18)',
  accentDeep: '#C4491C',
  sans: "'Inter', ui-sans-serif, system-ui",
  serif: "'Lora', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

function NTag({ children, color }) {
  return <span style={{ fontSize: 10, letterSpacing: '0.18em', color: color || NOCTURNE.muted, textTransform: 'uppercase', fontWeight: 600, fontFamily: NOCTURNE.sans }}>{children}</span>;
}

function Glow({ size = 80, color = NOCTURNE.accentGlow, style }) {
  return <div style={{ position: 'absolute', width: size, height: size, borderRadius: '50%', background: `radial-gradient(circle, ${color} 0%, transparent 70%)`, pointerEvents: 'none', ...style }} />;
}

// Login
function NocturneLogin({ t }) {
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, padding: '32px 28px', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <Glow size={260} style={{ top: -60, right: -80 }} />
      <Glow size={180} color="rgba(196,73,28,0.12)" style={{ bottom: -40, left: -60 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 1 }}>
        <Star size={22} color={NOCTURNE.accent} fill />
        <span style={{ fontFamily: NOCTURNE.serif, fontSize: 22, fontStyle: 'italic' }}>arty</span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <NTag color={NOCTURNE.accent}>◦ Bon retour</NTag>
        <h1 style={{ fontFamily: NOCTURNE.serif, fontSize: 38, lineHeight: 1.05, margin: '12px 0 8px', fontWeight: 500, letterSpacing: '-0.02em' }}>
          {t.login.title}, <span style={{ fontStyle: 'italic', color: NOCTURNE.accent }}>Florent</span>.
        </h1>
        <p style={{ fontSize: 14, color: NOCTURNE.inkSoft, margin: 0, lineHeight: 1.55 }}>{t.login.subtitle}</p>
      </div>
      <div style={{ marginTop: 30, position: 'relative', zIndex: 1 }}>
        <button style={{ width: '100%', padding: '16px', background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, color: NOCTURNE.bgDeep, border: 'none', fontSize: 15, fontWeight: 600, borderRadius: 14, cursor: 'pointer', boxShadow: `0 8px 30px ${NOCTURNE.accentGlow}` }}>
          {t.login.continueGoogle}
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button style={{ flex: 1, padding: '13px', background: NOCTURNE.card, color: NOCTURNE.ink, border: `1px solid ${NOCTURNE.line}`, fontSize: 13, borderRadius: 12, cursor: 'pointer' }}>{t.login.apikey}</button>
          <button style={{ flex: 1, padding: '13px', background: NOCTURNE.card, color: NOCTURNE.ink, border: `1px solid ${NOCTURNE.line}`, fontSize: 13, borderRadius: 12, cursor: 'pointer' }}>{t.login.email}</button>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 11, color: NOCTURNE.muted, textAlign: 'center', lineHeight: 1.55, position: 'relative', zIndex: 1 }}>{t.login.privacyNote}</div>
    </div>
  );
}

// Home — hero card with glow, dark-first
function NocturneHome({ t, onOpen }) {
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, position: 'relative' }}>
      <Glow size={320} style={{ top: -100, left: -60 }} />
      <div style={{ padding: '16px 22px 0', display: 'flex', alignItems: 'center', position: 'relative' }}>
        <button onClick={() => onOpen('sidebar')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Star size={18} color={NOCTURNE.accent} fill />
          <span style={{ fontSize: 14, fontWeight: 500, color: NOCTURNE.ink }}>Arty</span>
        </button>
        <div style={{ flex: 1 }} />
        <NTag>09:30 · 18°</NTag>
      </div>

      <div style={{ padding: '28px 22px 0', position: 'relative' }}>
        <NTag color={NOCTURNE.accent}>◦ Bonjour</NTag>
        <h1 style={{ fontFamily: NOCTURNE.serif, fontSize: 38, lineHeight: 1.05, margin: '8px 0 6px', fontWeight: 500, letterSpacing: '-0.025em' }}>
          Florent.
        </h1>
        <p style={{ fontSize: 15, color: NOCTURNE.inkSoft, margin: 0, lineHeight: 1.5 }}>
          4 rendez-vous et une baisse chez Gedimat. Un café ?
        </p>
      </div>

      {/* Hero brief card */}
      <div onClick={() => onOpen('brief')} style={{
        margin: '22px 22px 0', padding: 20, borderRadius: 22,
        background: `linear-gradient(145deg, ${NOCTURNE.cardHi}, ${NOCTURNE.card})`,
        border: `1px solid ${NOCTURNE.line}`, position: 'relative', overflow: 'hidden', cursor: 'pointer',
        boxShadow: `0 20px 50px rgba(0,0,0,0.3), inset 0 1px 0 rgba(245,230,208,0.04)`,
      }}>
        <Glow size={160} style={{ top: -40, right: -40 }} />
        <NTag color={NOCTURNE.accent}>◈ Brief du matin · 09:30</NTag>
        <h2 style={{ fontFamily: NOCTURNE.serif, fontSize: 22, margin: '10px 0 8px', fontWeight: 500, lineHeight: 1.2, position: 'relative' }}>
          Visite chantier,<br/><span style={{ fontStyle: 'italic', color: NOCTURNE.accent }}>puis baisse Gedimat.</span>
        </h2>
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', position: 'relative' }}>
          {['4 RDV', '3 mails', '–4,2%'].map((c, i) => (
            <div key={i} style={{ padding: '5px 10px', background: 'rgba(245,154,75,0.12)', color: NOCTURNE.accent, borderRadius: 100, fontSize: 11, fontWeight: 500 }}>{c}</div>
          ))}
        </div>
      </div>

      {/* Next event */}
      <div style={{ margin: '10px 22px 0', padding: '14px 18px', borderRadius: 16, background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: NOCTURNE.accentGlow, display: 'grid', placeItems: 'center', color: NOCTURNE.accent, fontFamily: NOCTURNE.serif, fontSize: 15, fontWeight: 600, flexShrink: 0 }}>9:30</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.25 }}>Visite chantier — Bourg-lès-Valence</div>
          <div style={{ fontSize: 11, color: NOCTURNE.muted, marginTop: 2 }}>Dans 32 min · 7 km</div>
        </div>
        <div style={{ color: NOCTURNE.accent, fontSize: 18 }}>→</div>
      </div>

      {/* Suggestions as glowing chips */}
      <div style={{ padding: '22px 22px 0' }}>
        <NTag>Suggestions</NTag>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {[
            { icon: '✉', text: t.home.sug1 },
            { icon: '◷', text: t.home.sug2 },
            { icon: '◈', text: t.home.sug3 },
            { icon: '✦', text: t.home.sug4 },
          ].map((s, i) => (
            <div key={i} onClick={() => onOpen('chat')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 14, cursor: 'pointer' }}>
              <div style={{ width: 28, height: 28, borderRadius: 10, background: NOCTURNE.accentGlow, color: NOCTURNE.accent, display: 'grid', placeItems: 'center', fontSize: 13 }}>{s.icon}</div>
              <span style={{ flex: 1, fontSize: 13 }}>{s.text}</span>
              <span style={{ color: NOCTURNE.muted, fontSize: 14 }}>›</span>
            </div>
          ))}
        </div>
      </div>

      {/* Composer bar */}
      <div style={{ padding: '18px 22px 20px' }}>
        <div onClick={() => onOpen('chat')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 100, cursor: 'pointer' }}>
          <span style={{ color: NOCTURNE.muted, fontSize: 16 }}>+</span>
          <span style={{ flex: 1, fontSize: 13, color: NOCTURNE.muted }}>{t.home.placeholder}</span>
          <div style={{ width: 30, height: 30, borderRadius: 100, background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, display: 'grid', placeItems: 'center', color: NOCTURNE.bgDeep, fontSize: 13, boxShadow: `0 0 20px ${NOCTURNE.accentGlow}` }}>⏺</div>
        </div>
      </div>
    </div>
  );
}

// Chat
function NocturneChat({ t, onBack }) {
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <Glow size={200} style={{ top: -80, right: -60 }} />
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${NOCTURNE.line}`, display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: NOCTURNE.ink, padding: 0 }}>←</button>
        <div style={{ flex: 1 }}>
          <NTag>14:02</NTag>
          <div style={{ fontFamily: NOCTURNE.serif, fontSize: 15, lineHeight: 1.1, marginTop: 1, fontStyle: 'italic' }}>Résumé des mails</div>
        </div>
        <div style={{ padding: '4px 10px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 100, fontSize: 11, color: NOCTURNE.muted }}>Claude 4.6</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', position: 'relative' }}>
        {MOCK.chatMessages.map((m, i) => {
          if (m.role === 'action') {
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', padding: '8px 12px', background: NOCTURNE.accentGlow, borderRadius: 100, width: 'fit-content' }}>
                <div style={{ width: 6, height: 6, background: NOCTURNE.accent, borderRadius: 100, animation: 'pulse 1.2s infinite' }} />
                <span style={{ fontSize: 11, color: NOCTURNE.accent, fontWeight: 500 }}>{t.chat.emailAction}…</span>
              </div>
            );
          }
          if (m.role === 'user') {
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
                <div style={{ maxWidth: '82%', background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, color: NOCTURNE.bgDeep, padding: '10px 14px', borderRadius: 18, fontSize: 13, lineHeight: 1.4, fontWeight: 500, boxShadow: `0 4px 20px ${NOCTURNE.accentGlow}` }}>{m.content}</div>
              </div>
            );
          }
          const paragraphs = m.content.split('\n\n');
          return (
            <div key={i} style={{ margin: '14px 0', maxWidth: '92%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Star size={12} color={NOCTURNE.accent} fill />
                <NTag color={NOCTURNE.muted}>Arty</NTag>
              </div>
              {paragraphs.map((p, j) => {
                if (p.startsWith('>')) {
                  return (
                    <div key={j} style={{ margin: '8px 0', padding: '12px 14px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderLeft: `3px solid ${NOCTURNE.accent}`, fontFamily: NOCTURNE.serif, fontSize: 13, fontStyle: 'italic', lineHeight: 1.55, whiteSpace: 'pre-line', borderRadius: 10, color: NOCTURNE.inkSoft }}>
                      {p.replace(/^> ?/gm, '')}
                    </div>
                  );
                }
                return <p key={j} style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 8px', whiteSpace: 'pre-line', color: NOCTURNE.ink }} dangerouslySetInnerHTML={{ __html: p.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${NOCTURNE.accent};font-weight:600">$1</strong>`) }} />;
              })}
              {m.draft && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button style={{ padding: '8px 14px', background: NOCTURNE.accent, color: NOCTURNE.bgDeep, border: 'none', borderRadius: 100, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Envoyer</button>
                  <button style={{ padding: '8px 14px', background: NOCTURNE.card, color: NOCTURNE.ink, border: `1px solid ${NOCTURNE.line}`, borderRadius: 100, fontSize: 12, cursor: 'pointer' }}>Réviser</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${NOCTURNE.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 100 }}>
          <span style={{ color: NOCTURNE.muted, fontSize: 16 }}>+</span>
          <span style={{ flex: 1, fontSize: 13, color: NOCTURNE.muted }}>{t.chat.placeholder}</span>
          <div style={{ width: 28, height: 28, borderRadius: 100, background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, display: 'grid', placeItems: 'center', color: NOCTURNE.bgDeep, fontSize: 12 }}>↑</div>
        </div>
      </div>
    </div>
  );
}

// Sidebar
function NocturneSidebar({ t, onBack, onOpen }) {
  const groups = [{ key: 'today', label: t.sidebar.today }, { key: 'yesterday', label: t.sidebar.yesterday }, { key: 'earlier', label: t.sidebar.earlier }];
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, position: 'relative' }}>
      <Glow size={240} style={{ top: -60, right: -80 }} />
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Star size={18} color={NOCTURNE.accent} fill />
          <span style={{ fontFamily: NOCTURNE.serif, fontSize: 20, fontStyle: 'italic' }}>arty</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: NOCTURNE.ink, padding: 0 }}>✕</button>
      </div>

      <div style={{ padding: '10px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 100 }}>
          <span style={{ color: NOCTURNE.muted, fontSize: 13 }}>⌕</span>
          <span style={{ fontSize: 12, color: NOCTURNE.muted, flex: 1 }}>{t.sidebar.search}</span>
        </div>
        <button style={{ width: '100%', marginTop: 10, padding: '13px', background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, color: NOCTURNE.bgDeep, border: 'none', fontSize: 13, fontWeight: 600, borderRadius: 100, cursor: 'pointer', boxShadow: `0 6px 20px ${NOCTURNE.accentGlow}` }}>
          + {t.sidebar.new}
        </button>
      </div>

      {groups.map(g => {
        const convs = MOCK.conversations.filter(c => c.group === g.key);
        if (!convs.length) return null;
        return (
          <div key={g.key} style={{ padding: '20px 22px 0' }}>
            <NTag>{g.label}</NTag>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {convs.map(c => (
                <div key={c.id} onClick={() => onOpen('chat')} style={{ padding: '10px 14px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 12, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.25, flex: 1 }}>{c.title}</div>
                    <NTag>{c.when}</NTag>
                  </div>
                  <div style={{ fontSize: 11, color: NOCTURNE.muted, marginTop: 3, lineHeight: 1.4 }}>{c.preview}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ padding: '22px 22px 16px', display: 'flex', gap: 8 }}>
        {[{ k: 'tasks', l: t.sidebar.tasks, i: '✓' }, { k: 'settings', l: t.sidebar.settings, i: '⚙' }].map(b => (
          <button key={b.k} onClick={() => onOpen(b.k)} style={{ flex: 1, padding: '12px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, fontSize: 13, color: NOCTURNE.ink, borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ color: NOCTURNE.accent }}>{b.i}</span> {b.l}
          </button>
        ))}
      </div>
    </div>
  );
}

// Brief
function NocturneBrief({ t, onBack }) {
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, position: 'relative' }}>
      <Glow size={320} style={{ top: -100, left: '25%' }} />
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: NOCTURNE.ink, padding: 0 }}>←</button>
        <NTag>Vendredi · 09:30</NTag>
      </div>

      <div style={{ padding: '22px 22px 0', position: 'relative' }}>
        <NTag color={NOCTURNE.accent}>◦ Brief du matin</NTag>
        <h1 style={{ fontFamily: NOCTURNE.serif, fontSize: 34, fontWeight: 500, margin: '10px 0 6px', lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          La journée<br/><span style={{ fontStyle: 'italic', color: NOCTURNE.accent }}>commence fort.</span>
        </h1>
        <p style={{ fontSize: 14, color: NOCTURNE.inkSoft, margin: 0, lineHeight: 1.5 }}>Valence, 18° nuageux. Prochain RDV dans 32 minutes.</p>
      </div>

      <div style={{ padding: '22px 22px 0' }}>
        <NTag color={NOCTURNE.accent}>◈ Agenda · 4 RDV</NTag>
        <div style={{ marginTop: 10, background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 16, overflow: 'hidden' }}>
          {MOCK.agenda.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 16px', borderBottom: i === MOCK.agenda.length - 1 ? 'none' : `1px solid ${NOCTURNE.line}`, alignItems: 'center' }}>
              <div style={{ fontFamily: NOCTURNE.serif, fontSize: 13, color: NOCTURNE.accent, width: 46, flexShrink: 0, fontWeight: 600 }}>{ev.time}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, lineHeight: 1.25 }}>{ev.title}</div>
                <div style={{ fontSize: 11, color: NOCTURNE.muted, marginTop: 2 }}>{ev.dur} · {ev.tag}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '22px 22px 0' }}>
        <NTag color={NOCTURNE.accent}>◈ Boîte · 3 non lus</NTag>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MOCK.emails.map((em, i) => (
            <div key={i} style={{ padding: '12px 16px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 6, height: 6, background: NOCTURNE.accent, borderRadius: 100, boxShadow: `0 0 8px ${NOCTURNE.accent}` }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{em.from}</div>
                <div style={{ fontSize: 11, color: NOCTURNE.muted, marginTop: 1 }}>{em.subject}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '22px 22px 28px' }}>
        <button style={{ width: '100%', padding: '14px', background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, color: NOCTURNE.bgDeep, border: 'none', fontSize: 14, fontWeight: 600, borderRadius: 14, cursor: 'pointer', boxShadow: `0 8px 30px ${NOCTURNE.accentGlow}` }}>
          {t.brief.start} →
        </button>
      </div>
    </div>
  );
}

// Tasks
function NocturneTasks({ t, onBack }) {
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, position: 'relative' }}>
      <Glow size={260} style={{ top: -60, right: -80 }} />
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: NOCTURNE.ink, padding: 0 }}>←</button>
        <NTag>{t.tasks.title}</NTag>
      </div>

      <div style={{ padding: '20px 22px 0', position: 'relative' }}>
        <h1 style={{ fontFamily: NOCTURNE.serif, fontSize: 30, fontWeight: 500, margin: 0, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          <span style={{ color: NOCTURNE.accent }}>3</span> <span style={{ color: NOCTURNE.muted, fontSize: 20 }}>/ 4</span>
        </h1>
        <p style={{ fontSize: 13, color: NOCTURNE.inkSoft, margin: '6px 0 0' }}>à faire avant ce soir</p>
      </div>

      <div style={{ padding: '22px 22px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MOCK.tasks.map(task => (
          <div key={task.id} style={{ display: 'flex', gap: 12, padding: '14px 16px', background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 14 }}>
            <div style={{ width: 20, height: 20, borderRadius: 100, flexShrink: 0, marginTop: 1, border: `1.5px solid ${task.done ? NOCTURNE.muted : NOCTURNE.accent}`, background: task.done ? NOCTURNE.muted : 'transparent', display: 'grid', placeItems: 'center', color: NOCTURNE.bgDeep, fontSize: 11, boxShadow: task.done ? 'none' : `0 0 10px ${NOCTURNE.accentGlow}` }}>{task.done && '✓'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, lineHeight: 1.3, textDecoration: task.done ? 'line-through' : 'none', color: task.done ? NOCTURNE.muted : NOCTURNE.ink }}>{task.title}</div>
              <NTag color={task.done ? NOCTURNE.muted : NOCTURNE.accent}>◦ {task.due}</NTag>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Settings
function NocturneSettings({ t, onBack, direction, lang }) {
  const Row = ({ l, v, last }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: last ? 'none' : `1px solid ${NOCTURNE.line}` }}>
      <span style={{ fontSize: 13 }}>{l}</span>
      <span style={{ fontSize: 12, color: NOCTURNE.muted }}>{v}</span>
    </div>
  );
  const Card = ({ label, children }) => (
    <div style={{ padding: '18px 22px 0' }}>
      <NTag>{label}</NTag>
      <div style={{ marginTop: 8, background: NOCTURNE.card, border: `1px solid ${NOCTURNE.line}`, borderRadius: 14, overflow: 'hidden' }}>{children}</div>
    </div>
  );
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, position: 'relative' }}>
      <Glow size={220} style={{ top: -60, right: -80 }} />
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: NOCTURNE.ink, padding: 0 }}>←</button>
        <NTag>{t.settings.title}</NTag>
      </div>
      <div style={{ padding: '18px 22px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 52, height: 52, borderRadius: 100, background: `linear-gradient(135deg, ${NOCTURNE.accent}, ${NOCTURNE.accentDeep})`, color: NOCTURNE.bgDeep, display: 'grid', placeItems: 'center', fontFamily: NOCTURNE.serif, fontSize: 22, fontWeight: 600, boxShadow: `0 6px 20px ${NOCTURNE.accentGlow}` }}>F</div>
        <div>
          <div style={{ fontFamily: NOCTURNE.serif, fontSize: 17 }}>Florent Pollet</div>
          <div style={{ fontSize: 11, color: NOCTURNE.muted }}>{MOCK.user.email}</div>
        </div>
      </div>
      <Card label={t.settings.keys}>
        <Row l="Anthropic" v="•••a4f2 ✓" />
        <Row l="Gemini" v="—" />
        <Row l="Mistral EU" v="•••eu91 ✓" last />
      </Card>
      <Card label={t.settings.appearance}>
        <Row l={t.settings.theme} v={direction} />
        <Row l={t.settings.language} v={lang.toUpperCase()} last />
      </Card>
      <Card label={t.settings.memory}>
        <div style={{ padding: 14, fontFamily: NOCTURNE.serif, fontSize: 13, lineHeight: 1.55, color: NOCTURNE.inkSoft, fontStyle: 'italic' }}>
          « Dirige Facades Pollet à Valence. Préfère les réponses courtes. Travaille surtout le matin. »
        </div>
      </Card>
      <div style={{ height: 28 }} />
    </div>
  );
}

// Report
function NocturneReport({ t, onBack }) {
  return (
    <div style={{ fontFamily: NOCTURNE.sans, color: NOCTURNE.ink, position: 'relative' }}>
      <Glow size={320} style={{ top: -100, right: -100 }} />
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: NOCTURNE.ink, padding: 0 }}>←</button>
        <NTag>Rapport · 19.04</NTag>
      </div>
      <div style={{ padding: '20px 22px 0', position: 'relative' }}>
        <NTag color={NOCTURNE.accent}>— {t.report.kicker}</NTag>
        <h1 style={{ fontFamily: NOCTURNE.serif, fontSize: 30, fontWeight: 500, margin: '8px 0 8px', lineHeight: 1.05, letterSpacing: '-0.02em' }}>{t.report.title}</h1>
        <div style={{ fontSize: 11, color: NOCTURNE.muted }}>{t.report.byArty} · {t.report.readTime}</div>
      </div>

      <div style={{ margin: '18px 22px 0', padding: 18, background: `linear-gradient(145deg, ${NOCTURNE.cardHi}, ${NOCTURNE.card})`, border: `1px solid ${NOCTURNE.line}`, borderRadius: 18, position: 'relative', overflow: 'hidden' }}>
        <Glow size={160} style={{ top: -40, right: -40 }} />
        <NTag color={NOCTURNE.accent}>Chiffres clés · Avril</NTag>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12, position: 'relative' }}>
          {[
            { v: '–4,2 %', l: 'Polystyrène', glow: true },
            { v: '+1,1 %', l: 'Enduits' },
            { v: '1,89 €', l: 'Parpaing' },
            { v: '14,30 €', l: 'Isolant /m²' },
          ].map((k, i) => (
            <div key={i}>
              <div style={{ fontFamily: NOCTURNE.serif, fontSize: 22, fontWeight: 500, color: k.glow ? NOCTURNE.accent : NOCTURNE.ink, textShadow: k.glow ? `0 0 20px ${NOCTURNE.accentGlow}` : 'none' }}>{k.v}</div>
              <NTag>{k.l}</NTag>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '18px 22px 0' }}>
        <p style={{ fontFamily: NOCTURNE.serif, fontSize: 15, lineHeight: 1.6, margin: 0, color: NOCTURNE.inkSoft }}>
          Le marché de l'isolation bascule ce printemps. Gedimat annonce <strong style={{ color: NOCTURNE.accent, fontWeight: 600 }}>–4,2 %</strong> sur le polystyrène — signal attendu depuis la baisse du baril en mars.
        </p>
      </div>

      <div style={{ padding: '18px 22px 0' }}>
        <div style={{ padding: 16, background: NOCTURNE.card, border: `1px solid ${NOCTURNE.accent}`, borderRadius: 14, position: 'relative', boxShadow: `0 0 30px ${NOCTURNE.accentGlow}` }}>
          <NTag color={NOCTURNE.accent}>⚑ Recommandation</NTag>
          <div style={{ fontFamily: NOCTURNE.serif, fontSize: 14, marginTop: 6, lineHeight: 1.5, fontStyle: 'italic' }}>
            Commander 300 m² avant le <strong style={{ color: NOCTURNE.accent, fontStyle: 'normal' }}>25 avril</strong> — expiration des tarifs.
          </div>
        </div>
      </div>
      <div style={{ height: 28 }} />
    </div>
  );
}

window.NOCTURNE = NOCTURNE;
window.NocturneScreens = { login: NocturneLogin, home: NocturneHome, chat: NocturneChat, sidebar: NocturneSidebar, brief: NocturneBrief, tasks: NocturneTasks, settings: NocturneSettings, report: NocturneReport };
