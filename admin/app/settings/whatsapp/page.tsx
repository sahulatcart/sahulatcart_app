'use client';
import { WhatsAppConnect } from '../../../components/WhatsAppConnect';

/** Settings → WhatsApp. The flow itself lives in components/WhatsAppConnect so the onboarding wizard can embed it (a page file may export only the page). */
export default function WhatsAppPage() {
  return <WhatsAppConnect />;
}
