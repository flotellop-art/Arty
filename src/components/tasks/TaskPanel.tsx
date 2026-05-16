import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Task } from '../../services/taskService'
import { getTasks, addTask, toggleTask, deleteTask } from '../../services/taskService'

interface TaskPanelProps {
  onClose: () => void
}

export function TaskPanel({ onClose }: TaskPanelProps) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<Task[]>(getTasks)
  const [newText, setNewText] = useState('')

  useEffect(() => {
    const refresh = () => setTasks(getTasks())
    window.addEventListener('tasks-updated', refresh)
    return () => window.removeEventListener('tasks-updated', refresh)
  }, [])

  const handleAdd = () => {
    const text = newText.trim()
    if (!text) return
    addTask(text)
    setNewText('')
  }

  const pending = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-theme-ink/50" onClick={onClose}>
      <div
        className="bg-theme-surface rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="font-display text-lg text-theme-ink">✅ {t('tasks.title')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted" aria-label={t('common.close')}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-theme-border flex gap-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
            }}
            placeholder={t('tasks.addPlaceholder')}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-theme-border focus:outline-none focus:border-theme-accent"
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            className="px-3 py-1.5 rounded-lg bg-theme-accent text-theme-bg text-sm disabled:opacity-30"
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {tasks.length === 0 && (
            <p className="text-sm text-theme-muted text-center py-6">{t('tasks.empty')}</p>
          )}

          {pending.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-1.5">{t('tasks.pending', { count: pending.length })}</p>
              {pending.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-1.5">{t('tasks.done', { count: done.length })}</p>
              {done.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: Task }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 py-1.5 group">
      <button
        onClick={() => toggleTask(task.id)}
        className={`flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
          task.done
            ? 'bg-theme-accent border-theme-accent text-white'
            : 'border-theme-border hover:border-theme-accent'
        }`}
        aria-label={task.done ? t('tasks.markUndone') : t('tasks.markDone')}
      >
        {task.done && <span className="text-xs">✓</span>}
      </button>
      <span className={`flex-1 text-sm ${task.done ? 'text-theme-muted line-through' : 'text-theme-ink'}`}>
        {task.text}
      </span>
      <button
        onClick={() => deleteTask(task.id)}
        className="opacity-0 group-hover:opacity-100 text-theme-muted hover:text-red-500 text-xs transition-opacity"
        aria-label={t('tasks.delete')}
      >
        ✕
      </button>
    </div>
  )
}
