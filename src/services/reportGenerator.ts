const REPORT_STORAGE_KEY = 'arty-report-'

const REPORT_TEMPLATE = (title: string, content: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<base target="_blank">
<title>${title} — Arty</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300..700;1,300..700&family=Inter:wght@300;400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;font-weight:300;background:#F2EBDE;color:#1D1813;line-height:1.6;position:relative}
body::before{content:'';position:fixed;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#C4491C,#8F3210);z-index:100}
.page{max-width:800px;margin:0 auto;padding:2rem 1.5rem}
.header{background:linear-gradient(145deg,#1D1813 0%,#28201A 50%,#1D1813 100%);color:#F5F0E8;border-radius:1.5rem;padding:2.5rem;margin-bottom:2rem;position:relative;overflow:hidden;box-shadow:0 8px 28px rgba(29,24,19,0.18),0 2px 6px rgba(29,24,19,0.08);border-left:6px solid #C4491C}
.header::before{content:'';position:absolute;top:0;left:0;width:6px;height:100%;background:linear-gradient(180deg,#C4491C,#F59A4B);border-radius:3px}
.header::after{content:'';position:absolute;top:-50%;right:-10%;width:300px;height:300px;background:radial-gradient(circle,rgba(196,73,28,0.10),transparent 70%);border-radius:50%}
.header h1{font-family:'Lora',serif;font-size:1.8rem;font-weight:700;margin-bottom:0.5rem}
.header .meta{font-size:0.8rem;opacity:0.6}
.header .logo{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.2em;color:#F59A4B;font-weight:700;margin-bottom:0.75rem}
.content{font-size:0.9rem}
.section-card{background:white;border-radius:12px;box-shadow:0 4px 16px rgba(29,24,19,0.08);padding:1.5rem 2rem;margin:1.5rem 0}
h2{font-family:'Lora',serif;font-size:1.3rem;color:#1D1813;margin:2rem 0 1rem;padding-bottom:0.5rem;padding-left:0.75rem;border-bottom:2px solid rgba(196,73,28,0.2);border-left:4px solid #C4491C}
.section-card h2{margin-top:0}
h3{font-family:'Lora',serif;font-size:1.05rem;color:#8F3210;margin:1.5rem 0 0.75rem}
p{margin:0.75rem 0}
strong{font-weight:600;color:#1D1813}
em{color:#8F3210;font-style:normal;font-weight:500}
a{color:#8F3210;cursor:pointer;text-decoration:underline}
a:hover{color:#C4491C}
pre,code{background:#1D1813;color:#F5F0E8;border-radius:6px;padding:0.2em 0.5em;font-family:monospace;font-size:0.85em}
pre{padding:1rem;overflow-x:auto;margin:1rem 0}
pre code{background:transparent;padding:0}
table{width:100%;border-collapse:collapse;margin:1rem 0;border-radius:0.75rem;overflow:hidden;box-shadow:0 2px 8px rgba(30,26,20,0.06)}
thead{background:#28201A;color:#F5F0E8}
th{padding:0.7rem 1rem;text-align:left;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;border-left:2px solid #C4491C}
th:first-child{border-left:none}
td{padding:0.7rem 1rem;border-bottom:1px solid rgba(30,26,20,0.06)}
tbody tr:nth-child(odd){background:#FBF6EC}
tbody tr:nth-child(even){background:white}
tbody tr:hover{background:#E8DFCE}
blockquote{background:linear-gradient(135deg,#F5F0E8,#ece7df);border-left:4px solid #C4491C;border-radius:0 1rem 1rem 0;padding:1.25rem 1.5rem;margin:1.25rem 0;font-family:'Lora',serif;font-style:italic}
ul,ol{margin:0.75rem 0;padding-left:0;list-style:none}
li{display:flex;gap:0.5rem;margin:0.4rem 0}
li::before{content:'●';color:#C4491C;font-size:0.5rem;margin-top:0.55rem;flex-shrink:0}
hr{border:none;height:1px;background:linear-gradient(to right,transparent,rgba(30,26,20,0.15),transparent);margin:2rem 0}
.card{background:white;border:1px solid rgba(30,26,20,0.06);border-radius:1rem;padding:1.25rem;margin:0.75rem 0;box-shadow:0 2px 8px rgba(30,26,20,0.04)}
.card-accent{background:linear-gradient(135deg,#C4491C,#8F3210);color:#F5F0E8;border-radius:1rem;padding:1.5rem;margin:0.75rem 0;box-shadow:0 4px 16px rgba(196,73,28,0.2);position:relative;overflow:hidden}
.card-accent::before{content:'';position:absolute;top:0;right:0;width:120px;height:120px;background:radial-gradient(circle,rgba(255,255,255,0.08),transparent 70%);border-radius:50%;transform:translate(30%,-30%)}
.card-dark{background:linear-gradient(145deg,#1D1813,#28201A);color:#F5F0E8;border-radius:1rem;padding:1.5rem;margin:0.75rem 0;position:relative}
.card-dark::after{content:'';position:absolute;bottom:0;left:0;width:100%;height:3px;background:linear-gradient(90deg,#C4491C,transparent)}
.big-number{font-size:2.5rem;font-weight:700;font-family:'Lora',serif;color:#8F3210;line-height:1}
.card-accent .big-number,.card-dark .big-number{color:#F5F0E8}
.medium-number{font-size:1.5rem;font-weight:700;font-family:'Lora',serif}
.subtitle{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.15em;opacity:0.45;font-weight:700;margin-bottom:0.35rem}
.caption{font-size:0.7rem;color:#9ca3af;margin-top:0.35rem}
.badge{display:inline-block;padding:0.2rem 0.65rem;border-radius:2rem;font-size:0.6rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase}
.badge-green{background:#e8f0e4;color:#4a7c42}
.badge-red{background:#f0e0df;color:#9e5c58}
.badge-orange{background:#f0e6da;color:#8e6640}
.badge-blue{background:#e0e8f0;color:#506a8a}
.badge-accent{background:#C4491C;color:#F5F0E8}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem}
.text-center{text-align:center}
.divider{height:1px;background:linear-gradient(to right,transparent,rgba(30,26,20,0.1),transparent);margin:1.25rem 0}
.divider-accent{height:3px;background:linear-gradient(90deg,#C4491C,#F59A4B,transparent);border-radius:2px;margin:1.25rem 0}
.alert{border-radius:0.75rem;padding:1rem 1.25rem;margin:0.75rem 0}
.alert-info{background:linear-gradient(135deg,#edf1f5,#e0e8f0);border-left:4px solid #6b89a8}
.alert-success{background:linear-gradient(135deg,#eef3ec,#e0ead9);border-left:4px solid #6a9462}
.alert-warning{background:linear-gradient(135deg,#f5f0e4,#ede5d4);border-left:4px solid #c4a060}
.alert-danger{background:linear-gradient(135deg,#f3edec,#ece2e0);border-left:4px solid #b07a75}
.chapter{background:linear-gradient(145deg,#1D1813,#28201A);color:#F5F0E8;border-radius:1rem;padding:1.5rem 1.75rem;margin:2rem 0 1rem;position:relative;overflow:hidden}
.chapter::before{content:'';position:absolute;top:0;left:0;width:4px;height:100%;background:linear-gradient(180deg,#C4491C,#F59A4B)}
.chapter-number{font-size:0.55rem;text-transform:uppercase;letter-spacing:0.2em;color:#F59A4B;font-weight:700}
.chapter-title{font-size:1.2rem;font-family:'Lora',serif;font-weight:700;margin-top:0.3rem}
.chapter-subtitle{font-size:0.75rem;opacity:0.5;margin-top:0.3rem}
.progress-bar{height:8px;background:#f0ece6;border-radius:4px;overflow:hidden;margin:0.5rem 0}
.progress-fill{height:100%;background:linear-gradient(90deg,#C4491C,#F59A4B);border-radius:4px}
.stat{text-align:center;padding:0.75rem}
.stat-value{font-size:1.75rem;font-weight:700;font-family:'Lora',serif;line-height:1.1}
.stat-label{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.12em;opacity:0.45;font-weight:700;margin-top:0.35rem}
.metric-row{display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid rgba(30,26,20,0.05)}
.metric-row:last-child{border-bottom:none}
.metric-label{font-size:0.8rem;color:#6b7280}
.metric-value{font-weight:600;font-family:'Lora',serif;color:#1D1813}
.severity-critical{background:#E8D5D3;color:#8B4F4A;padding:0.4rem 0.75rem;border-radius:0.5rem;margin:0.3rem 0;font-weight:500;font-size:0.85rem;border-left:4px solid #A0645E}
.severity-warning{background:#EDE5D6;color:#7A6540;padding:0.4rem 0.75rem;border-radius:0.5rem;margin:0.3rem 0;font-weight:500;font-size:0.85rem;border-left:4px solid #B8943D}
.severity-ok{background:#DFEADC;color:#4E6E4A;padding:0.4rem 0.75rem;border-radius:0.5rem;margin:0.3rem 0;font-weight:500;font-size:0.85rem;border-left:4px solid #6B8F64}
.severity-info{background:#E0E5EA;color:#506070;padding:0.4rem 0.75rem;border-radius:0.5rem;margin:0.3rem 0;font-weight:500;font-size:0.85rem;border-left:4px solid #7A8E9E}
.severity-bar{height:6px;border-radius:3px;margin:0.4rem 0 0.75rem;overflow:hidden;background:#EEEBE6}
.severity-bar-fill{height:100%;border-radius:3px}
.severity-bar-fill.critical{background:linear-gradient(90deg,#C08A85,#A0645E)}
.severity-bar-fill.warning{background:linear-gradient(90deg,#D4BF8A,#B8943D)}
.severity-bar-fill.ok{background:linear-gradient(90deg,#9AB896,#6B8F64)}
.footer{margin-top:3rem;padding-top:1.5rem;border-top:2px solid rgba(30,26,20,0.06);text-align:center;font-size:0.7rem;color:#9ca3af}
.footer strong{color:#8F3210}
.report-actions{position:fixed;top:1rem;left:1rem;display:flex;gap:0.5rem;z-index:10}
.back-btn,.pdf-btn{background:#1D1813;color:#F5F0E8;border:none;border-radius:0.75rem;padding:0.5rem 1rem;font-size:0.8rem;cursor:pointer;font-family:'Inter',sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:background 0.2s}
.back-btn:hover,.pdf-btn:hover{background:#28201A}
.pdf-btn{background:#C4491C}
.pdf-btn:hover{background:#8F3210}
@media print{
body{background:white}
body::before{display:none}
.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{padding:1rem}
.report-actions{display:none}
.section-card{box-shadow:none;border:1px solid rgba(30,26,20,0.1)}
}
@media(max-width:640px){
.grid-2,.grid-3{grid-template-columns:1fr}
.big-number{font-size:1.8rem}
.header h1{font-size:1.3rem}
.header{padding:1.5rem}
.page{padding:1rem 0.75rem}
.section-card{padding:1rem 1.25rem}
table{font-size:0.75rem;display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
th{padding:0.5rem 0.6rem;font-size:0.55rem;white-space:nowrap}
td{padding:0.5rem 0.6rem;white-space:nowrap}
.card,.card-accent,.card-dark{padding:1rem}
.chapter{padding:1rem 1.25rem}
.chapter-title{font-size:1.05rem}
.stat-value{font-size:1.3rem}
}
</style>
</head>
<body>
<div class="report-actions">
<button class="back-btn" onclick="history.back()" target="_self">← Retour</button>
<button class="pdf-btn" onclick="window.print()" target="_self">📥 Télécharger PDF</button>
</div>
<div class="page">
<div class="header">
<div class="logo">Arty — Rapport</div>
<h1>${title}</h1>
<div class="meta">Généré le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} • Arty</div>
</div>
<div class="content">
${content}
</div>
<footer class="footer">
<strong>Arty</strong> — Assistant IA personnel · Généré par Arty · ${new Date().toLocaleDateString('fr-FR')}
</footer>
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
