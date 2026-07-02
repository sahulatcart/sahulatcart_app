import PDFDocument from 'pdfkit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import type { DeliveryInfo } from './order-service';

const rs = (paisa: number): string => `Rs ${Math.round(paisa / 100).toLocaleString('en-PK')}`;

export interface SlipData {
  orderNumber: string;
  businessName: string;
  items: { name: string; qty: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  delivery: DeliveryInfo;
  paymentLabel: string;
}

/** Render an order slip as a PDF buffer (pdfkit — no headless browser needed). */
export function generateSlipPdf(d: SlipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#0f766e').text(d.businessName);
    doc.fontSize(10).fillColor('#666').text(`Order ${d.orderNumber}`);
    doc.moveTo(36, doc.y + 6).lineTo(384, doc.y + 6).strokeColor('#e5e7eb').stroke();
    doc.moveDown();

    doc.fillColor('#111').fontSize(11);
    for (const it of d.items) {
      doc.text(`${it.name}  x${it.qty}`, { continued: true }).text(rs(it.lineTotal), { align: 'right' });
    }
    doc.moveDown(0.5);
    if (d.discount > 0) doc.fillColor('#666').text('Discount', { continued: true }).text(`- ${rs(d.discount)}`, { align: 'right' });
    doc.fillColor('#666').text('Delivery', { continued: true }).text(d.deliveryCharge ? rs(d.deliveryCharge) : 'Free', { align: 'right' });
    doc.fillColor('#111').fontSize(14).text('Total', { continued: true }).text(rs(d.total), { align: 'right' });
    doc.moveDown();

    doc.fontSize(10).fillColor('#666').text('Deliver to');
    doc.fillColor('#111').text(d.delivery.name ?? '');
    doc.text(`${d.delivery.address ?? ''}${d.delivery.area ? ', ' + d.delivery.area : ''}${d.delivery.city ? ', ' + d.delivery.city : ''}`);
    doc.text(`Phone: ${d.delivery.phone ?? ''}`);
    doc.moveDown(0.5);
    doc.fillColor('#0f766e').text(`Payment: ${d.paymentLabel}`);
    doc.end();
  });
}

/** Store a slip PDF in the private order-slips bucket. Returns the storage key. */
export async function uploadSlip(db: SupabaseClient, merchantId: string, orderId: string, pdf: Buffer): Promise<string | null> {
  const cfg = loadConfig();
  const key = `${merchantId}/${orderId}.pdf`;
  const { error } = await db.storage.from(cfg.STORAGE_BUCKET_ORDER_SLIPS).upload(key, pdf, { contentType: 'application/pdf', upsert: true });
  if (error) {
    logger.error({ err: error.message }, 'slip upload failed');
    return null;
  }
  return key;
}

export async function signedSlipUrl(db: SupabaseClient, key: string, expiresSec = 3600): Promise<string | null> {
  const cfg = loadConfig();
  const { data } = await db.storage.from(cfg.STORAGE_BUCKET_ORDER_SLIPS).createSignedUrl(key, expiresSec);
  return data?.signedUrl ?? null;
}
