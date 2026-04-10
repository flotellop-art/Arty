-- Arty D1 Database Schema

-- User memory (replaces Google Drive IA-Memoire for non-Google users)
CREATE TABLE IF NOT EXISTS memory (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'profil', 'clients', 'chantiers', 'notes'
  data TEXT NOT NULL,      -- JSON content
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, category)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);
