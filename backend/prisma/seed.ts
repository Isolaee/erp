import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin1234';

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Admin',
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  console.log(`Admin user: ${admin.email}`);

  const team = await prisma.team.upsert({
    where: { id: 'seed-team-001' },
    update: {},
    create: {
      id: 'seed-team-001',
      name: 'Engineering',
      description: 'Core engineering team',
    },
  });

  await prisma.teamMember.upsert({
    where: { userId_teamId: { userId: admin.id, teamId: team.id } },
    update: {},
    create: {
      userId: admin.id,
      teamId: team.id,
      role: UserRole.ADMIN,
    },
  });

  const orgList = await prisma.taskList.upsert({
    where: { id: 'seed-list-org-001' },
    update: {},
    create: {
      id: 'seed-list-org-001',
      title: 'Organization Backlog',
      description: 'Organization-wide task backlog',
      scope: 'ORGANIZATION',
      visibility: 'ORGANIZATION',
      ownerId: admin.id,
    },
  });

  console.log(`Team: ${team.name}`);
  console.log(`Org list: ${orgList.title}`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
