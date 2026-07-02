import './globals.css';
import type { ReactNode } from 'react';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatkaar';

export const metadata = {
  title: `${PRODUCT_NAME} — Admin`,
  description: 'Merchant admin portal',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
