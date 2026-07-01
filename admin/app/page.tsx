const PRODUCT_NAME = process.env.PRODUCT_NAME ?? 'Sahulatkaar';

export default function Home() {
  return (
    <main style={{ padding: 48, maxWidth: 720, margin: '0 auto' }}>
      <h1>{PRODUCT_NAME} — Admin Portal</h1>
      <p style={{ color: '#666' }}>
        Phase 0 skeleton. Merchant onboarding, catalog, orders, inbox, and settings land in Phase 5.
      </p>
      <p style={{ color: '#999', fontSize: 13 }}>Brand name is configuration (PRODUCT_NAME) — not final.</p>
    </main>
  );
}
