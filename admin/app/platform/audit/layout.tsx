import type { ReactNode } from 'react';

// The browser tab names the console page, so it is never mistaken for a shop's dashboard (2026-10-14 critique).
const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';
export const metadata = { title: `Audit · Platform console · ${PRODUCT_NAME}` };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
