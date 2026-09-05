// scripts/seed-admin.js
//
// Creates (or updates the password of) the admin account used to log into
// the dashboard. Run with: npm run seed
// Reads ADMIN_EMAIL and ADMIN_PASSWORD from environment variables.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/db');

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running this script.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash }
  });

  console.log(`Admin user ready: ${user.email} (id ${user.id})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
