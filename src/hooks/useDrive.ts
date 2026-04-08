import { useState, useCallback } from 'react'
import type { DriveFile, DriveFileContent } from '../types/google'
import * as drive from '../services/driveClient'

export function useDrive() {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [currentFile, setCurrentFile] = useState<DriveFileContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFiles = useCallback(async (folderId?: string, query?: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await drive.listFiles(folderId, query)
      setFiles(result)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Drive'
      setError(msg)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  const readFile = useCallback(async (fileId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await drive.readFile(fileId)
      setCurrentFile(result)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lecture'
      setError(msg)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const createFile = useCallback(
    async (name: string, content: string, options?: { mimeType?: string; folderId?: string }) => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await drive.createFile(name, content, options)
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur création'
        setError(msg)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return {
    files,
    currentFile,
    isLoading,
    error,
    fetchFiles,
    readFile,
    createFile,
  }
}
