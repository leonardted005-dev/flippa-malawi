import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Pan-African Digital Asset Marketplace',
  description:
    'Marketplace for transferable digital assets across Africa: software, websites, apps, channels, accounts and domains.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
