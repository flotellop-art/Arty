import { useEffect, useState } from 'react'
import { getSelectedModel, type AIModel } from '../services/modelSelector'

/**
 * État React synchronisé sur le modèle IA sélectionné.
 *
 * Lit le storage au mount puis écoute 'model-changed' (dispatché par
 * setSelectedModel) : toutes les vues qui affichent le modèle (TopBar
 * Home, ChatTopBar, futur sheet « ⋯ ») restent alignées sans relire le
 * storage — y compris entre routes (changer le modèle dans le chat se
 * reflète au retour Home) et si plusieurs vues sont montées en même
 * temps (sidebar desktop persistante à venir).
 *
 * Le hook ne fait que refléter la valeur : pour la changer, appeler
 * setSelectedModel() (qui dispatche l'événement). Ne jamais re-appeler
 * setSelectedModel depuis le listener — boucle de dispatch.
 */
export function useSelectedModel(): AIModel {
  const [model, setModel] = useState<AIModel>(getSelectedModel)

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<AIModel>).detail
      if (detail) setModel(detail)
    }
    window.addEventListener('model-changed', onChange)
    return () => window.removeEventListener('model-changed', onChange)
  }, [])

  return model
}
