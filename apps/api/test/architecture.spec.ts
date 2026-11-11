import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { findViolations, SourceFile } from './architecture-rules';

const SRC = path.join(__dirname, '../src');
const APPS = path.join(__dirname, '../..');

function readSources(dir: string): SourceFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry): SourceFile[] => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return readSources(full);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];
    const info = ts.preProcessFile(fs.readFileSync(full, 'utf8'), true, true);
    return [
      {
        path: path.relative(SRC, full).split(path.sep).join('/'),
        imports: info.importedFiles.map((imported) => imported.fileName),
      },
    ];
  });
}

describe('architecture rules', () => {
  it('holds for the real source tree', () => {
    const files = readSources(SRC);
    expect(files.length).toBeGreaterThan(5);
    expect(findViolations(files)).toEqual([]);
  });

  it('keeps portals independent of the API and of each other', () => {
    const portals = ['customer', 'admin', 'vendor'];
    for (const portal of portals) {
      const manifest = JSON.parse(fs.readFileSync(path.join(APPS, portal, 'package.json'), 'utf8'));
      const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      const forbidden = ['@vendra/api', '@vendra/worker', '@prisma/client', ...portals.map((p) => `@vendra/${p}`)];
      expect(deps.filter((dep) => forbidden.includes(dep))).toEqual([]);
    }
  });

  // Proves the checker catches violations, so a passing run above means something.
  it.each<[string, string, string]>([
    ['domain importing Prisma', 'modules/payments/domain/payment.ts', '@prisma/client'],
    ['application importing NestJS', 'modules/payments/application/a.ts', '@nestjs/common'],
    ['domain importing infrastructure', 'modules/payments/domain/a.ts', '../infrastructure/x'],
    ['application importing infrastructure', 'modules/payments/application/a.ts', '../infrastructure/x'],
    ['application importing platform', 'modules/payments/application/a.ts', '../../../platform/x'],
    ['reaching into another module', 'modules/orders/application/a.ts', '../../payments/domain/payment'],
    ['another module repository', 'modules/orders/infrastructure/a.ts', '../../payments/infrastructure/repo'],
    ['domain using another module', 'modules/orders/domain/a.ts', '../../payments'],
    ['controller using infrastructure', 'modules/orders/interface/a.ts', '../infrastructure/repo'],
    ['a controller importing another module composition', 'modules/orders/interface/a.ts', '../../payments/payments.module'],
    ['controller using Prisma', 'modules/orders/interface/a.ts', '@prisma/client'],
    ['shared kernel importing a module', 'shared-kernel/a.ts', '../modules/payments'],
    ['platform importing a module', 'platform/a.ts', '../modules/payments'],
  ])('rejects %s', (_name, file, specifier) => {
    expect(findViolations([{ path: file, imports: [specifier] }])).toHaveLength(1);
  });

  it.each<[string, string, string]>([
    ['the public contract of a module', 'modules/orders/application/a.ts', '../../payments'],
    ['the shared kernel', 'modules/payments/domain/a.ts', '../../../shared-kernel'],
    ['an adapter using an SDK', 'modules/payments/infrastructure/a.ts', 'some-provider-sdk'],
    ['an adapter using a port', 'modules/payments/infrastructure/a.ts', '../application/ports'],
    ['a composition file importing another', 'modules/orders/orders.module.ts', '../payments/payments.module'],
  ])('allows %s', (_name, file, specifier) => {
    expect(findViolations([{ path: file, imports: [specifier] }])).toEqual([]);
  });
});
