import type { Language, Stage } from '../types.js';

export interface PresetJourney {
  name: string;
  stages: Stage[];
  /** Suggested check interval when the user does not set one (e.g. forms send real emails). */
  defaultInterval?: string;
  /** Suggested retries; journeys that send real messages use 0 so a failure never sends twice. */
  defaultRetries?: number;
}

export type PresetBuilder = (options: Record<string, unknown>, site: { name: string; url: string; lang: Language }) => PresetJourney;

export function optStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function optBool(o: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = o[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

export function optNum(o: Record<string, unknown>, key: string, fallback: number): number {
  const v = Number(o[key]);
  return Number.isFinite(v) && o[key] !== undefined ? v : fallback;
}

export function optStrings(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return [v];
  return [];
}

export function optRecord(o: Record<string, unknown>, key: string): Record<string, string> {
  const v = o[key];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, String(val)]));
}

const LABELS = {
  website: ['Website', 'Ιστοσελίδα', 'Sitio web'],
  homepage: ['Homepage', 'Αρχική σελίδα', 'Página de inicio'],
  keyPages: ['Key pages', 'Βασικές σελίδες', 'Páginas principales'],
  ssl: ['SSL certificate', 'Πιστοποιητικό SSL', 'Certificado SSL'],
  products: ['Products', 'Προϊόντα', 'Productos'],
  addToCart: ['Add to cart', 'Καλάθι', 'Añadir al carrito'],
  checkout: ['Checkout', 'Ταμείο', 'Proceso de compra'],
  payment: ['Payment', 'Πληρωμή', 'Pago'],
  placeOrder: ['Place order', 'Υποβολή παραγγελίας', 'Realizar pedido'],
  contactPage: ['Contact page', 'Σελίδα επικοινωνίας', 'Página de contacto'],
  submitForm: ['Submit form', 'Αποστολή φόρμας', 'Enviar formulario'],
  fillForm: ['Fill in form (not sent)', 'Συμπλήρωση φόρμας (χωρίς αποστολή)', 'Rellenar formulario (sin enviar)'],
  emailDelivered: ['Email delivered', 'Παράδοση email', 'Correo entregado'],
  websiteJourney: ['Website health', 'Υγεία ιστοσελίδας', 'Estado del sitio web'],
  wooJourney: ['Shop checkout (WooCommerce)', 'Αγορά από το eShop (WooCommerce)', 'Compra en la tienda (WooCommerce)'],
  shopifyJourney: ['Shop checkout (Shopify)', 'Αγορά από το eShop (Shopify)', 'Compra en la tienda (Shopify)'],
  contactJourney: ['Contact form', 'Φόρμα επικοινωνίας', 'Formulario de contacto'],
  safeMode: [
    'Safe mode: JourneyGuard never submits real orders or payments',
    'Ασφαλής λειτουργία: το JourneyGuard δεν υποβάλλει ποτέ πραγματικές παραγγελίες ή πληρωμές',
    'Modo seguro: JourneyGuard nunca envía pedidos ni pagos reales',
  ],
  paymentDisabled: ['Disabled in options (payment: false)', 'Απενεργοποιημένο στις ρυθμίσεις (payment: false)', 'Desactivado en las opciones (payment: false)'],
  imapLater: ['Inbox verification (IMAP) is planned for v0.2', 'Ο έλεγχος παράδοσης στα εισερχόμενα (IMAP) έρχεται στην έκδοση 0.2', 'La verificación de la bandeja de entrada (IMAP) está prevista para la v0.2'],
  submitDisabled: ['Sending is turned off (submit: false)', 'Η αποστολή είναι απενεργοποιημένη (submit: false)', 'El envío está desactivado (submit: false)'],
} as const;

/** Stage and journey names in the configured language, so reports read naturally. */
export function label(lang: Language, key: keyof typeof LABELS): string {
  return LABELS[key][lang === 'el' ? 1 : lang === 'es' ? 2 : 0];
}
