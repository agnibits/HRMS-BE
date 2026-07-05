-- CreateEnum
CREATE TYPE "CompanyPlan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "adminEmail" TEXT,
ADD COLUMN     "plan" "CompanyPlan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

