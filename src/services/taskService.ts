/**
 * Task service — a simple local to-do list (Feature 8).
 */

import * as scoped from './scopedStorage'
import { generateId } from '../utils/generateId'

export interface Task {
  id: string
  text: string
  done: boolean
  conversationId: string | null
  createdAt: number
}

const KEY = 'tasks'

export function getTasks(): Task[] {
  return scoped.getJSON<Task[]>(KEY) || []
}

export function saveTasks(tasks: Task[]): void {
  scoped.setJSON(KEY, tasks)
  window.dispatchEvent(new CustomEvent('tasks-updated'))
}

export function addTask(text: string, conversationId: string | null = null): Task {
  const task: Task = {
    id: generateId(),
    text: text.trim(),
    done: false,
    conversationId,
    createdAt: Date.now(),
  }
  const tasks = getTasks()
  tasks.unshift(task)
  saveTasks(tasks)
  return task
}

export function toggleTask(id: string): void {
  const tasks = getTasks()
  const task = tasks.find((t) => t.id === id)
  if (!task) return
  task.done = !task.done
  saveTasks(tasks)
}

export function deleteTask(id: string): void {
  const tasks = getTasks().filter((t) => t.id !== id)
  saveTasks(tasks)
}

export function countPending(): number {
  return getTasks().filter((t) => !t.done).length
}

/**
 * Scan an assistant message for suggested action items.
 * Matches French patterns like "vous devriez", "pensez à", etc.
 * Returns a deduplicated list of extracted tasks (raw sentences).
 */
export function detectSuggestedTasks(text: string): string[] {
  if (!text) return []
  const patterns = [
    /(?:vous\s+devriez|vous\s+pourriez|tu\s+devrais|tu\s+pourrais)[^.!?\n]+[.!?]/gi,
    /(?:n['' ]oubliez?\s+pas\s+de|n['' ]oublie\s+pas\s+de)[^.!?\n]+[.!?]/gi,
    /(?:pensez?\s+à|pense\s+à)[^.!?\n]+[.!?]/gi,
    /(?:il\s+faudra|il\s+faut|il\s+faudrait)[^.!?\n]+[.!?]/gi,
  ]
  const found = new Set<string>()
  for (const re of patterns) {
    const matches = text.match(re)
    if (matches) {
      for (const m of matches) {
        const clean = m.trim().replace(/\s+/g, ' ')
        if (clean.length > 10 && clean.length < 240) found.add(clean)
      }
    }
  }
  return Array.from(found).slice(0, 5)
}
