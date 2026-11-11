# Backend conventions

The backend is one deployable modular monolith, structured with DDD and Hexagonal Architecture.

## Module layout

```
apps/api/src/
  shared-kernel/            Money, DomainError, AggregateRoot. No dependencies.
  platform/                 Technical concerns: config, Prisma, HTTP, health.
  modules/<name>/
    domain/                 Aggregates, value objects, domain services, events
    application/            Use cases and ports (interfaces)
    infrastructure/         Adapters that implement ports
    interface/              HTTP controllers, DTOs, webhook endpoints
    <name>.module.ts        NestJS composition: binds ports to adapters
    index.ts                The only file other modules may import
```

## Dependency rules

Dependencies point inward: `interface`/`infrastructure` → `application` → `domain` → `shared-kernel`.

| Layer | May import | May not import |
| --- | --- | --- |
| `shared-kernel` | `shared-kernel` | Everything else |
| `domain` | Own `domain`, `shared-kernel` | Any npm package, `platform`, other modules |
| `application` | Own `application` and `domain`, `shared-kernel`, another module's `index.ts` | Any npm package, including NestJS, Prisma and provider SDKs |
| `infrastructure` | Own inner layers, `shared-kernel`, `platform`, npm packages, another module's `index.ts` | Another module's internals |
| `interface` | Own `application` and `interface`, `shared-kernel`, `platform`, npm packages | Own `infrastructure`, another module's internals |
| `index.ts` | Own `application` | Anything else |
| `platform` | `platform`, `shared-kernel`, npm packages | Any module |

These rules are executable. `apps/api/test/architecture.spec.ts` parses every import and fails the build on a violation. It uses the TypeScript compiler already in the project, so it adds no tool.

Because `application` cannot import NestJS, use cases are plain classes. `<name>.module.ts` constructs them with `useFactory`.

## Communication between modules

- **Synchronous queries and commands:** call the application contract exported from the other module's `index.ts`.
- **Asynchronous reactions:** domain events are written to `platform.outbox_events` in the same transaction as the aggregate. The worker relays them to consumers, which must be idempotent.
- A module never reads another module's repository or tables.

This is what makes later extraction possible. A contract call becomes a network call and an outbox event becomes a broker message, without rewriting the domain.

## DDD guidance

- One aggregate, one owning module. Only the owner mutates it.
- One transaction changes one aggregate. Cross-aggregate work is coordinated through events.
- Value objects are immutable and validate themselves.
- Keep it proportionate. Simple CRUD contexts such as CMS or Settings can have a thin domain layer. Do not add abstractions that carry no rule.
