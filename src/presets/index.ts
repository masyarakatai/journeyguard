import { contactFormPreset } from './contact-form.js';
import type { PresetBuilder } from './options.js';
import { shopifyPreset } from './shopify.js';
import { websitePreset } from './website.js';
import { woocommercePreset } from './woocommerce.js';

export type { PresetBuilder, PresetJourney } from './options.js';

export const PRESETS: Record<string, PresetBuilder> = {
  website: websitePreset,
  woocommerce: woocommercePreset,
  shopify: shopifyPreset,
  'contact-form': contactFormPreset,
};

export const PRESET_NAMES = Object.keys(PRESETS);
