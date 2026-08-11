// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script Node en .mjs, sans typage TS (hors périmètre tsc).
import { quotedStrings } from '../../../scripts/lib/quotedStrings.mjs'

// Ce régex est le socle du garde-fou « sans CASA » (RÈGLE 8). Le 9 août 2026,
// une seule modification — ajouter les accents graves à l'alternation des
// guillemets — a rendu le scanner AVEUGLE au scope Calendar du bundle Android
// synchronisé : sur un fichier minifié, un accent grave rencontré tôt ouvrait
// une correspondance qui avalait tout le reste. Le scanner disait « OK » sur
// les scopes restreints pour la pire des raisons : il ne voyait plus rien.
// Seule la CI l'a vu. Ces tests rendent la propriété vérifiable en local.

const extract = quotedStrings as (source: string) => string[]

describe('quotedStrings — extraction des littéraux', () => {
  it('extrait les trois familles de délimiteurs', () => {
    const out = extract(`const a = 'simple'\nconst b = "double"\nconst c = \`gabarit\``)
    expect(out).toContain('simple')
    expect(out).toContain('double')
    expect(out).toContain('gabarit')
  })

  // Le cœur de la régression : un accent grave placé AVANT ne doit plus
  // empêcher la lecture des littéraux qui suivent.
  it('un accent grave antérieur ne masque pas les littéraux suivants', () => {
    const out = extract("const tpl = `x`; const scope = 'https://www.googleapis.com/auth/calendar.events.owned'")
    expect(out).toContain('https://www.googleapis.com/auth/calendar.events.owned')
  })

  // LE cas qui a cassé la CI, et la seule forme qui reproduit vraiment la
  // panne : une PAIRE d'accents graves qui enjambe un retour à la ligne, avec
  // le scope entre les deux. Sans borne de ligne, cette paire forme une
  // correspondance unique qui engloutit le littéral et le rend invisible.
  // (Une paire sur une seule ligne, ou un accent grave isolé, ne suffit pas à
  // déclencher le défaut — mes premiers tests passaient pour cette raison.)
  it('un couple d’accents graves enjambant une ligne n’engloutit pas le scope situé entre eux', () => {
    const source = [
      'const tpl = `début de gabarit',
      `  const scope = 'https://www.googleapis.com/auth/calendar.events.owned'`,
      'fin de gabarit`',
    ].join('\n')
    expect(extract(source)).toContain('https://www.googleapis.com/auth/calendar.events.owned')
  })

  // Propriété distincte de la précédente : un délimiteur ORPHELIN ne doit pas
  // aveugler la suite du fichier. Ce cas ne reproduit PAS la panne de la CI
  // (sans partenaire, l'accent grave ne forme aucune correspondance, même
  // avec le régex fautif) — il garde la borne de ligne contre une autre
  // famille de dérive. Écrit ici pour que personne ne le prenne à tort pour
  // le test de non-régression : celui-ci est juste au-dessus.
  it('un accent grave non refermé ne fait pas courir la correspondance sur tout le fichier', () => {
    const source = ['const oups = `jamais refermé', "const scope = 'auth/gmail.readonly'"].join('\n')
    expect(extract(source)).toContain('auth/gmail.readonly')
  })

  // La raison d'être de la passe accents graves : sans elle, un scope écrit
  // en littéral gabarit traversait le scanner sans un mot.
  it('voit un scope restreint écrit en littéral gabarit', () => {
    const out = extract('export const s = `https://www.googleapis.com/auth/gmail.readonly`')
    expect(out).toContain('https://www.googleapis.com/auth/gmail.readonly')
  })

  it('reste sûr sur une source vide ou sans littéral', () => {
    expect(extract('')).toEqual([])
    expect(extract('const x = 42')).toEqual([])
  })
})
