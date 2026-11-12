import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

/** The store name as typeset text. The name comes from the store.name setting. */
export function Wordmark({ name, suffix, className }: { name: string; suffix?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-2 text-xl font-extrabold tracking-tight text-primary', className)}>
      {name}
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

export interface NavItem {
  readonly label: string;
  readonly href: string;
}

/**
 * Sidebar layout shared by the admin and vendor portals. `renderLink` lets each portal
 * supply its router's link component, so this package stays framework free.
 */
export function PortalShell({
  brand,
  navigation,
  currentPath,
  renderLink,
  account,
  children,
}: {
  brand: ReactNode;
  navigation: readonly NavItem[];
  currentPath?: string;
  renderLink?: (item: NavItem, props: { className: string; 'aria-current'?: 'page' }) => ReactNode;
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="flex flex-col border-b border-border bg-surface p-4 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        {brand}
        <nav aria-label="Main" className="mt-4 flex gap-1 overflow-x-auto md:mt-6 md:flex-col">
          {navigation.map((item) => {
            const current =
              currentPath !== undefined &&
              (item.href === '/' ? currentPath === '/' : currentPath === item.href || currentPath.startsWith(`${item.href}/`));
            const className = cn(
              'rounded-brand px-3 py-2 text-sm whitespace-nowrap',
              current ? 'bg-background font-semibold text-primary' : 'text-muted hover:text-foreground',
            );
            const props = { className, ...(current ? { 'aria-current': 'page' as const } : {}) };
            return (
              <span key={item.href} className="contents">
                {renderLink ? renderLink(item, props) : <a href={item.href} {...props}>{item.label}</a>}
              </span>
            );
          })}
        </nav>
        {account ? <div className="mt-4 border-t border-border pt-4 md:mt-auto">{account}</div> : null}
      </aside>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
