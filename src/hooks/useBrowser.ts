import { useState, useCallback } from 'react'
import type {
  PriceSearchResponse,
  WpPublishRequest,
  WpPublishResponse,
  FormField,
  FormFillResponse,
  ScreenshotResponse,
} from '../types/browser'
import * as browser from '../services/browserClient'

export function useBrowser() {
  const [isLoading, setIsLoading] = useState(false)
  const [currentAction, setCurrentAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const publishWP = useCallback(async (data: WpPublishRequest): Promise<WpPublishResponse | null> => {
    setIsLoading(true)
    setCurrentAction('Publication WordPress en cours...')
    setError(null)
    try {
      const result = await browser.publishWordPress(data)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur publication')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const searchPrices = useCallback(async (query: string): Promise<PriceSearchResponse | null> => {
    setIsLoading(true)
    setCurrentAction(`Recherche prix "${query}" chez les fournisseurs...`)
    setError(null)
    try {
      const result = await browser.searchPrices(query)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur recherche')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const fillForm = useCallback(
    async (url: string, fields: FormField[], submit?: boolean): Promise<FormFillResponse | null> => {
      setIsLoading(true)
      setCurrentAction(`Remplissage formulaire sur ${new URL(url).hostname}...`)
      setError(null)
      try {
        const result = await browser.fillForm(url, fields, submit)
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur formulaire')
        return null
      } finally {
        setIsLoading(false)
        setCurrentAction(null)
      }
    },
    []
  )

  const screenshot = useCallback(async (url: string): Promise<ScreenshotResponse | null> => {
    setIsLoading(true)
    setCurrentAction(`Capture de ${new URL(url).hostname}...`)
    setError(null)
    try {
      const result = await browser.takeScreenshot(url)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur capture')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  return {
    isLoading,
    currentAction,
    error,
    publishWP,
    searchPrices,
    fillForm,
    screenshot,
  }
}
