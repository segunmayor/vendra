import { SwaggerModule } from '@nestjs/swagger';
import { createApp, createOpenApiDocument } from './bootstrap';
import { loadEnv } from './platform/config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  if (env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, createOpenApiDocument(app));
  }
  await app.listen(env.PORT);
}

void main();
