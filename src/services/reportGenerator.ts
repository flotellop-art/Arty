import { getDateLocale } from '../utils/formatDate'

const REPORT_STORAGE_KEY = 'arty-report-'

// Palette + composants conformes à la spec "Rapport Arty Premium v3 finale".
// Règles absolues : fond blanc partout, aucun emoji, rouille uniquement sur
// badges/filets/chiffres clés, chaleur par les accents (sable / caramel /
// tabac), pas de box-shadow, espace 36px entre sections, 24px sous-sections.
const REPORT_TEMPLATE = (title: string, content: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<base target="_blank">
<title>${title} — Arty</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap" rel="stylesheet">
<style>
:root{
  --c-bg-page:#FFFFFF;
  --c-bg-body:#FAFAF8;
  --c-ink:#1A1714;
  --c-ink-2:#6B5C4E;
  --c-ink-3:#A8927E;
  --c-accent:#C4623A;
  --c-accent-dk:#9E4228;
  --c-sand:#F0E4D4;
  --c-quote:#F5E9DC;
  --c-alt:#EDD9C4;
  --c-line:#DECCBA;
  --c-th:#7A5240;
  --c-row-even:#F5EBE0;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--c-bg-body);color:var(--c-ink);font-family:'Inter',sans-serif;font-weight:400;line-height:1.72;font-size:10.5px;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;top:0;left:0;right:0;height:5px;background:linear-gradient(90deg,#7A3A1A,#9E4228,#C4623A,#E08A5A,#EAB080);z-index:100}
.page{max-width:840px;margin:0 auto;background:var(--c-bg-page);padding:max(80px, calc(env(safe-area-inset-top, 0px) + 60px)) 72px 0}
.page+.page{margin-top:24px}

/* En-tête de page */
.page-header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--c-line);margin-bottom:36px}
.page-header .brand{display:flex;align-items:center;gap:8px;font-family:'Lora',serif;font-style:italic;font-size:14px;color:var(--c-accent)}
.page-header .brand svg{width:22px;height:22px;flex-shrink:0}
.page-header .doc-title{font-family:'Inter',sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:var(--c-ink-3);font-weight:600;text-align:center}
.page-header .doc-date{font-family:'Inter',sans-serif;font-size:10px;color:var(--c-ink-3);text-align:right}

/* Page de couverture (en début de rapport) */
.cover{padding:80px 0 60px}
.cover .pill{display:inline-flex;align-items:center;background:var(--c-accent);color:#fff;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;padding:5px 12px;border-radius:3px;margin-bottom:32px}
.cover h1.cover-title{font-family:'Lora',serif;font-size:38px;font-weight:500;letter-spacing:-0.02em;color:var(--c-ink);max-width:540px;line-height:1.15;margin-bottom:18px}
.cover .cover-subtitle{font-family:'Lora',serif;font-style:italic;font-size:14px;color:var(--c-ink-2);max-width:480px;line-height:1.55;margin-bottom:40px}
.cover .cover-sep{height:1px;background:var(--c-line);margin:0 0 18px}
.cover .cover-meta{font-family:'Inter',sans-serif;font-size:10px;color:var(--c-ink-3)}
.cover .cover-meta span+span::before{content:' · ';margin:0 4px;color:var(--c-line)}

/* Footer */
.page-footer{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-top:1px solid var(--c-line);padding:16px 0;margin-top:48px;font-family:'Inter',sans-serif;font-size:9px;color:var(--c-ink-3)}
.page-footer .right{text-align:right}
.page-footer .center{text-align:center}

/* Typographie */
.content{padding-bottom:8px}
.content h1{font-family:'Lora',serif;font-size:28px;font-weight:500;color:var(--c-ink);margin:36px 0 18px;letter-spacing:-0.01em}
.content h2{font-family:'Lora',serif;font-size:18px;font-style:italic;font-weight:500;color:var(--c-ink);margin:36px 0 14px;background:var(--c-sand);padding:14px 18px;border-radius:4px;display:flex;align-items:center;gap:10px}
.content h2::before{content:counter(sec, decimal-leading-zero);counter-increment:sec;background:var(--c-accent);color:#fff;font-family:'Inter',sans-serif;font-style:normal;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;padding:3px 8px;border-radius:3px;flex-shrink:0}
.content{counter-reset:sec}
.content h3{font-family:'Lora',serif;font-size:14px;font-weight:500;color:var(--c-ink);margin:24px 0 10px}
.content h4,.content h5,.content h6{font-family:'Inter',sans-serif;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--c-ink-3);margin:20px 0 10px}
.content p{margin:10px 0;color:var(--c-ink-2)}
.content strong{font-weight:600;color:var(--c-ink)}
.content em{font-style:italic;color:var(--c-ink)}
.content a{color:var(--c-accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
.content a:hover{color:var(--c-accent-dk)}
.content hr{border:none;height:1px;background:var(--c-line);margin:36px 0}

/* Listes prose — puce "—" en accent */
.content ul,.content ol{margin:10px 0;padding:0;list-style:none}
.content li{position:relative;padding-left:14px;margin:6px 0;color:var(--c-ink-2);line-height:1.65}
.content li::before{content:'—';color:var(--c-accent);position:absolute;left:0;font-weight:500}
.content ol{counter-reset:olc}
.content ol>li::before{content:counter(olc) '.';counter-increment:olc;font-family:'Inter',sans-serif;font-weight:600;color:var(--c-accent)}

/* Citations / pull quote */
.content blockquote{background:var(--c-quote);border-left:3px solid var(--c-accent);border-radius:0 6px 6px 0;padding:14px 20px;margin:24px 0;font-family:'Lora',serif;font-style:italic;font-size:12.5px;color:var(--c-ink);line-height:1.6}

/* Code */
.content code{background:#F4EFE7;color:var(--c-ink);font-family:'Courier New',monospace;font-size:0.92em;padding:1px 5px;border-radius:3px;border:1px solid var(--c-line)}
.content pre{background:#F4EFE7;color:var(--c-ink);font-family:'Courier New',monospace;font-size:9.5px;padding:14px 16px;margin:16px 0;border-radius:4px;border:1px solid var(--c-line);overflow-x:auto;line-height:1.5}
.content pre code{background:transparent;padding:0;border:0}

/* Tableaux — th tabac chaud, lignes paires sable */
.content table{width:100%;border-collapse:collapse;margin:20px 0;font-size:10px;border:1px solid var(--c-line);border-radius:4px;overflow:hidden}
.content thead{background:var(--c-th);color:#fff}
.content th{padding:9px 10px;text-align:left;font-family:'Inter',sans-serif;font-size:8.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em}
.content td{padding:9px 10px;color:var(--c-ink-2);border-bottom:1px solid var(--c-line);vertical-align:top}
.content tbody tr:nth-child(even){background:var(--c-row-even)}
.content tbody tr:last-child td{border-bottom:none}
.content td.accent{color:var(--c-accent);font-weight:500}
.content td.ink{color:var(--c-ink);font-weight:500}

/* Composants */
.section-card,.card{background:var(--c-bg-page);border:1px solid var(--c-line);border-radius:4px;padding:16px;margin:16px 0}
.section-card h2:first-child,.card h2:first-child{margin-top:0}
.stat-card{background:var(--c-bg-page);border:1px solid var(--c-line);border-radius:4px;padding:16px;margin:8px 0;border-top:2px solid var(--c-accent)}
.stat-card.accent{border-top-color:var(--c-accent)}
.stat-card.accent-dk{border-top-color:var(--c-accent-dk)}
.stat-card.tobacco{border-top-color:var(--c-th)}
.stat,.stat-card .stat-value,.big-number{font-family:'Lora',serif;font-size:28px;font-weight:500;color:var(--c-accent);line-height:1;display:block}
.medium-number{font-family:'Lora',serif;font-size:18px;font-weight:500;color:var(--c-accent)}
.stat-card .stat-label,.stat-label,.label,.subtitle{font-family:'Inter',sans-serif;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--c-ink-3);margin-top:8px;display:block}
.caption{font-family:'Inter',sans-serif;font-size:9px;color:var(--c-ink-3);margin-top:4px}

/* Encadré alternatif (sand-bg) — utilisé pour scénarios alt, mises en garde */
.alt-box,.alert,.alert-warning,.card-accent{background:var(--c-alt);border:1px solid var(--c-line);border-radius:6px;padding:20px 24px;margin:18px 0;color:var(--c-ink)}
.alert-info{background:var(--c-quote);border-color:var(--c-line)}
.alert-success{background:#E5EBDD;border:1px solid #C8D4B5}
.alert-danger{background:#F2DCD4;border:1px solid #DEB59E}

/* Chapter / section legacy → header sand */
.chapter,.card-dark{background:var(--c-sand);color:var(--c-ink);border-radius:4px;padding:14px 18px;margin:36px 0 18px}
.chapter-number{font-family:'Inter',sans-serif;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--c-accent)}
.chapter-title{font-family:'Lora',serif;font-size:18px;font-style:italic;font-weight:500;color:var(--c-ink);margin-top:4px}
.chapter-subtitle{font-family:'Inter',sans-serif;font-size:10px;color:var(--c-ink-2);margin-top:6px}

/* Badges */
.badge{display:inline-block;padding:3px 8px;border-radius:3px;font-family:'Inter',sans-serif;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#fff;background:var(--c-accent)}
.badge-accent{background:var(--c-accent);color:#fff}
.badge-green{background:#7A8E5A;color:#fff}
.badge-red,.badge-orange{background:var(--c-accent-dk);color:#fff}
.badge-blue{background:var(--c-th);color:#fff}

/* Grilles */
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:14px 0}
.text-center{text-align:center}

/* Severity (rapport audit) — accents subtils, pas de fond saturé */
.severity-critical,.severity-warning,.severity-ok,.severity-info{padding:8px 14px;border-radius:4px;margin:6px 0;font-size:10px;font-weight:500;border-left:3px solid var(--c-accent)}
.severity-critical{background:#F2DCD4;color:var(--c-ink);border-left-color:var(--c-accent-dk)}
.severity-warning{background:var(--c-alt);color:var(--c-ink);border-left-color:var(--c-accent)}
.severity-ok{background:#E5EBDD;color:var(--c-ink);border-left-color:#7A8E5A}
.severity-info{background:var(--c-quote);color:var(--c-ink);border-left-color:var(--c-th)}

/* Metric rows */
.metric-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--c-line)}
.metric-row:last-child{border-bottom:none}
.metric-label{font-family:'Inter',sans-serif;font-size:10px;color:var(--c-ink-2)}
.metric-value{font-family:'Lora',serif;font-size:14px;font-weight:500;color:var(--c-ink)}

/* Dividers */
.divider{height:1px;background:var(--c-line);margin:24px 0}
.divider-accent{height:2px;background:linear-gradient(90deg,var(--c-accent),transparent);margin:24px 0}

/* Boutons UI (réservés, hors PDF) */
.report-actions{position:fixed;top:max(2.75rem, calc(env(safe-area-inset-top, 0px) + 0.5rem));left:max(1rem, calc(env(safe-area-inset-left, 0px) + 0.5rem));display:flex;gap:8px;z-index:200}
.back-btn,.pdf-btn{font-family:'Inter',sans-serif;font-size:11px;font-weight:600;border:none;border-radius:6px;padding:8px 14px;cursor:pointer;transition:opacity 0.15s}
.back-btn{background:var(--c-ink);color:#fff}
.pdf-btn{background:var(--c-accent);color:#fff}
.back-btn:hover,.pdf-btn:hover{opacity:0.85}

/* Print + responsive */
@media print{
  body{background:#fff}
  body::before{display:none}
  .report-actions{display:none}
  .page{padding:36px 50px;max-width:none}
}
@media(min-width:641px){
  .page{padding-top:52px}
}
@media(max-width:640px){
  .page{padding:32px 24px 0}
  .cover{padding:48px 0 32px}
  .cover h1.cover-title{font-size:28px}
  .cover .cover-subtitle{font-size:12px}
  .content h1{font-size:22px}
  .content h2{font-size:15px}
  .grid-2,.grid-3{grid-template-columns:1fr;gap:10px}
  .content table{font-size:9px}
  .content th,.content td{padding:7px 8px}
  .page-header .doc-title{display:none}
}
</style>
</head>
<body>
<div class="report-actions">
<button class="back-btn" onclick="window.parent.postMessage({type:'arty-report-back'},'*')">← Retour</button>
<button class="pdf-btn" onclick="window.parent.postMessage({type:'arty-report-export-pdf'},'*')">Télécharger PDF</button>
</div>
<div class="page">
  <div class="page-header">
    <div class="brand">
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16 4 L28 26 L16 20 Z" fill="#9E4228"/>
        <path d="M16 4 L4 26 L16 20 Z" fill="#D4785C"/>
      </svg>
      arty
    </div>
    <div class="doc-title">${title.replace(/[<>]/g, '')}</div>
    <div class="doc-date">${new Date().toLocaleDateString(getDateLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>

  <div class="cover">
    <span class="pill">Rapport</span>
    <h1 class="cover-title">${title}</h1>
    <div class="cover-sep"></div>
    <div class="cover-meta">
      <span>Généré le ${new Date().toLocaleDateString(getDateLocale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      <span>Arty</span>
    </div>
  </div>

  <div class="content">
${content}
  </div>

  <div class="page-footer">
    <div class="left">Généré par Arty</div>
    <div class="center">— 1 —</div>
    <div class="right">arty — assistant IA</div>
  </div>
</div>
</body>
</html>`

export function saveReport(title: string, htmlContent: string): string {
  const id = Date.now().toString(36)
  const fullHtml = REPORT_TEMPLATE(title, htmlContent)
  localStorage.setItem(REPORT_STORAGE_KEY + id, fullHtml)
  return id
}

export function getReport(id: string): string | null {
  return localStorage.getItem(REPORT_STORAGE_KEY + id)
}

export function openReport(title: string, htmlContent: string): string {
  const id = saveReport(title, htmlContent)
  return id
}
