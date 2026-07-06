import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';
import { isShopifyCsv, mapShopifyRows } from './shopify';

// Realistic Shopify export shape: one row per variant, image rows with empty variants,
// quoted multiline HTML body.
const SHOPIFY_CSV = `Handle,Title,Body (HTML),Vendor,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Inventory Qty,Variant Price,Image Src
classic-tee,Classic Tee,"<p>Pure cotton.<br>Best for summer.</p>
<p>Made in Pakistan.</p>",Ali Garments,Size,S,Color,Black,TEE-S-BLK,10,2499.50,https://cdn.shopify.com/tee-black.jpg
classic-tee,,,,Size,M,Color,Black,TEE-M-BLK,5,2600,https://cdn.shopify.com/tee-black.jpg
classic-tee,,,,Size,M,Color,White,TEE-M-WHT,0,2600,https://cdn.shopify.com/tee-white.jpg
classic-tee,,,,,,,,,,,https://cdn.shopify.com/tee-detail.jpg
plain-mug,Plain Mug,<p>Ceramic mug</p>,Ali Garments,Title,Default Title,,,MUG-1,100,799,https://cdn.shopify.com/mug.jpg
free-sticker,Free Sticker,,,Title,Default Title,,,STICK-1,50,0,
`;

describe('shopify import mapping', () => {
  const rows = parseCsv(SHOPIFY_CSV);

  it('detects a Shopify export by headers', () => {
    expect(isShopifyCsv(rows)).toBe(true);
    expect(isShopifyCsv(parseCsv('name,price\nT-Shirt,2500'))).toBe(false);
  });

  it('groups variants by handle into one product', () => {
    const products = mapShopifyRows(rows);
    expect(products.map((p) => p.name)).toEqual(['Classic Tee', 'Plain Mug']); // sticker dropped (price 0)
  });

  it('takes the CHEAPEST variant price, preserving paisa', () => {
    const tee = mapShopifyRows(rows)[0]!;
    expect(tee.price).toBe(249950); // Rs 2,499.50 → paisa, decimals kept
  });

  it('sums variant stock and keeps the first SKU', () => {
    const tee = mapShopifyRows(rows)[0]!;
    expect(tee.stock).toBe(15); // 10 + 5 + 0
    expect(tee.sku).toBe('TEE-S-BLK');
  });

  it('collects distinct image URLs including image-only rows', () => {
    const tee = mapShopifyRows(rows)[0]!;
    expect(tee.images).toEqual([
      'https://cdn.shopify.com/tee-black.jpg',
      'https://cdn.shopify.com/tee-white.jpg',
      'https://cdn.shopify.com/tee-detail.jpg',
    ]);
  });

  it('aggregates options into attributes, skipping Default Title', () => {
    const [tee, mug] = mapShopifyRows(rows);
    expect(tee!.attributes).toEqual({ Size: ['S', 'M'], Color: ['Black', 'White'] });
    expect(mug!.attributes).toEqual({});
  });

  it('strips HTML from the body across quoted newlines', () => {
    const tee = mapShopifyRows(rows)[0]!;
    expect(tee.description).toContain('Pure cotton.');
    expect(tee.description).toContain('Made in Pakistan.');
    expect(tee.description).not.toContain('<p>');
  });
});
