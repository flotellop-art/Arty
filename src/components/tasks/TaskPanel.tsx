import { useEffect, useState } from 'react'
import type { Task } from '../../services/taskService'
import { getTasks, addTask, toggleTask, deleteTask } from '../../services/taskService'
import { Tag, Rule, DotLine } from '../shared/editorial'

interface TaskPanelProps {
  onClose: () => void
}

export function TaskPanel({ onClose }: TaskPanelProps) {
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
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          borderRadius: 4,
          border: '1px solid var(--arty-line)',
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Masthead */}
        <div className="px-6 pt-4 pb-2 flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[20px] leading-none"
            style={{ color: 'var(--arty-ink)' }}
            aria-label="Fermer"
          >
            ←
          </button>
          <Tag>Tâches · du jour</Tag>
          <div className="flex-1" />
        </div>
        <Rule className="mx-6" />

        {/* Hero count */}
        <div className="px-6 pt-5 pb-2">
          <h1 className="font-display text-[30px] leading-[1.05] font-light tracking-[-0.02em]">
            <span style={{ color: 'var(--arty-accent)' }}>{pending.length}</span>
            <span className="text-[20px] ml-2" style={{ color: 'var(--arty-muted)' }}>
              / {tasks.length}
            </span>
          </h1>
          <p className="font-serif italic text-[13px] mt-1" style={{ color: 'var(--arty-ink-soft)' }}>
            {tasks.length === 0
              ? 'Rien à faire. Respire.'
              : pending.length === 0
                ? 'Tout est cochéee.'
                : 'à faire avant ce soir.'}
          </p>
        </div>

        {/* Add new */}
        <div className="px-6 pt-3">
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ backgroundColor: 'var(--arty-card)', border: '1px solid var(--arty-line)', borderRadius: 2 }}
          >
            <span style={{ color: 'var(--arty-accent)' }}>+</span>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
              }}
              placeholder="Nouvelle intention…"
              className="flex-1 bg-transparent border-none focus:outline-none text-[14px] font-serif italic"
              style={{ color: 'var(--arty-ink)' }}
            />
            <button
              onClick={handleAdd}
              disabled={!newText.trim()}
              className="font-serif italic text-[12px] disabled:opacity-30"
              style={{ color: 'var(--arty-accent)' }}
            >
              Ajouter →
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pt-5 pb-6">
          {tasks.length === 0 && (
            <p className="font-serif italic text-[14px] text-center py-10" style={{ color: 'var(--arty-muted)' }}>
              Aucune tâche pour l'instant.
            </p>
          )}

          {pending.length > 0 && (
            <section className="mb-5">
              <div
                className="flex justify-between items-baseline pb-2 mb-2"
                style={{ borderBottom: '1px solid var(--arty-ink)' }}
              >
                <Tag>I · En cours</Tag>
                <span className="font-mono text-[10px]" style={{ color: 'var(--arty-muted)' }}>
                  {pending.length}
                </span>
              </div>
              {pending.map((task, i) => (
                <div key={task.id}>
                  <TaskRow task={task} />
                  {i < pending.length - 1 && <DotLine />}
                </div>
              ))}
            </section>
          )}

          {done.length > 0 && (
            <section>
              <div
                className="flex justify-between items-baseline pb-2 mb-2"
                style={{ borderBottom: '1px solid var(--arty-ink)' }}
              >
                <Tag>II · Terminées</Tag>
                <span className="font-mono text-[10px]" style={{ color: 'var(--arty-muted)' }}>
                  {done.length}
                </span>
              </div>
              {done.map((task, i) => (
                <div key={task.id}>
                  <TaskRow task={task} />
                  {i < done.length - 1 && <DotLine />}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: Task }) {
  return (
    <div className="flex items-start gap-3 py-3 group">
      <button
        onClick={() => toggleTask(task.id)}
        className="flex-shrink-0 w-5 h-5 rounded-full mt-0.5 grid place-items-center transition-colors"
        style={{
          border: `1.5px solid ${task.done ? 'var(--arty-muted)' : 'var(--arty-accent)'}`,
          backgroundColor: task.done ? 'var(--arty-muted)' : 'transparent',
          color: 'var(--arty-bg)',
          fontSize: 11,
          boxShadow: task.done ? 'none' : '0 0 10px var(--arty-accent-glow)',
        }}
        aria-label={task.done ? 'Marquer comme non terminée' : 'Marquer comme terminée'}
      >
        {task.done && '✓'}
      </button>
      <div className="flex-1">
        <div
          className="font-serif text-[15px] leading-[1.3]"
          style={{
            color: task.done ? 'var(--arty-muted)' : 'var(--arty-ink)',
            textDecoration: task.done ? 'line-through' : 'none',
          }}
        >
          {task.text}
        </div>
      </div>
      <button
        onClick={() => deleteTask(task.id)}
        className="opacity-0 group-hover:opacity-100 text-xs transition-opacity"
        style={{ color: 'var(--arty-muted)' }}
        aria-label="Supprimer"
      >
        ✕
      </button>
    </div>
  )
}
