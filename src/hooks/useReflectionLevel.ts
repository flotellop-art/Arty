import { useEffect, useState } from 'react'
import { getReflectionLevel, type ReflectionLevel } from '../services/reflectionLevel'

/**
 * État React synchronisé sur le niveau de réflexion choisi (réglage global).
 *
 * Même pattern que useSelectedModel : lit le storage au mount puis écoute
 * 'reflection-level-changed' (dispatché par setReflectionLevel) pour que toutes
 * les vues qui l'affichent (la barre du chat + le sheet « ⋯ ») restent
 * alignées sans relire le storage. Pour changer la valeur, appeler
 * setReflectionLevel() — jamais le re-set depuis le listener (boucle).
 */
export function useReflectionLevel(): ReflectionLevel {
  const [level, setLevel] = useState<ReflectionLevel>(getReflectionLevel)

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ReflectionLevel>).detail
      setLevel(detail ?? getReflectionLevel())
    }
    window.addEventListener('reflection-level-changed', onChange)
    return () => window.removeEventListener('reflection-level-changed', onChange)
  }, [])

  return level
}
