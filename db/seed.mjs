// Seed a pilot merchant + WhatsApp number + sample products (idempotent).
// Run: node --env-file=.env db/seed.mjs
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PHONE_NUMBER_ID = process.env.META_DEFAULT_PHONE_NUMBER_ID;
const WABA_ID = process.env.META_DEFAULT_WABA_ID;

async function main() {
  // Merchant (upsert by email)
  const merchant = await db
    .from('merchants')
    .upsert(
      {
        business_name: 'Test Shop',
        owner_name: 'Pilot Owner',
        email: 'pilot@sahulatcart.test',
        status: 'active',
        negotiation_defaults: {
          maxDiscountPct: 15,
          concessionSteps: [0.4, 0.7, 0.9, 1.0],
          roundsMax: 3,
          autoAcceptAtFloor: true,
        },
        settings: {
          botEnabled: true,
          codEnabled: true,
          paymentInstructions: '',
          defaultDeliveryCharge: 20000,
          freeDeliveryThreshold: 0,
          lowStockThreshold: 3,
          onboardingCompletedAt: null,
          metaCatalog: null,
        },
      },
      { onConflict: 'email' }
    )
    .select('id')
    .single();
  if (merchant.error) throw merchant.error;
  const merchantId = merchant.data.id;
  console.log('merchant:', merchantId);

  // WhatsApp number (upsert by phone_number_id)
  const num = await db
    .from('whatsapp_numbers')
    .upsert(
      {
        merchant_id: merchantId,
        phone_number_id: PHONE_NUMBER_ID,
        waba_id: WABA_ID,
        phone_e164: '+15556656910',
        display_name: 'Test Number',
        status: 'connected',
      },
      { onConflict: 'phone_number_id' }
    )
    .select('id')
    .single();
  if (num.error) throw num.error;
  console.log('whatsapp_number:', num.data.id, '(phone_number_id', PHONE_NUMBER_ID + ')');

  // Sample products (upsert by merchant_id + sku)
  const products = [
    { sku: 'TSHIRT', name: 'T-Shirt', price: 250000, negotiable: true, max_discount_pct: 20, stock: 50 },
    { sku: 'CAP', name: 'Cap', price: 100000, negotiable: true, max_discount_pct: 10, stock: 30 },
    { sku: 'MUG', name: 'Mug', price: 80000, negotiable: false, stock: 100 },
  ];
  for (const p of products) {
    const r = await db
      .from('products')
      .upsert(
        { merchant_id: merchantId, track_stock: true, is_active: true, currency: 'PKR', ...p },
        { onConflict: 'merchant_id,sku' }
      )
      .select('id')
      .single();
    if (r.error) throw r.error;
    console.log('product:', p.name, '(Rs', p.price / 100 + ')');
  }

  // Storage buckets (private) — idempotent
  for (const b of ['payment-screenshots', 'inbound-media', 'order-slips']) {
    const { error } = await db.storage.createBucket(b, { public: false });
    if (error && !/already exists/i.test(error.message)) console.log(`bucket ${b}: ${error.message}`);
    else console.log(`bucket: ${b}`);
  }
  // product-images public
  {
    const { error } = await db.storage.createBucket('product-images', { public: true });
    if (error && !/already exists/i.test(error.message)) console.log(`bucket product-images: ${error.message}`);
    else console.log('bucket: product-images (public)');
  }

  // Bank account (merchant's own, shown to buyers on bank transfer)
  const existingBank = await db.from('bank_accounts').select('id').eq('merchant_id', merchantId).limit(1).maybeSingle();
  if (!existingBank.data) {
    const b = await db.from('bank_accounts').insert({
      merchant_id: merchantId, bank_name: 'Meezan Bank', account_title: 'Test Shop',
      account_number: '01234567890123', iban: 'PK00MEZN0001234567890123', is_default: true, is_active: true,
    });
    if (b.error) throw b.error;
    console.log('bank_account: Meezan Bank (default)');
  } else console.log('bank_account: already present');

  // Delivery zone
  const existingZone = await db.from('delivery_zones').select('id').eq('merchant_id', merchantId).limit(1).maybeSingle();
  if (!existingZone.data) {
    const z = await db.from('delivery_zones').insert({
      merchant_id: merchantId, area_name: 'Lahore', city: 'Lahore', charge: 20000, is_serviceable: true, eta_text: '2-3 din',
    });
    if (z.error) throw z.error;
    console.log('delivery_zone: Lahore (Rs 200)');
  } else console.log('delivery_zone: already present');

  console.log('\nseed complete');
}

main().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
