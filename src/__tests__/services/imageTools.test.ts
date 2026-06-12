// P1.3 — détection d'intention image : le point le plus sensible (un faux
// positif brûle le cap de l'utilisateur). Le pattern doit être STRICT.
import { describe, it, expect } from 'vitest'
import { wantsImageGeneration } from '../../services/tools/imageTools'

describe('wantsImageGeneration — déclenchement strict', () => {
  it('déclenche sur une demande de création explicite', () => {
    expect(wantsImageGeneration('génère une image de chat')).toBe(true)
    expect(wantsImageGeneration('crée-moi un logo pour ma boîte')).toBe(true)
    expect(wantsImageGeneration('dessine une illustration de montagne')).toBe(true)
    expect(wantsImageGeneration('fais-moi une affiche pour mon concert')).toBe(true)
    expect(wantsImageGeneration('generate an image of a sunset')).toBe(true)
    expect(wantsImageGeneration('create a logo for my startup')).toBe(true)
  })

  it('NE déclenche PAS sur une demande descriptive (faux positif coûteux)', () => {
    expect(wantsImageGeneration("décris-moi une image de chat")).toBe(false)
    expect(wantsImageGeneration('à quoi ressemblerait un logo pour mon projet ?')).toBe(false)
    expect(wantsImageGeneration('explique-moi comment créer une image avec un logiciel')).toBe(false)
    expect(wantsImageGeneration('describe a picture of a dog')).toBe(false)
    expect(wantsImageGeneration('imagine une illustration et raconte-la')).toBe(false)
  })

  it('NE déclenche PAS sans nom visuel', () => {
    expect(wantsImageGeneration('génère un rapport sur les ventes')).toBe(false)
    expect(wantsImageGeneration('crée un fichier texte')).toBe(false)
  })

  it('NE déclenche PAS sans verbe de création', () => {
    expect(wantsImageGeneration('une image de chat')).toBe(false)
    expect(wantsImageGeneration('regarde cette photo')).toBe(false)
  })
})
