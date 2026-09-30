import './globals.css';
import type { ReactNode } from 'react';
import { JetBrains_Mono, Kaisei_Decol, Poppins } from 'next/font/google';
import { ToastProvider } from '../components/Toast';

// Brand typefaces (guidelines §17): Poppins for the product, Kaisei Decol for
// editorial display. Both need explicit weights — neither is a variable font.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});
const kaisei = Kaisei_Decol({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-kaisei',
  display: 'swap',
  preload: false, // empty-state headlines only — not worth preloading on every page
});
// Brand mono (guidelines §17) — order numbers, account numbers, IDs.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});
const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';

export const metadata = {
  title: `${PRODUCT_NAME} — Admin`,
  description: 'Merchant admin portal',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${kaisei.variable} ${mono.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
