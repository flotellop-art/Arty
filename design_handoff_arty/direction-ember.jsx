// Direction 1 — EMBER: editorial warm, Lora-forward, paper-texture cards
// Reinterprets Arty as a personal magazine. Serif headlines, wide margins,
// a hand-drawn feel. Ember orange is rare and used for moments.

const EMBER = {
  name: 'Ember',
  desc: 'Editorial · warm · serif',
  bg: '#F2EBDE',          // warmer paper
  bgDeep: '#E8DFCE',
  ink: '#1D1813',
  muted: '#7A6E5E',
  card: '#FBF6EC',
  line: 'rgba(29,24,19,0.08)',
  accent: '#C4491C',       // refined ember
  accentDim: 'rgba(196,73,28,0.12)',
  serif: "'Lora', 'Cormorant Garamond', Georgia, serif",
  sans: "'Inter', ui-sans-serif, system-ui",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

// Small building blocks
function EmTag({ children, color }) {
  const c = color || EMBER.muted;
  return (
    <span style={{
      fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
      color: c, fontFamily: EMBER.sans, fontWeight: 600,
    }}>{children}</span>
  );
}

function EmRule() {
  return <div style={{ height: 1, background: EMBER.line, margin: '14px 0' }} />;
}

function EmDrop({ letter }) {
  return (
    <span style={{
      float: 'left', fontFamily: EMBER.serif, fontSize: 54, lineHeight: 0.85,
      color: EMBER.accent, marginRight: 8, marginTop: 4, fontWeight: 500,
    }}>{letter}</span>
  );
}

// ═══ LOGIN ═══
function EmberLogin({ t }) {
  return (
    <div style={{ padding: '32px 28px', color: EMBER.ink, fontFamily: EMBER.sans }}>
      <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 44 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Star size={22} color={EMBER.accent} fill />
          <span style={{ fontFamily: EMBER.serif, fontSize: 26, fontStyle: 'italic', letterSpacing: '-0.01em' }}>arty</span>
        </div>
        <EmRule />
        <EmTag>Édition privée · Vol. 1</EmTag>
      </div>

      <h1 style={{
        fontFamily: EMBER.serif, fontSize: 42, lineHeight: 1.05, fontWeight: 500,
        margin: 0, letterSpacing: '-0.025em',
      }}>
        {t.login.title}<span style={{ color: EMBER.accent }}>.</span>
      </h1>
      <p style={{ fontFamily: EMBER.serif, fontStyle: 'italic', color: EMBER.muted, fontSize: 16, marginTop: 8 }}>
        {t.login.subtitle}
      </p>

      <div style={{ marginTop: 36 }}>
        <div style={{ fontSize: 11, color: EMBER.muted, marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {t.login.apiKeyLabel}
        </div>
        <div style={{
          borderBottom: `1px solid ${EMBER.ink}`, padding: '10px 0',
          fontFamily: EMBER.mono, fontSize: 14, color: EMBER.muted,
        }}>
          {t.login.apiKeyPlaceholder}
        </div>
      </div>

      <button style={{
        width: '100%', marginTop: 28, padding: '16px',
        background: EMBER.ink, color: EMBER.bg, border: 'none',
        fontFamily: EMBER.serif, fontSize: 17, fontStyle: 'italic', fontWeight: 500,
        letterSpacing: '0.02em', borderRadius: 4, cursor: 'pointer',
      }}>
        {t.login.start} →
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
        <div style={{ flex: 1, height: 1, background: EMBER.line }} />
        <span style={{ fontSize: 10, color: EMBER.muted, letterSpacing: '0.2em' }}>OU</span>
        <div style={{ flex: 1, height: 1, background: EMBER.line }} />
      </div>

      <button style={{
        width: '100%', padding: '14px', background: 'transparent',
        border: `1px solid ${EMBER.ink}`, color: EMBER.ink,
        fontFamily: EMBER.sans, fontSize: 14, fontWeight: 500,
        borderRadius: 4, cursor: 'pointer',
      }}>
        {t.login.continueGoogle}
      </button>

      <p style={{ fontSize: 11, color: EMBER.muted, textAlign: 'center', marginTop: 28, fontStyle: 'italic', fontFamily: EMBER.serif, lineHeight: 1.5 }}>
        {t.login.privacyNote}
      </p>
    </div>
  );
}

// ═══ HOME ═══
function EmberHome({ t, onOpen }) {
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink, padding: '0 0 20px' }}>
      {/* Masthead */}
      <div style={{ padding: '16px 22px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <EmTag>Vendredi 19 Avril · Valence</EmTag>
        <button onClick={() => onOpen('sidebar')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <Star size={22} color={EMBER.ink} />
        </button>
      </div>
      <div style={{ height: 2, background: EMBER.ink, margin: '0 22px' }} />
      <div style={{ height: 1, background: EMBER.ink, margin: '3px 22px 0' }} />

      {/* Hero */}
      <div style={{ padding: '24px 22px 8px' }}>
        <h1 style={{
          fontFamily: EMBER.serif, fontSize: 40, lineHeight: 0.98, fontWeight: 500,
          margin: 0, letterSpacing: '-0.03em',
        }}>
          Bonjour<br/>
          <span style={{ fontStyle: 'italic' }}>Florent</span><span style={{ color: EMBER.accent }}>.</span>
        </h1>
        <p style={{ fontFamily: EMBER.serif, fontStyle: 'italic', color: EMBER.muted, fontSize: 16, margin: '10px 0 0' }}>
          Quatre rendez-vous aujourd'hui,<br/>trois mails à lire.
        </p>
      </div>

      {/* Brief card — the "feature article" */}
      <div onClick={() => onOpen('brief')} style={{
        margin: '22px 22px 0', padding: 20, background: EMBER.card, borderRadius: 2,
        border: `1px solid ${EMBER.line}`, cursor: 'pointer', position: 'relative',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
      }}>
        <EmTag color={EMBER.accent}>◈ Le brief du matin</EmTag>
        <h2 style={{ fontFamily: EMBER.serif, fontSize: 22, margin: '8px 0 6px', fontWeight: 500, lineHeight: 1.15 }}>
          Chantier prioritaire, <span style={{ fontStyle: 'italic' }}>et une baisse chez Gedimat.</span>
        </h2>
        <p style={{ fontSize: 13, color: EMBER.muted, margin: 0, lineHeight: 1.5 }}>
          Visite 9h30 à Bourg-lès-Valence · isolation polystyrène –4 % dès le 22 · Claire attend les photos.
        </p>
        <div style={{ position: 'absolute', top: 18, right: 18, color: EMBER.accent, fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13 }}>lire →</div>
      </div>

      {/* Two-up: agenda & intents */}
      <div style={{ padding: '26px 22px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <EmTag>Agenda</EmTag>
          <div style={{ borderTop: `1px solid ${EMBER.ink}`, marginTop: 6, paddingTop: 10 }}>
            {MOCK.agenda.slice(0, 3).map(ev => (
              <div key={ev.time} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: `1px dotted ${EMBER.line}` }}>
                <div style={{ fontFamily: EMBER.mono, fontSize: 11, color: EMBER.accent, fontWeight: 600 }}>{ev.time}</div>
                <div style={{ fontFamily: EMBER.serif, fontSize: 13, lineHeight: 1.2, marginTop: 2 }}>{ev.title.split(' — ')[0]}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <EmTag>Intentions</EmTag>
          <div style={{ borderTop: `1px solid ${EMBER.ink}`, marginTop: 6, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[t.home.sug1, t.home.sug2, t.home.sug3, t.home.sug4].map((s, i) => (
              <div key={i} onClick={() => onOpen('chat')} style={{
                fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13,
                color: EMBER.ink, borderLeft: `2px solid ${EMBER.accent}`,
                paddingLeft: 8, lineHeight: 1.25, cursor: 'pointer',
              }}>« {s} »</div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer composer */}
      <div style={{
        margin: '26px 22px 0', padding: '14px 16px',
        background: EMBER.bgDeep, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 12,
        border: `1px solid ${EMBER.line}`,
      }} onClick={() => onOpen('chat')}>
        <span style={{ fontFamily: EMBER.serif, fontStyle: 'italic', color: EMBER.muted, fontSize: 14, flex: 1 }}>
          {t.home.placeholder}
        </span>
        <div style={{
          width: 34, height: 34, borderRadius: 100, background: EMBER.ink, color: EMBER.bg,
          display: 'grid', placeItems: 'center', fontSize: 14,
        }}>→</div>
      </div>
    </div>
  );
}

// ═══ CHAT ═══
function EmberChat({ t, onBack }) {
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${EMBER.line}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, color: EMBER.ink, cursor: 'pointer', padding: 0 }}>←</button>
        <div style={{ flex: 1 }}>
          <EmTag>Conversation · 14:02</EmTag>
          <div style={{ fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 16, lineHeight: 1.1 }}>Résumé des mails importants</div>
        </div>
        <div style={{ fontSize: 10, color: EMBER.muted, border: `1px solid ${EMBER.line}`, padding: '3px 8px', borderRadius: 100 }}>Claude 4.6</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px 8px' }}>
        {MOCK.chatMessages.map((m, i) => {
          if (m.role === 'action') {
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', fontFamily: EMBER.mono, fontSize: 10, color: EMBER.accent, letterSpacing: '0.1em' }}>
                <span>◈</span><span>LECTURE DES MAILS…</span>
                <div style={{ flex: 1, height: 1, background: EMBER.accentDim }} />
              </div>
            );
          }
          if (m.role === 'user') {
            return (
              <div key={i} style={{
                fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 16,
                color: EMBER.ink, margin: '14px 0 14px auto',
                maxWidth: '85%', textAlign: 'right', lineHeight: 1.3,
                borderRight: `2px solid ${EMBER.accent}`, paddingRight: 12,
              }}>« {m.content} »</div>
            );
          }
          // assistant
          const paragraphs = m.content.split('\n\n');
          return (
            <div key={i} style={{ margin: '16px 0 24px', maxWidth: '92%' }}>
              {paragraphs.map((p, j) => {
                if (p.startsWith('>')) {
                  return (
                    <div key={j} style={{
                      margin: '10px 0', padding: '10px 14px',
                      background: EMBER.card, borderLeft: `3px solid ${EMBER.accent}`,
                      fontFamily: EMBER.serif, fontSize: 14, fontStyle: 'italic', lineHeight: 1.5,
                      color: EMBER.ink, whiteSpace: 'pre-line',
                    }}>{p.replace(/^> ?/gm, '')}</div>
                  );
                }
                return (
                  <p key={j} style={{
                    fontSize: 14, lineHeight: 1.6, margin: '0 0 10px',
                    fontFamily: EMBER.sans, color: EMBER.ink, whiteSpace: 'pre-line',
                  }} dangerouslySetInnerHTML={{ __html: p.replace(/\*\*(.+?)\*\*/g, `<strong style="font-family:${EMBER.serif};font-weight:500">$1</strong>`) }} />
                );
              })}
              {m.draft && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button style={{ padding: '8px 14px', background: EMBER.accent, color: EMBER.bg, border: 'none', borderRadius: 2, fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13, cursor: 'pointer' }}>Envoyer</button>
                  <button style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${EMBER.ink}`, color: EMBER.ink, borderRadius: 2, fontFamily: EMBER.sans, fontSize: 12, cursor: 'pointer' }}>Réviser</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${EMBER.line}`, background: EMBER.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: EMBER.card, borderRadius: 2, border: `1px solid ${EMBER.line}` }}>
          <span style={{ color: EMBER.muted, fontSize: 16 }}>+</span>
          <span style={{ flex: 1, fontFamily: EMBER.serif, fontStyle: 'italic', color: EMBER.muted, fontSize: 14 }}>{t.chat.placeholder}</span>
          <span style={{ color: EMBER.muted, fontSize: 14 }}>⏺</span>
        </div>
      </div>
    </div>
  );
}

// ═══ SIDEBAR (full screen drawer) ═══
function EmberSidebar({ t, onBack, onOpen }) {
  const groups = [
    { key: 'today', label: t.sidebar.today },
    { key: 'yesterday', label: t.sidebar.yesterday },
    { key: 'earlier', label: t.sidebar.earlier },
  ];
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink, padding: '14px 0' }}>
      <div style={{ padding: '0 22px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Star size={22} color={EMBER.accent} fill />
          <span style={{ fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 22 }}>arty</span>
        </div>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: EMBER.ink }}>✕</button>
      </div>
      <div style={{ height: 2, background: EMBER.ink, margin: '0 22px' }} />
      <div style={{ height: 1, background: EMBER.ink, margin: '3px 22px 18px' }} />

      <div style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${EMBER.line}`, borderRadius: 2, padding: '10px 14px', background: EMBER.card }}>
          <span style={{ color: EMBER.muted, fontSize: 14 }}>⌕</span>
          <span style={{ fontFamily: EMBER.serif, fontStyle: 'italic', color: EMBER.muted, fontSize: 14 }}>{t.sidebar.search}</span>
        </div>
        <button style={{
          width: '100%', marginTop: 12, padding: '14px', background: EMBER.ink, color: EMBER.bg,
          border: 'none', fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 15,
          borderRadius: 2, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 18, fontStyle: 'normal' }}>+</span> {t.sidebar.new}
        </button>
      </div>

      {groups.map(g => {
        const convs = MOCK.conversations.filter(c => c.group === g.key);
        if (!convs.length) return null;
        return (
          <div key={g.key} style={{ padding: '22px 22px 0' }}>
            <EmTag>— {g.label}</EmTag>
            <div style={{ marginTop: 10 }}>
              {convs.map((c, i) => (
                <div key={c.id} onClick={() => onOpen('chat')} style={{
                  padding: '10px 0', borderBottom: i === convs.length - 1 ? 'none' : `1px dotted ${EMBER.line}`,
                  cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontFamily: EMBER.serif, fontSize: 15, lineHeight: 1.2, fontWeight: 500 }}>{c.title}</div>
                    <div style={{ fontFamily: EMBER.mono, fontSize: 10, color: EMBER.muted, flexShrink: 0, marginLeft: 10 }}>{c.when}</div>
                  </div>
                  <div style={{ fontSize: 12, color: EMBER.muted, marginTop: 2, lineHeight: 1.4, fontStyle: 'italic' }}>{c.preview}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ padding: '24px 22px 0', display: 'flex', gap: 8 }}>
        {[
          { k: 'tasks', l: t.sidebar.tasks, icon: '✓' },
          { k: 'settings', l: t.sidebar.settings, icon: '⚙' },
        ].map(b => (
          <button key={b.k} onClick={() => onOpen(b.k)} style={{
            flex: 1, padding: '10px', background: EMBER.card, border: `1px solid ${EMBER.line}`,
            fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13, color: EMBER.ink,
            borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <span style={{ color: EMBER.accent }}>{b.icon}</span> {b.l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══ MORNING BRIEF ═══
function EmberBrief({ t, onBack }) {
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink, background: EMBER.bg }}>
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: EMBER.ink, padding: 0 }}>←</button>
        <EmTag>Le brief · Vendredi</EmTag>
      </div>
      <div style={{ height: 2, background: EMBER.ink, margin: '0 22px' }} />
      <div style={{ height: 1, background: EMBER.ink, margin: '3px 22px 0' }} />

      <div style={{ padding: '24px 22px 8px' }}>
        <h1 style={{ fontFamily: EMBER.serif, fontSize: 34, lineHeight: 1.02, margin: 0, fontWeight: 500, letterSpacing: '-0.02em' }}>
          La journée<br/>
          <span style={{ fontStyle: 'italic', color: EMBER.accent }}>commence fort.</span>
        </h1>
        <p style={{ fontFamily: EMBER.serif, fontStyle: 'italic', color: EMBER.muted, fontSize: 15, marginTop: 10 }}>
          Valence, 18° nuageux. Café servi à 7h04.
        </p>
      </div>

      <div style={{ padding: '22px 22px 8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${EMBER.ink}`, paddingBottom: 6, marginBottom: 12 }}>
          <EmTag>I · Agenda</EmTag>
          <span style={{ fontFamily: EMBER.mono, fontSize: 10, color: EMBER.muted }}>4 rendez-vous</span>
        </div>
        {MOCK.agenda.map((ev, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: i === MOCK.agenda.length - 1 ? 'none' : `1px dotted ${EMBER.line}` }}>
            <div style={{ fontFamily: EMBER.mono, fontSize: 12, fontWeight: 700, color: EMBER.accent, width: 48, flexShrink: 0 }}>{ev.time}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: EMBER.serif, fontSize: 14, lineHeight: 1.25 }}>{ev.title}</div>
              <div style={{ fontSize: 11, color: EMBER.muted, marginTop: 2 }}>{ev.dur} · {ev.tag}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '22px 22px 8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${EMBER.ink}`, paddingBottom: 6, marginBottom: 12 }}>
          <EmTag>II · Correspondance</EmTag>
          <span style={{ fontFamily: EMBER.mono, fontSize: 10, color: EMBER.muted }}>3 non lus</span>
        </div>
        {MOCK.emails.map((em, i) => (
          <div key={i} style={{ padding: '10px 0', borderBottom: i === MOCK.emails.length - 1 ? 'none' : `1px dotted ${EMBER.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: EMBER.serif, fontSize: 14, fontWeight: 500 }}>{em.from}</div>
              <div style={{ width: 6, height: 6, borderRadius: 100, background: EMBER.accent }} />
            </div>
            <div style={{ fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13, color: EMBER.muted, marginTop: 2 }}>{em.subject}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 22px 28px' }}>
        <button style={{
          width: '100%', padding: '16px', background: EMBER.ink, color: EMBER.bg,
          border: 'none', fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 17,
          fontWeight: 500, borderRadius: 2, cursor: 'pointer',
        }}>
          {t.brief.start} →
        </button>
      </div>
    </div>
  );
}

// ═══ TASKS ═══
function EmberTasks({ t, onBack }) {
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink }}>
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: EMBER.ink, padding: 0 }}>←</button>
        <EmTag>{t.tasks.title}</EmTag>
      </div>
      <div style={{ height: 2, background: EMBER.ink, margin: '0 22px' }} />
      <div style={{ height: 1, background: EMBER.ink, margin: '3px 22px 0' }} />

      <div style={{ padding: '24px 22px 8px' }}>
        <h1 style={{ fontFamily: EMBER.serif, fontSize: 32, margin: 0, fontWeight: 500, letterSpacing: '-0.02em' }}>
          Trois choses à<br/><span style={{ fontStyle: 'italic', color: EMBER.accent }}>faire aujourd'hui</span>.
        </h1>
      </div>

      <div style={{ padding: '22px 22px 8px' }}>
        {MOCK.tasks.map((task, i) => (
          <div key={task.id} style={{
            display: 'flex', gap: 12, padding: '14px 0',
            borderBottom: i === MOCK.tasks.length - 1 ? 'none' : `1px dotted ${EMBER.line}`,
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: 100, flexShrink: 0, marginTop: 2,
              border: `1.5px solid ${task.done ? EMBER.muted : EMBER.accent}`,
              background: task.done ? EMBER.muted : 'transparent',
              display: 'grid', placeItems: 'center', color: EMBER.bg, fontSize: 11,
            }}>{task.done && '✓'}</div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontFamily: EMBER.serif, fontSize: 15, lineHeight: 1.3,
                textDecoration: task.done ? 'line-through' : 'none',
                color: task.done ? EMBER.muted : EMBER.ink,
              }}>{task.title}</div>
              <div style={{ fontFamily: EMBER.mono, fontSize: 10, color: EMBER.accent, marginTop: 4, letterSpacing: '0.1em' }}>◈ {task.due.toUpperCase()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ SETTINGS ═══
function EmberSettings({ t, onBack, direction, onDir, lang, onLang }) {
  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: `1px dotted ${EMBER.line}` }}>
      <span style={{ fontFamily: EMBER.serif, fontSize: 14 }}>{label}</span>
      <span style={{ fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13, color: EMBER.muted }}>{value}</span>
    </div>
  );
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink }}>
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: EMBER.ink, padding: 0 }}>←</button>
        <EmTag>{t.settings.title}</EmTag>
      </div>
      <div style={{ height: 2, background: EMBER.ink, margin: '0 22px' }} />
      <div style={{ height: 1, background: EMBER.ink, margin: '3px 22px 0' }} />

      <div style={{ padding: '24px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 100, background: EMBER.accent, color: EMBER.bg, display: 'grid', placeItems: 'center', fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 24 }}>F</div>
          <div>
            <div style={{ fontFamily: EMBER.serif, fontSize: 18 }}>Florent</div>
            <div style={{ fontSize: 12, color: EMBER.muted }}>{MOCK.user.email}</div>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <EmTag>— {t.settings.keys}</EmTag>
          <Row label="Anthropic" value="sk-ant-…a4f2 ✓" />
          <Row label="Gemini" value="optionnel" />
          <Row label="Mistral EU" value="gk-…eu91 ✓" />
        </div>

        <div style={{ marginTop: 22 }}>
          <EmTag>— {t.settings.appearance}</EmTag>
          <Row label={t.settings.theme} value={direction} />
          <Row label={t.settings.language} value={lang.toUpperCase()} />
        </div>

        <div style={{ marginTop: 22 }}>
          <EmTag>— {t.settings.memory}</EmTag>
          <p style={{ fontFamily: EMBER.serif, fontStyle: 'italic', fontSize: 13, lineHeight: 1.5, color: EMBER.muted, marginTop: 8 }}>
            « Florent dirige Facades Pollet à Valence. Il préfère les réponses courtes, appelle ses clients par leur prénom, et travaille surtout le matin. »
          </p>
          <button style={{ marginTop: 10, padding: '8px 14px', background: 'transparent', border: `1px solid ${EMBER.ink}`, color: EMBER.ink, fontFamily: EMBER.sans, fontSize: 12, borderRadius: 2, cursor: 'pointer' }}>Voir la mémoire complète</button>
        </div>
      </div>
    </div>
  );
}

// ═══ REPORT ═══
function EmberReport({ t, onBack }) {
  return (
    <div style={{ fontFamily: EMBER.sans, color: EMBER.ink, background: EMBER.bg }}>
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: EMBER.ink, padding: 0 }}>←</button>
        <EmTag>{t.report.chapter} III</EmTag>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: EMBER.mono, fontSize: 10, color: EMBER.muted }}>p. 03/12</span>
      </div>
      <div style={{ height: 2, background: EMBER.ink, margin: '0 22px' }} />
      <div style={{ height: 1, background: EMBER.ink, margin: '3px 22px 0' }} />

      <div style={{ padding: '28px 22px 0', textAlign: 'center' }}>
        <EmTag color={EMBER.accent}>◈ {t.report.kicker}</EmTag>
        <h1 style={{ fontFamily: EMBER.serif, fontSize: 32, lineHeight: 1.02, margin: '10px 0 6px', fontWeight: 500, letterSpacing: '-0.02em' }}>
          <span style={{ fontStyle: 'italic' }}>{t.report.title}</span>
        </h1>
        <div style={{ fontSize: 11, color: EMBER.muted, fontStyle: 'italic', fontFamily: EMBER.serif }}>{t.report.byArty} · {t.report.readTime}</div>
      </div>

      <div style={{ height: 1, background: EMBER.line, margin: '20px 42px' }} />

      <div style={{ padding: '0 22px 8px' }}>
        <p style={{ fontFamily: EMBER.serif, fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          <EmDrop letter="L" />
          e marché de l'isolation thermique bascule doucement ce printemps. Gedimat annonce une baisse de <strong style={{ color: EMBER.accent, fontWeight: 600 }}>4,2 %</strong> sur le polystyrène, un signal attendu depuis la baisse du baril en mars.
        </p>
      </div>

      <div style={{ margin: '18px 22px', padding: '14px 16px', background: EMBER.card, border: `1px solid ${EMBER.line}`, borderRadius: 2 }}>
        <EmTag>Chiffres clés</EmTag>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          {[
            { v: '–4,2 %', l: 'Polystyrène' },
            { v: '+1,1 %', l: 'Enduits' },
            { v: '1,89 €', l: 'Parpaing 20' },
            { v: '14,30 €', l: 'Isolant /m²' },
          ].map((k, i) => (
            <div key={i}>
              <div style={{ fontFamily: EMBER.serif, fontSize: 22, color: EMBER.accent, fontWeight: 500 }}>{k.v}</div>
              <div style={{ fontSize: 10, color: EMBER.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{k.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 22px 32px' }}>
        <p style={{ fontFamily: EMBER.serif, fontSize: 15, lineHeight: 1.6, margin: 0, color: EMBER.ink }}>
          Point P reste en retrait mais Bâti Négoce s'aligne dès la semaine prochaine. Ma recommandation — <em style={{ color: EMBER.accent }}>commander tes 300 m² avant le 25</em>, date à laquelle les tarifs promotionnels expirent.
        </p>
        <div style={{ marginTop: 22, borderTop: `1px solid ${EMBER.line}`, paddingTop: 14, textAlign: 'center' }}>
          <EmTag>⁂</EmTag>
        </div>
      </div>
    </div>
  );
}

window.EMBER = EMBER;
window.EmberScreens = { login: EmberLogin, home: EmberHome, chat: EmberChat, sidebar: EmberSidebar, brief: EmberBrief, tasks: EmberTasks, settings: EmberSettings, report: EmberReport };
