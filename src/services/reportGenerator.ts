const REPORT_STORAGE_KEY = 'fp-report-'

const REPORT_TEMPLATE = (title: string, content: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Façades Pollet</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Lora:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;font-weight:300;background:#F5F0E8;color:#1E1A14;line-height:1.6}
.page{max-width:800px;margin:0 auto;padding:2rem 1.5rem}
.header{background:linear-gradient(145deg,#1E1A14,#2a2520);color:#F5F0E8;border-radius:1.5rem;padding:2.5rem;margin-bottom:2rem;position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:0;left:0;width:6px;height:100%;background:linear-gradient(180deg,#E05510,#f59e0b);border-radius:3px}
.header::after{content:'';position:absolute;top:-50%;right:-10%;width:300px;height:300px;background:radial-gradient(circle,rgba(224,85,16,0.1),transparent 70%);border-radius:50%}
.header h1{font-family:'Lora',serif;font-size:1.8rem;font-weight:700;margin-bottom:0.5rem}
.header .meta{font-size:0.8rem;opacity:0.6}
.header .logo{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.2em;color:#E05510;font-weight:700;margin-bottom:0.75rem}
.content{font-size:0.9rem}
h2{font-family:'Lora',serif;font-size:1.3rem;color:#1E1A14;margin:2rem 0 1rem;padding-bottom:0.5rem;border-bottom:2px solid rgba(224,85,16,0.2)}
h3{font-family:'Lora',serif;font-size:1.05rem;color:#E05510;margin:1.5rem 0 0.75rem}
p{margin:0.75rem 0}
strong{font-weight:600;color:#1E1A14}
em{color:#E05510;font-style:normal;font-weight:500}
a{color:#E05510}
table{width:100%;border-collapse:collapse;margin:1rem 0;border-radius:0.75rem;overflow:hidden;box-shadow:0 2px 8px rgba(30,26,20,0.06)}
thead{background:#1E1A14;color:#F5F0E8}
th{padding:0.7rem 1rem;text-align:left;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.08em;font-weight:600}
td{padding:0.7rem 1rem;border-bottom:1px solid rgba(30,26,20,0.06)}
tr:hover{background:rgba(224,85,16,0.03)}
blockquote{background:linear-gradient(135deg,#F5F0E8,#ece7df);border-left:4px solid #E05510;border-radius:0 1rem 1rem 0;padding:1.25rem 1.5rem;margin:1.25rem 0;font-family:'Lora',serif;font-style:italic}
ul,ol{margin:0.75rem 0;padding-left:0;list-style:none}
li{display:flex;gap:0.5rem;margin:0.4rem 0}
li::before{content:'●';color:#E05510;font-size:0.5rem;margin-top:0.55rem;flex-shrink:0}
hr{border:none;height:1px;background:linear-gradient(to right,transparent,rgba(30,26,20,0.15),transparent);margin:2rem 0}
.card{background:white;border:1px solid rgba(30,26,20,0.06);border-radius:1rem;padding:1.25rem;margin:0.75rem 0;box-shadow:0 2px 8px rgba(30,26,20,0.04)}
.card-accent{background:linear-gradient(135deg,#E05510,#c44a0e);color:#F5F0E8;border-radius:1rem;padding:1.5rem;margin:0.75rem 0;box-shadow:0 4px 16px rgba(224,85,16,0.3);position:relative;overflow:hidden}
.card-accent::before{content:'';position:absolute;top:0;right:0;width:120px;height:120px;background:radial-gradient(circle,rgba(255,255,255,0.1),transparent 70%);border-radius:50%;transform:translate(30%,-30%)}
.card-dark{background:linear-gradient(145deg,#1E1A14,#2a2520);color:#F5F0E8;border-radius:1rem;padding:1.5rem;margin:0.75rem 0;position:relative}
.card-dark::after{content:'';position:absolute;bottom:0;left:0;width:100%;height:3px;background:linear-gradient(90deg,#E05510,transparent)}
.big-number{font-size:2.5rem;font-weight:700;font-family:'Lora',serif;color:#E05510;line-height:1}
.card-accent .big-number,.card-dark .big-number{color:#F5F0E8}
.medium-number{font-size:1.5rem;font-weight:700;font-family:'Lora',serif}
.subtitle{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.15em;opacity:0.45;font-weight:700;margin-bottom:0.35rem}
.caption{font-size:0.7rem;color:#9ca3af;margin-top:0.35rem}
.badge{display:inline-block;padding:0.2rem 0.65rem;border-radius:2rem;font-size:0.6rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase}
.badge-green{background:#dcfce7;color:#15803d}
.badge-red{background:#fee2e2;color:#b91c1c}
.badge-orange{background:#ffedd5;color:#c2410c}
.badge-blue{background:#dbeafe;color:#1d4ed8}
.badge-accent{background:#E05510;color:#F5F0E8}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem}
.text-center{text-align:center}
.divider{height:1px;background:linear-gradient(to right,transparent,rgba(30,26,20,0.1),transparent);margin:1.25rem 0}
.divider-accent{height:3px;background:linear-gradient(90deg,#E05510,#f59e0b,transparent);border-radius:2px;margin:1.25rem 0}
.alert{border-radius:0.75rem;padding:1rem 1.25rem;margin:0.75rem 0}
.alert-info{background:linear-gradient(135deg,#eff6ff,#dbeafe);border-left:4px solid #3b82f6}
.alert-success{background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-left:4px solid #22c55e}
.alert-warning{background:linear-gradient(135deg,#fffbeb,#fef3c7);border-left:4px solid #f59e0b}
.alert-danger{background:linear-gradient(135deg,#fef2f2,#fee2e2);border-left:4px solid #ef4444}
.chapter{background:linear-gradient(145deg,#1E1A14,#2a2520);color:#F5F0E8;border-radius:1rem;padding:1.5rem 1.75rem;margin:2rem 0 1rem;position:relative;overflow:hidden}
.chapter::before{content:'';position:absolute;top:0;left:0;width:4px;height:100%;background:linear-gradient(180deg,#E05510,#f59e0b)}
.chapter-number{font-size:0.55rem;text-transform:uppercase;letter-spacing:0.2em;color:#E05510;font-weight:700}
.chapter-title{font-size:1.2rem;font-family:'Lora',serif;font-weight:700;margin-top:0.3rem}
.chapter-subtitle{font-size:0.75rem;opacity:0.5;margin-top:0.3rem}
.progress-bar{height:8px;background:#f0ece6;border-radius:4px;overflow:hidden;margin:0.5rem 0}
.progress-fill{height:100%;background:linear-gradient(90deg,#E05510,#f59e0b);border-radius:4px}
.stat{text-align:center;padding:0.75rem}
.stat-value{font-size:1.75rem;font-weight:700;font-family:'Lora',serif;line-height:1.1}
.stat-label{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.12em;opacity:0.45;font-weight:700;margin-top:0.35rem}
.metric-row{display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid rgba(30,26,20,0.05)}
.metric-row:last-child{border-bottom:none}
.metric-label{font-size:0.8rem;color:#6b7280}
.metric-value{font-weight:600;font-family:'Lora',serif;color:#1E1A14}
.footer{margin-top:3rem;padding-top:1.5rem;border-top:2px solid rgba(30,26,20,0.06);text-align:center;font-size:0.7rem;color:#9ca3af}
.footer strong{color:#E05510}
.back-btn{position:fixed;top:1rem;left:1rem;background:#1E1A14;color:#F5F0E8;border:none;border-radius:0.75rem;padding:0.5rem 1rem;font-size:0.8rem;cursor:pointer;z-index:10;font-family:'Inter',sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
@media print{body{background:white}.page{padding:1rem}.back-btn{display:none}}
@media(max-width:640px){
.grid-2,.grid-3{grid-template-columns:1fr}
.big-number{font-size:1.8rem}
.header h1{font-size:1.3rem}
.header{padding:1.5rem}
.page{padding:1rem 0.75rem}
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
<button class="back-btn" onclick="history.back()">← Retour</button>
<div class="page">
<div class="header">
<div class="logo">Façades Pollet — Rapport</div>
<h1>${title}</h1>
<div class="meta">Généré le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} • facadespollet.fr</div>
</div>
<div class="content">
${content}
</div>
<div class="footer">
<strong>Façades Pollet</strong> — Artisan façadier, Valence (26)<br>facadespollet.fr
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
