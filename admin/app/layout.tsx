import './globals.css';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { ToastProvider } from '../components/Toast';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatkaar';

export const metadata = {
  title: `${PRODUCT_NAME} — Admin`,
  description: 'Merchant admin portal',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
