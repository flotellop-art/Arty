-- 0007 — Horodatage fournisseur monotone des abonnements Lemon Squeezy.
--
-- A appliquer une seule fois sur une base ayant deja recu 0002 puis 0005/0006.
-- SQLite/D1 ne prend pas en charge ADD COLUMN IF NOT EXISTS : l'ordre des
-- migrations est donc la garantie d'idempotence. Le fallback runtime de
-- functions/api/webhook/lemonsqueezy.ts reste present pour les environnements
-- historiques sur lesquels les migrations sont appliquees manuellement.

ALTER TABLE subscriptions ADD COLUMN provider_updated_at TEXT;

-- Les lignes historiques utilisent leur derniere mise a jour locale comme
-- borne conservatrice avant de recevoir un nouvel evenement fournisseur.
UPDATE subscriptions
SET provider_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
WHERE provider_updated_at IS NULL AND updated_at IS NOT NULL;
