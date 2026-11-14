import 'reflect-metadata';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp(): Promise<NestExpressApplication> {
  // rawBody is required to check payment webhook signatures.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();
  return app;
}

/**
 * The API returns JSON and files for download, never pages. These stop a browser from guessing
 * types, framing responses or caching personal data, and keep it on HTTPS once it has seen it.
 */
function securityHeaders(request: { path?: string }, response: { setHeader(name: string, value: string): void }, next: () => void): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cross-origin-resource-policy', 'same-site');
  // The interactive API docs (development only) are a page with scripts.
  if (!request.path?.startsWith('/docs')) response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('cache-control', 'no-store');
  if (process.env.NODE_ENV === 'production') response.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  next();
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Vendra API')
    .setDescription('Central API for the Vendra customer, admin and vendor portals.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
