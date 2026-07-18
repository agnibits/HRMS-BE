import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';

/**
 * Idempotent seed: system roles, a demo company, and a Super Admin account.
 * Safe to run repeatedly (uses upserts). Credentials are for local dev only.
 */
const prisma = new PrismaClient();

const SUPER_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@hrms.local';
const SUPER_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';

async function main() {
  // 1. Demo company
  const company = await prisma.company.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: { name: 'Demo Corp', code: 'DEMO', currency: 'USD', timezone: 'UTC' },
  });

  // 2. System roles (global — companyId null).
  // Prisma cannot upsert on a compound unique when a member is null, so we
  // find-or-create/update explicitly.
  const roleMap = {};
  for (const def of Object.values(SYSTEM_ROLES)) {
    const existing = await prisma.role.findFirst({ where: { name: def.name, companyId: null } });
    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { permissions: def.permissions, description: def.description, isSystem: true },
        })
      : await prisma.role.create({
          data: {
            name: def.name,
            description: def.description,
            permissions: def.permissions,
            isSystem: true,
            companyId: null,
          },
        });
    roleMap[def.name] = role;
  }

  // 3. Super admin user
  const passwordHash = await argon2.hash(SUPER_ADMIN_PASSWORD, { type: argon2.argon2id });
  // Email is unique per company now, so upsert on the composite key.
  const admin = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: SUPER_ADMIN_EMAIL } },
    update: {},
    create: {
      email: SUPER_ADMIN_EMAIL,
      firstName: 'Super',
      lastName: 'Admin',
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      companyId: company.id,
      extraPermissions: [],
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roleMap.SUPER_ADMIN.id } },
    update: {},
    create: { userId: admin.id, roleId: roleMap.SUPER_ADMIN.id },
  });

  // eslint-disable-next-line no-console
  console.log('✅ Seed complete');
  // eslint-disable-next-line no-console
  console.log(`   Company: ${company.name} (${company.code})`);
  // eslint-disable-next-line no-console
  console.log(`   Super Admin: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
