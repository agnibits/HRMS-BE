-- Transform the User HR reference fields from free text to FK id + denormalized
-- name (idempotent; the enum/employeeId/manager/joiningDate/employmentType and
-- the unique index were created by 20260106000000_user_hr_fields).
ALTER TABLE "users" DROP COLUMN IF EXISTS "department";
ALTER TABLE "users" DROP COLUMN IF EXISTS "designation";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "departmentName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "designationId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "designationName" TEXT;
