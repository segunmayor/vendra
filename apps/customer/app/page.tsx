import { EmptyState } from '@vendra/ui';
import { SiteHeader } from '../components/site-header';

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="rounded-brand bg-primary px-6 py-12 text-primary-foreground md:px-12 md:py-16">
          <h1 className="max-w-xl text-3xl font-extrabold tracking-tight md:text-5xl">
            Everything you need, delivered with confidence.
          </h1>
          <p className="mt-4 max-w-lg text-base opacity-90">
            Clear prices, verified payments and delivery you can follow from checkout to your door.
          </p>
        </section>
        <div className="mt-8">
          <EmptyState title="Products are coming soon">
            The catalogue will appear here once products are published.
          </EmptyState>
        </div>
      </main>
    </>
  );
}
