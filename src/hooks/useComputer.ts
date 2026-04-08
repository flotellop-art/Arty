import { useState, useCallback } from 'react'
import type { ComputerActionResponse } from '../types/computer'
import * as computer from '../services/computerClient'

export function useComputer() {
  const [isLoading, setIsLoading] = useState(false)
  const [currentAction, setCurrentAction] = useState<string | null>(null)
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleResult = (result: ComputerActionResponse) => {
    if (result.screenshot) {
      setLastScreenshot(result.screenshot)
    }
    if (!result.success && result.error) {
      setError(result.error)
    }
    return result
  }

  const screenshot = useCallback(async () => {
    setIsLoading(true)
    setCurrentAction('Capture écran PC...')
    setError(null)
    try {
      return handleResult(await computer.screenshotPC())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const openApp = useCallback(async (app: string) => {
    setIsLoading(true)
    setCurrentAction(`Ouverture de ${app} sur le PC...`)
    setError(null)
    try {
      return handleResult(await computer.openApp(app))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const click = useCallback(async (x: number, y: number) => {
    setIsLoading(true)
    setCurrentAction(`Clic sur (${x}, ${y})...`)
    setError(null)
    try {
      return handleResult(await computer.clickAt(x, y))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const type = useCallback(async (text: string) => {
    setIsLoading(true)
    setCurrentAction('Saisie de texte...')
    setError(null)
    try {
      return handleResult(await computer.typeOnPC(text))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const scroll = useCallback(async (direction: 'up' | 'down', amount?: number) => {
    setIsLoading(true)
    setCurrentAction(`Défilement ${direction}...`)
    setError(null)
    try {
      return handleResult(await computer.scrollPC(direction, amount))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  const pressKey = useCallback(async (key: string) => {
    setIsLoading(true)
    setCurrentAction(`Touche ${key}...`)
    setError(null)
    try {
      return handleResult(await computer.pressKeyPC(key))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return null
    } finally {
      setIsLoading(false)
      setCurrentAction(null)
    }
  }, [])

  return {
    isLoading,
    currentAction,
    lastScreenshot,
    error,
    screenshot,
    openApp,
    click,
    type,
    scroll,
    pressKey,
  }
}
