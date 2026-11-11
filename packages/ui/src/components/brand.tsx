import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export function Wordmark({ suffix, className }: { suffix?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-2 text-xl font-extrabold tracking-tight text-primary', className)}>
      Vendra
      {suffix ? <span className="text-sm font-medium text-muted">{suffix}</span> : null}
    </span>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-brand border border-border bg-surface p-5', className)} {...props} />;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-brand border border-dashed border-border px-6 py-12 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</p>
    </div>
  );
}

/** Sidebar layout shared by the admin and vendor portals. */
export function PortalShell({
  brand,
  navigation,
  children,
}: {
  brand: ReactNode;
  navigation: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-border bg-surface p-4 md:border-r md:border-b-0">
        {brand}
        <nav aria-label="Main" className="mt-4 flex gap-1 overflow-x-auto md:mt-6 md:flex-col">
          {navigation.map((item) => (
            <span key={item} className="rounded-brand px-3 py-2 text-sm whitespace-nowrap text-muted">
              {item}
            </span>
          ))}
        </nav>
      </aside>
      <main className="p-4 md:p-8">{children}</main>
    </div>
  );
}
