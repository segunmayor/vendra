import 'reflect-metadata';
import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  // rawBody is required to check payment webhook signatures.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();
  return app;
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Vendra API')
    .setDescription('Central API for the Vendra customer, admin and vendor portals.')
    .setVersion('1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
