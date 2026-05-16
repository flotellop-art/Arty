-- Migration 0003 — Renommage de la catégorie mémoire 'chantiers' → 'projets'
-- Date : 2026-05-16
-- Objet : Arty se dé-verticalise du BTP vers un assistant généraliste.
--         La catégorie de mémoire 'chantiers' devient 'projets'. Les données
--         déjà stockées en D1 sous 'chantiers' sont déplacées vers 'projets'
--         pour rester lisibles par l'app après le renommage côté code.
--
-- Idempotent : INSERT OR REPLACE évite toute violation de la PRIMARY KEY
-- (user_id, category) au cas où une ligne 'projets' existerait déjà pour
-- un utilisateur. La migration est re-jouable sans risque.
--
-- APPLICATION : ce projet Cloudflare Pages n'a pas de wrangler.toml, les
-- migrations ne sont donc PAS appliquées automatiquement. L'appliquer à la
-- main, soit via la console D1 du dashboard Cloudflare, soit via :
--   wrangler d1 execute <DB_NAME> --remote --file=migrations/0003_rename_chantiers_to_projets.sql

INSERT OR REPLACE INTO memory (user_id, category, data, updated_at)
  SELECT user_id, 'projets', data, updated_at
  FROM memory
  WHERE category = 'chantiers';

DELETE FROM memory WHERE category = 'chantiers';
