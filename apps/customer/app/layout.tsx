import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const brandFont = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-brand' });

export const metadata: Metadata = { title: 'Vendra', description: 'Shop with confidence across Nigeria.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" data-portal="customer" className={brandFont.variable}>
      <body>{children}</body>
    </html>
  );
}
