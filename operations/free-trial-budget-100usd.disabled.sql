-- PREPARATION ONLY: never run automatically with migrations or deployment.
-- Candidate chat scope only; auxiliary routes are not yet covered.
-- Activation remains blocked until the full FREE_TRIAL_POLICY is implemented.
-- A strict INSERT intentionally fails if a policy already exists: no reset,
-- overwrite, replenishment, monthly renewal or implicit enablement.
-- 3000 is a secondary cap on provider ATTEMPTS, not on people or UI answers.
INSERT INTO subsidized_budget_v1
  (scope, revision, enabled, limit_micro_usd, limit_attempts)
VALUES ('arty-subsidized', 1, 0, 100000000, 3000);
