// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('privacy and Play submission claims', () => {
  const privacyCopies = [
    'PRIVACY.md',
    'PRIVACY-EN.md',
    'public/privacy/index.html',
    'public/privacy/en/index.html',
  ].map(read)

  it('ne promet jamais une clé secrète propre à l’appareil', () => {
    for (const policy of privacyCopies) {
      expect(policy).not.toMatch(/ne quitte jamais votre appareil|never leaves your device/i)
      expect(policy).not.toMatch(/clés API personnelles \(BYOK\) sont chiffrées|personal API keys \(BYOK\) are encrypted/i)
    }
  })

  it('documente la limite de la clé non-BYOK dans chaque copie publique', () => {
    expect(privacyCopies[0]).toContain("la clé n'est ni secrète ni liée au matériel")
    expect(privacyCopies[1]).toContain('the key is neither secret nor hardware-bound')
    expect(privacyCopies[2]).toContain("la clé n'est ni secrète ni liée au matériel")
    expect(privacyCopies[3]).toContain('the key is neither secret nor hardware-bound')
  })

  it("ne fabrique pas de champ 'chiffrement au repos' dans la matrice Data Safety", () => {
    const submission = `${read('BEFORE-PUBLISHING.md')}\n${read('PLAY-STORE-SUBMISSION.md')}`
    expect(submission).not.toMatch(/Chiffrement au repos\s*:\s*OUI/i)
    expect(submission).toContain("ne demande pas de déclaration « chiffrement au repos »")
  })

  // Audit du 9 août 2026 : les copies HTML avaient été mises à jour à
  // l'immatriculation (mi-juillet) mais pas les copies Markdown, qui
  // annonçaient encore une personne physique non immatriculée, à une autre
  // adresse et avec un autre contact. Une PR ultérieure a rafraîchi la date de
  // « Dernière mise à jour » sans corriger le fond — donnant l'illusion d'un
  // texte relu. L'identité du responsable de traitement est une mention
  // obligatoire (RGPD art. 13) : elle doit être identique dans les 4 copies.
  describe('identité du responsable de traitement', () => {
    const legalNotice = read('public/legal-notice/index.html')

    it('les mentions légales restent la source de vérité', () => {
      expect(legalNotice).toContain('887 679 611')
      expect(legalNotice).toContain('support@tryarty.com')
    })

    it('les 4 copies portent la même immatriculation et le même contact', () => {
      for (const policy of privacyCopies) {
        expect(policy).toContain('887 679 611')
        expect(policy).toContain('support@tryarty.com')
      }
    })

    it('aucune copie ne conserve l’identité périmée', () => {
      for (const policy of privacyCopies) {
        expect(policy).not.toMatch(/884 chemin de la Prairie|38270 Beaufort/i)
        expect(policy).not.toMatch(/flotellop@gmail\.com/i)
        expect(policy).not.toMatch(/Aucune entreprise n'est immatriculée|No business is registered/i)
      }
    })

    it('informe du droit de réclamation auprès de l’autorité locale, en FR comme en EN', () => {
      // La version anglaise citait l'autorité du pays de résidence (RGPD
      // art. 77), la française s'arrêtait à la CNIL : un droit annoncé dans une
      // langue et tu dans l'autre.
      expect(privacyCopies[0]).toMatch(/autorité de contrôle de votre pays de résidence/i)
      expect(privacyCopies[2]).toMatch(/autorité de contrôle de votre pays de résidence/i)
      expect(privacyCopies[1]).toMatch(/supervisory authority of your EU country of residence/i)
      expect(privacyCopies[3]).toMatch(/supervisory authority of your EU country of residence/i)
    })
  })

  // Audit du 9 août 2026 : le dossier Play affirmait encore à Google qu'Arty
  // n'accède pas à la boîte mail de l'utilisateur, alors que l'app Android
  // propose depuis le même jour un bouton « Gmail » qui connecte une boîte en
  // IMAP. Un évaluateur croise ce texte avec la politique de confidentialité
  // publique : une contradiction s'y lit comme une dissimulation.
  describe('dossier Play Store vs accès mail IMAP réellement livré', () => {
    const submission = read('PLAY-STORE-SUBMISSION.md')

    it('ne nie plus l’accès à la boîte mail', () => {
      expect(submission).not.toMatch(/Arty does not access the user's Gmail mailbox/i)
      expect(submission).not.toMatch(
        /Il n'expose aucun outil permettant de chercher, ouvrir, envoyer, modifier ou\s+supprimer un message/i
      )
    })

    it('distingue « aucun scope Gmail » de « aucun accès à la boîte »', () => {
      expect(submission).toMatch(/ne demande \*\*aucun scope Gmail\*\*/i)
      expect(submission).toMatch(/client IMAP natif/i)
      expect(submission).toMatch(/oui, si l'utilisateur la connecte/i)
    })

    it('déclare la catégorie Data Safety des e-mails', () => {
      expect(submission).toMatch(/Messages → E-mails/)
      expect(submission).toMatch(/\*Collectées\* : \*\*OUI\*\*/)
      expect(submission).toMatch(/\*Partagées\* : \*\*OUI\*\*/)
    })

    it('déclare le canal IMAPS, que « HTTPS uniquement » ne couvrait pas', () => {
      expect(submission).toMatch(/IMAPS\/TLS/)
      expect(submission).not.toMatch(/Chiffrement en transit\s*\*\*?\s*:\s*OUI \(HTTPS uniquement\)/i)
    })

    it('la checklist de publication ne coche plus une affirmation devenue fausse', () => {
      const checklist = read('BEFORE-PUBLISHING.md')
      expect(checklist).not.toMatch(/- \[x\][^\n]*n'expose aucun outil de lecture\/envoi Gmail/i)
      expect(checklist).toMatch(/- \[ \][^\n]*client IMAP natif/i)
    })
  })

  // Le consentement se donne au moment où l'utilisateur tape son mot de passe
  // d'application, pas dans un document séparé qu'il n'ouvrira pas.
  it('avertit dans l’écran de connexion d’une boîte que le contenu part chez le fournisseur d’IA', () => {
    const fr = JSON.parse(read('src/i18n/locales/fr.json'))
    const en = JSON.parse(read('src/i18n/locales/en.json'))
    expect(fr.mailAccountsModal.securityNote).toMatch(/Anthropic/)
    expect(en.mailAccountsModal.securityNote).toMatch(/Anthropic/)
    // La divulgation doit être ACCEPTÉE, pas seulement affichée (exigence Play
    // sur les intégrations d'IA tierces, annonce du 15 juillet 2026).
    expect(fr.mailAccountsModal.consentLabel).toMatch(/Anthropic/)
    expect(en.mailAccountsModal.consentLabel).toMatch(/Anthropic/)
  })

  // Le consentement se donne devant l'écran : si une refonte d'interface
  // supprime la case ou débranche le bouton, la CI doit le voir. Contrôle de
  // source volontairement grossier — il garde la FORME de la garantie, pas son
  // rendu, que seul un test de composant couvrirait.
  it('le bouton d’ajout d’une boîte reste conditionné à l’accord explicite', () => {
    const modal = read('src/components/settings/MailAccountsModal.tsx')
    expect(modal).toMatch(/disabled=\{submitting \|\| !consented\}/)
    expect(modal).toMatch(/if \(!consented\)/)
    expect(modal).toMatch(/mailAccountsModal\.consentLabel/)
  })
})
