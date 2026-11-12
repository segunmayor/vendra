import { getPublicSettings, text } from '@vendra/portal-session/server';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const brandFont = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-brand' });

/** Page titles end with the store name staff set in Admin, Settings. */
export async function generateMetadata(): Promise<Metadata> {
  const name = text(await getPublicSettings(), 'store.name');
  const brand = `${name} Sellers`.trim();
  return { title: { template: `%s · ${brand}`, default: brand }, description: `Sell on ${name}` };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" data-portal="vendor" className={brandFont.variable}>
      <body>{children}</body>
    </html>
  );
}
