import { describe, it, expect } from 'vitest'
import {
  addTag,
  removeTag,
  normalizeCustomTag,
  resolveTag,
  MAX_TAGS_PER_CONVERSATION,
  MAX_CUSTOM_TAG_LENGTH,
} from '../../services/conversationTags'

// P1.8 version SÛRE — garde-fous contre les pièges du texte libre relevés à
// l'audit (doublons casse, longueur, plafond).
const t = (k: string) => k // i18n stub : renvoie la clé

describe('conversationTags', () => {
  it('addTag dédublonne sans tenir compte de la casse', () => {
    expect(addTag(['Travail'], 'travail')).toEqual(['Travail'])
    expect(addTag(['work'], 'WORK')).toEqual(['work'])
  })

  it('addTag respecte le plafond', () => {
    const full = Array.from({ length: MAX_TAGS_PER_CONVERSATION }, (_, i) => `t${i}`)
    expect(addTag(full, 'nouveau')).toEqual(full) // refusé, liste inchangée
    expect(addTag(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('removeTag est insensible à la casse', () => {
    expect(removeTag(['Travail', 'perso'], 'TRAVAIL')).toEqual(['perso'])
  })

  it('normalizeCustomTag trim + borne la longueur, null si vide', () => {
    expect(normalizeCustomTag('  ')).toBeNull()
    expect(normalizeCustomTag('  hello  ')).toBe('hello')
    expect((normalizeCustomTag('x'.repeat(50)) ?? '').length).toBeLessThanOrEqual(MAX_CUSTOM_TAG_LENGTH)
  })

  it('resolveTag : prédéfini → libellé i18n + couleur ; perso → texte brut', () => {
    const work = resolveTag('work', t)
    expect(work.predefined).toBe(true)
    expect(work.label).toBe('tags.predefined.work')
    expect(work.color).toMatch(/^#/)

    const custom = resolveTag('Garage', t)
    expect(custom.predefined).toBe(false)
    expect(custom.label).toBe('Garage')
  })
})
