import * as path from 'node:path';

export interface SourceFile {
  /** Path relative to `src`, using forward slashes. */
  readonly path: string;
  readonly imports: readonly string[];
}

type Location =
  | { kind: 'shared-kernel' | 'platform' | 'root' }
  | { kind: 'module'; module: string; layer: string };

function locate(file: string): Location {
  const parts = file.split('/');
  if (parts[0] === 'shared-kernel') return { kind: 'shared-kernel' };
  if (parts[0] === 'platform') return { kind: 'platform' };
  if (parts[0] !== 'modules' || !parts[1]) return { kind: 'root' };
  const module = parts[1];
  const rest = parts[2] ?? 'index';
  if (parts.length === 3 || parts.length === 2) {
    return { kind: 'module', module, layer: rest.startsWith('index') ? 'public' : 'composition' };
  }
  return { kind: 'module', module, layer: rest };
}

const SAME_MODULE: Record<string, readonly string[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  interface: ['application', 'interface'],
  public: ['application'],
  composition: ['domain', 'application', 'infrastructure', 'interface', 'public'],
};

const PURE_LAYERS = ['domain', 'application', 'public'];

function check(from: Location, target: Location | null): string | null {
  // `target === null` is an npm package or Node built-in.
  if (from.kind === 'root') return null;

  if (from.kind === 'shared-kernel') {
    return target?.kind === 'shared-kernel' ? null : 'shared-kernel must have no dependencies';
  }
  if (from.kind === 'platform') {
    return target?.kind === 'module' ? 'platform must not import modules' : null;
  }
  if (from.kind !== 'module') return null;

  if (target === null) {
    return PURE_LAYERS.includes(from.layer) ? `${from.layer} must not import packages` : null;
  }
  if (target.kind === 'shared-kernel') return null;
  if (target.kind === 'root') return 'modules must not import application root files';
  if (target.kind === 'platform') {
    return PURE_LAYERS.includes(from.layer) ? `${from.layer} must not import platform` : null;
  }

  if (target.kind !== 'module') return null;

  if (target.module === from.module) {
    return SAME_MODULE[from.layer]?.includes(target.layer)
      ? null
      : `${from.layer} must not import ${target.layer}`;
  }
  if (from.layer === 'domain' || from.layer === 'public') {
    return `${from.layer} must not import other modules`;
  }
  if (target.layer === 'public') return null;
  // NestJS needs a module's composition file to import another's to use its contract.
  if (from.layer === 'composition' && target.layer === 'composition') return null;
  return `other module internals (${target.module}/${target.layer})`;
}

export function findViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const from = locate(file.path);
    for (const specifier of file.imports) {
      const relative = specifier.startsWith('.');
      if (!relative && from.kind === 'module' && /(^|\/)src\/|^@vendra\/api/.test(specifier)) {
        violations.push(`${file.path} -> ${specifier}: non-relative import of backend code`);
        continue;
      }
      if (
        from.kind === 'module' &&
        from.layer !== 'infrastructure' &&
        specifier.startsWith('@prisma/')
      ) {
        violations.push(`${file.path} -> ${specifier}: Prisma is only allowed in infrastructure`);
        continue;
      }
      const target = relative
        ? locate(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier)))
        : null;
      const problem = check(from, target);
      if (problem) violations.push(`${file.path} -> ${specifier}: ${problem}`);
    }
  }
  return violations;
}
