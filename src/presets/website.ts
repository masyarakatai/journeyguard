import type { Stage } from '../types.js';
import { gotoUrl } from '../steps.js';
import { noBrokenAssets, noFatalErrors, recordLoadTime, sslCertificateStep } from './common.js';
import { label, optBool, optNum, optStrings, type PresetBuilder } from './options.js';

/**
 * Basic health of any website: the homepage renders without error pages or broken
 * scripts, key pages open, and the SSL certificate is not about to expire.
 */
export const websitePreset: PresetBuilder = (options, { lang }) => {
  const pages = optStrings(options, 'pages');
  const stages: Stage[] = [
    {
      name: label(lang, 'homepage'),
      steps: [
        { name: 'Homepage opens', goto: '/' },
        noFatalErrors(),
        recordLoadTime('homepageLoadMs'),
        noBrokenAssets(),
      ],
    },
  ];
  if (pages.length) {
    stages.push({
      name: label(lang, 'keyPages'),
      steps: pages.flatMap((p) => [
        { name: `${p} opens`, custom: (ctx) => gotoUrl(ctx, p, ctx.timeoutMs) },
        { ...noFatalErrors(), name: `${p} has no error` },
      ]),
    });
  }
  if (optBool(options, 'ssl', true)) {
    stages.push({ name: label(lang, 'ssl'), steps: [sslCertificateStep(optNum(options, 'sslMinDays', 14))] });
  }
  return { name: label(lang, 'websiteJourney'), stages };
};
