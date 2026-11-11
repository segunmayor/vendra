import * as fs from 'node:fs';
import * as path from 'node:path';
import { createApp, createOpenApiDocument } from './bootstrap';

/** Writes the contract without starting a server or touching the database. */
async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused';
  const app = await createApp();
  const target = path.join(__dirname, '../../../packages/api-client/openapi.json');
  fs.writeFileSync(target, `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`);
  await app.close();
}

void main();
