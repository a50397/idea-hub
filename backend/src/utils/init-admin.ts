import bcrypt from 'bcrypt';
import prisma from '../lib/prisma';

export async function ensureAdminExists(): Promise<void> {
  try {
    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (existingAdmin) {
      return;
    }

    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      console.error(
        'FATAL: No admin user exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set in .env. Exiting.'
      );
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        name: process.env.ADMIN_NAME || 'Admin',
        email,
        passwordHash,
        role: 'ADMIN',
      },
    });

    console.log(`Default admin created: ${email}`);
  } catch (error) {
    console.error('Failed to ensure admin exists:', error);
    process.exit(1);
  }
}
