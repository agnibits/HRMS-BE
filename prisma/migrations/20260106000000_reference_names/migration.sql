-- Idempotent: onboardings.buddyName/managerName may already exist from
-- 20260106000000_onboarding_names; only add what's missing.
ALTER TABLE "onboardings" ADD COLUMN IF NOT EXISTS "buddyName" TEXT;
ALTER TABLE "onboardings" ADD COLUMN IF NOT EXISTS "managerName" TEXT;
ALTER TABLE "performance_reviews" ADD COLUMN IF NOT EXISTS "reviewerName" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "assigneeName" TEXT;
