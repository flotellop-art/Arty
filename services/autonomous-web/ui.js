const form = document.getElementById('form'), query = document.getElementById('query');
const status = document.getElementById('status'), results = document.getElementById('results');
const documentText = document.getElementById('document'), receipt = document.getElementById('receipt');
let operation;
async function call(path, body, signal) {
  const response = await fetch('/local/' + path, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error(response.status === 404 ? 'Page absente ou expirée dans notre index.' : 'Index indisponible.');
  return response.json();
}
form.addEventListener('submit', async event => {
  event.preventDefault(); operation?.abort(); operation = new AbortController(); const current = operation;
  results.replaceChildren(); documentText.hidden = true; receipt.textContent = ''; status.textContent = 'Recherche dans notre index…';
  try {
    const data = await call('search', {query: query.value.trim(), maxResults: 5}, current.signal);
    status.textContent = `${data.results.length} résultat(s) • ${data.coverage.documents} pages disponibles • ${data.coverage.domains.join(', ') || 'corpus vide'}`;
    if (!data.results.length) status.textContent += ' — essayez des mots-clés présents dans les pages collectées.';
    for (const result of data.results) {
      const card = document.createElement('article'), title = document.createElement('h2'), url = document.createElement('a'), excerpt = document.createElement('p'), date = document.createElement('p'), read = document.createElement('button');
      title.textContent = result.title; url.textContent = result.url; url.href = result.url; url.target = '_blank'; url.rel = 'noopener noreferrer'; excerpt.textContent = result.snippet;
      date.textContent = 'Collecté le ' + new Date(result.retrievedAt).toLocaleString('fr-FR'); read.textContent = 'Lire la copie enregistrée';
      read.addEventListener('click', async () => {
        read.disabled = true;
        try {
          const page = await call('fetch', {url: result.url}, current.signal);
          documentText.textContent = page.markdown; documentText.hidden = false;
          receipt.textContent = `${page.receipt.finalUrl} • HTML statique • collecte ${new Date(page.receipt.retrievedAt).toLocaleString('fr-FR')} • SHA-256 ${page.receipt.sha256}`;
          receipt.scrollIntoView({behavior:'smooth', block:'start'});
        } catch (e) { if (e.name !== 'AbortError') status.textContent = e.message; }
        finally { read.disabled = false; }
      });
      card.append(title, url, excerpt, date, read); results.append(card);
    }
  } catch (e) { if (e.name !== 'AbortError') status.textContent = e.message; }
});
