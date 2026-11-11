import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { StaffService } from './modules/identity';

/** Creates the first administrator from ADMIN_EMAIL and ADMIN_PASSWORD. Runs once. */
async function main(): Promise<void> {
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { id } = await app.get(StaffService).bootstrapSuperAdmin(email, password);
    console.log(`Created administrator ${id}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
