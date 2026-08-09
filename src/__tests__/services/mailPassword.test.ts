import { describe, it, expect } from 'vitest'
import { normalizeMailPassword, mailPasswordCandidates } from '../../services/mailPassword'

// BUG 66 : les mots de passe d'application Google sont affichés en 4 groupes
// de 4 séparés par des espaces (parfois insécables) ; Gmail ne strippe pas
// ces espaces côté serveur. La normalisation doit les retirer — sans jamais
// toucher un mot de passe IMAP légitime contenant des espaces.

const GMAIL = 'imap.gmail.com'
const YAHOO = 'imap.mail.yahoo.com'
const GENERIC = 'imap.exemple.fr'

describe('normalizeMailPassword — règle host (serveurs app-password only)', () => {
  it('strippe les espaces du format Google 4×4 sur imap.gmail.com', () => {
    expect(normalizeMailPassword('abcd efgh ijkl mnop', GMAIL)).toBe('abcdefghijklmnop')
  })

  it('strippe les NBSP (U+00A0) collés depuis le rendu Google', () => {
    expect(normalizeMailPassword('abcd efgh ijkl mnop', GMAIL)).toBe('abcdefghijklmnop')
  })

  it('strippe les espaces fines insécables (U+202F)', () => {
    expect(normalizeMailPassword('abcd efgh ijkl mnop', GMAIL)).toBe('abcdefghijklmnop')
  })

  it("strippe l'espace final ajouté par le clavier après un collage", () => {
    expect(normalizeMailPassword('abcdefghijklmnop ', GMAIL)).toBe('abcdefghijklmnop')
  })

  it('couvre le collage partiel (un espace sur trois effacé)', () => {
    expect(normalizeMailPassword('abcd efgh ijklmnop', GMAIL)).toBe('abcdefghijklmnop')
  })

  it('gère un host en majuscules ou avec blancs parasites', () => {
    expect(normalizeMailPassword('abcd efgh ijkl mnop', ' IMAP.GMAIL.COM ')).toBe('abcdefghijklmnop')
  })

  it('couvre Yahoo, variantes régionales incluses', () => {
    expect(normalizeMailPassword('abcd efgh ijkl mnop', YAHOO)).toBe('abcdefghijklmnop')
    expect(normalizeMailPassword('abcd efgh ijkl mnop', 'imap.mail.yahoo.co.jp')).toBe('abcdefghijklmnop')
  })

  it('est un no-op sur un mot de passe Gmail déjà saisi sans espaces', () => {
    expect(normalizeMailPassword('abcdefghijklmnop', GMAIL)).toBe('abcdefghijklmnop')
  })
})

describe('normalizeMailPassword — règle de forme (host quelconque)', () => {
  it("strippe la forme canonique 4×4 même sur un host custom pointé sur Gmail via le preset IMAP", () => {
    expect(normalizeMailPassword('abcd efgh ijkl mnop', GENERIC)).toBe('abcdefghijklmnop')
  })
})

describe('normalizeMailPassword — mots de passe à ne PAS toucher', () => {
  it('préserve les espaces internes d\'un mot de passe générique (RFC 3501)', () => {
    // Ne matche pas la forme 4×4 (groupes de tailles différentes).
    expect(normalizeMailPassword('mon mot de passe2', GENERIC)).toBe('mon mot de passe2')
  })

  it('préserve les caractères spéciaux', () => {
    expect(normalizeMailPassword('p@ss w0rd!', GENERIC)).toBe('p@ss w0rd!')
  })

  it('préserve les tirets iCloud (xxxx-xxxx-xxxx-xxxx)', () => {
    expect(normalizeMailPassword('abcd-efgh-ijkl-mnop', 'imap.mail.me.com')).toBe('abcd-efgh-ijkl-mnop')
  })

  it('trime seulement les extrémités sur un host générique', () => {
    expect(normalizeMailPassword('  secret interne  ', GENERIC)).toBe('secret interne')
  })

  it('réduit un mot de passe tout blanc à une chaîne vide (bloquée en amont par la modal)', () => {
    expect(normalizeMailPassword('   ', GENERIC)).toBe('')
  })
})

describe('normalizeMailPassword — faux positif assumé de la règle de forme', () => {
  it('strippe une phrase de passe 4×4 minuscules sur host générique — couvert par le retry brut', () => {
    // Comportement DOCUMENTÉ, pas un oubli : une phrase de passe de quatre
    // mots de quatre lettres minuscules matche la forme canonique Google.
    // Le filet mailPasswordCandidates garde le brut en 2e candidat, donc la
    // connexion réussit quand même (au prix d'une tentative supplémentaire).
    expect(normalizeMailPassword('jour nuit pain vent', GENERIC)).toBe('journuitpainvent')
    expect(mailPasswordCandidates('jour nuit pain vent', GENERIC)).toEqual([
      'journuitpainvent',
      'jour nuit pain vent',
    ])
  })
})

describe('mailPasswordCandidates', () => {
  it('renvoie un seul candidat quand la normalisation est un no-op', () => {
    expect(mailPasswordCandidates('abcdefghijklmnop', GMAIL)).toEqual(['abcdefghijklmnop'])
  })

  it('renvoie [normalisé, brut] quand la normalisation a changé quelque chose', () => {
    expect(mailPasswordCandidates('abcd efgh ijkl mnop', GMAIL)).toEqual([
      'abcdefghijklmnop',
      'abcd efgh ijkl mnop',
    ])
  })
})
