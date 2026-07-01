import type { ReactNode } from 'react';

const PRODUCT_NAME = process.env.PRODUCT_NAME ?? 'Sahulatkaar';

export const metadata = {
  title: `${PRODUCT_NAME} — Admin`,
  description: 'Merchant admin portal',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
