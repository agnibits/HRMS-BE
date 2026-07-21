-- CreateTable
CREATE TABLE IF NOT EXISTS "onboarding_tasks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onboarding_tasks_onboardingId_idx" ON "onboarding_tasks"("onboardingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onboarding_tasks_companyId_idx" ON "onboarding_tasks"("companyId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_tasks_onboardingId_fkey'
  ) THEN
    ALTER TABLE "onboarding_tasks"
      ADD CONSTRAINT "onboarding_tasks_onboardingId_fkey"
      FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
