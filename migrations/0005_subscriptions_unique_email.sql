-- 0005 — Contrainte d'unicité sur subscriptions(user_email)
-- Réconciliation schéma↔code (15 juin 2026).
--
-- Contexte : la table prod a été créée par migrations/0002 (user_email NON
-- unique, juste un index simple), alors que TOUT le code de monétisation fait
-- des `ON CONFLICT(user_email)` (license/activate + webhook Lemon Squeezy). Sans
-- contrainte UNIQUE sur user_email, ces upserts échouent
-- (« ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint »)
-- → aucun paiement ne s'enregistre. Cet index unique les fait fonctionner.
--
-- ⚠️ Les migrations ne sont PAS auto-appliquées sur ce projet Cloudflare Pages
-- (pas de wrangler.toml). À appliquer À LA MAIN, **après** le déploiement du
-- code corrigé, via la console D1 du dashboard Cloudflare ou :
--   npx wrangler d1 execute arty-db --remote --file=migrations/0005_subscriptions_unique_email.sql
--
-- NB : `ensureSubscriptionsTable()` (functions/api/webhook/lemonsqueezy.ts) crée
-- aussi cet index `IF NOT EXISTS` au runtime → la prod s'auto-répare au 1er
-- webhook/activation après déploiement. Cette migration est la trace versionnée.
--
-- Pré-requis : aucun doublon d'email (sinon le CREATE UNIQUE INDEX échoue).
-- Vérifier (doit retourner 0 ligne) — 0 doublon confirmé en prod le 15 juin :
--   SELECT user_email, COUNT(*) FROM subscriptions GROUP BY user_email HAVING COUNT(*) > 1;
-- Si des doublons existent, dédupliquer d'abord en gardant le plus récent :
--   DELETE FROM subscriptions WHERE id NOT IN (
--     SELECT MAX(id) FROM subscriptions GROUP BY user_email
--   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_email_unique
  ON subscriptions(user_email);
