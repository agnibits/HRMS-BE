-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "department" TEXT,
ADD COLUMN     "designation" TEXT,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "employmentType" "EmploymentType",
ADD COLUMN     "joiningDate" TIMESTAMP(3),
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "managerName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_employeeId_key" ON "users"("companyId", "employeeId");
