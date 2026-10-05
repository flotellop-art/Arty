import { ARTY_PROMPT, captureActivePost, makeTextExport } from './reader.mjs';

const readButton = document.getElementById('read');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
let snapshot = null;
let operation = 0;

document.getElementById('prompt').value = ARTY_PROMPT;
readButton.addEventListener('click', async () => {
  const currentOperation = ++operation;
  snapshot = null;
  preview.hidden = true;
  readButton.disabled = true;
  status.textContent = 'Lecture du titre et du texte…';
  let timeout;
  try {
    const result = await Promise.race([
      captureActivePost(chrome),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 10000); }),
    ]);
    if (operation !== currentOperation) return;
    snapshot = result;
    document.getElementById('title').textContent = result.title;
    document.getElementById('source').textContent = result.url;
    document.getElementById('body').textContent = result.body;
    document.getElementById('saved').textContent = '';
    preview.hidden = false;
    status.textContent = `${result.body.length.toLocaleString('fr-FR')} caractères récupérés. Vérifiez le texte ci-dessous.`;
  } catch (error) {
    const messages = {
      wrong_page: 'Ouvrez une publication sur reddit.com. L’onglet doit rester sur le même post pendant la lecture.',
      loading: 'La page charge encore. Attendez qu’elle affiche le post, puis relancez la lecture.',
      missing_post: 'Le texte du post n’est pas affiché. Ouvrez-le normalement dans le navigateur avant de le lire.',
      too_large: 'Le post dépasse la taille prise en charge (100 000 caractères). Aucun fichier tronqué n’a été créé.',
      timeout: 'La lecture a pris trop de temps. Vous pouvez réessayer après avoir vérifié la page.',
    };
    status.textContent = messages[error.message] || 'Lecture impossible dans cet onglet. Ouvrez le post dans Chrome ou Edge, puis cliquez à nouveau sur l’extension.';
  } finally {
    clearTimeout(timeout);
    if (operation === currentOperation) readButton.disabled = false;
  }
});

saveButton.addEventListener('click', () => {
  if (!snapshot) return;
  const file = makeTextExport(snapshot);
  const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  document.getElementById('saved').textContent = `Téléchargement demandé : ${file.filename}. Vérifiez les téléchargements du navigateur.`;
});
