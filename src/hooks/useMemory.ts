import { useState, useCallback, useRef } from 'react'
import type { MemoryData } from '../services/memoryService'
import { readAllMemory, updateMemory, formatMemoryForPrompt } from '../services/memoryService'

export function useMemory() {
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const loadedRef = useRef(false)

  const loadMemory = useCallback(async () => {
    if (loadedRef.current) return memory
    setIsLoading(true)
    try {
      const data = await readAllMemory()
      setMemory(data)
      loadedRef.current = true
      return data
    } catch {
      return null
    } finally {
      setIsLoading(false)
    }
  }, [memory])

  const saveMemory = useCallback(
    async (category: 'profil' | 'clients' | 'chantiers' | 'notes', data: unknown) => {
      const result = await updateMemory(category, data)
      if (result.success) {
        // Refresh local state
        setMemory((prev) => (prev ? { ...prev, [category]: data } : prev))
      }
      return result
    },
    []
  )

  // Roadmap PR 12.1 — injection conditionnelle. Si userMessage fourni,
  // on injecte le profil minimal uniquement quand le message ne touche
  // pas à la mémoire (économie ~95% des tokens). Sinon fallback legacy.
  const getPromptContext = useCallback((userMessage?: string) => {
    if (!memory) return ''
    return formatMemoryForPrompt(memory, userMessage)
  }, [memory])

  return {
    memory,
    isLoading,
    loadMemory,
    saveMemory,
    getPromptContext,
  }
}
