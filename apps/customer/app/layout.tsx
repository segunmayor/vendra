import { getPublicSettings, text } from '@vendra/portal-session/server';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const brandFont = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-brand' });

/** Page titles end with the store name staff set in Admin, Settings. */
export async function generateMetadata(): Promise<Metadata> {
  const name = text(await getPublicSettings(), 'store.name');
  const brand = `${name}`.trim();
  return { title: { template: `%s · ${brand}`, default: brand }, description: text(await getPublicSettings(), 'store.heroSubtitle') };
}

/** Support contacts come from Admin, Settings; each is hidden when blank. */
async function SiteFooter() {
  const store = await getPublicSettings();
  const email = text(store, 'store.supportEmail');
  const phone = text(store, 'store.supportPhone');
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
        <span>© {new Date().getFullYear()} {text(store, 'store.name')}</span>
        {email ? <a href={`mailto:${email}`} className="hover:text-foreground">{email}</a> : null}
        {phone ? <a href={`tel:${phone}`} className="hover:text-foreground">{phone.replace(/^\+234/, '0')}</a> : null}
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" data-portal="customer" className={brandFont.variable}>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
