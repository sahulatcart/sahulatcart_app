import type { ReactNode } from 'react';

// The browser tab names the page (2026-10-15 UI pass).
const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';
export const metadata = { title: `Analytics · ${PRODUCT_NAME}` };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
