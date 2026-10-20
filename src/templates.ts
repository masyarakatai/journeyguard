import { stringify } from 'yaml';
import type { Detection } from './detect.js';
import type { Language } from './types.js';

export interface AlertChoice {
  type: 'telegram' | 'discord' | 'slack' | 'email';
  /** Secrets written to .env; the YAML only references them. */
  env: Record<string, string>;
}

const ALERT_YAML: Record<AlertChoice['type'], string> = {
  telegram: `  - type: telegram
    botToken: \${TELEGRAM_BOT_TOKEN}
    chatId: \${TELEGRAM_CHAT_ID}`,
  discord: `  - type: discord
    webhookUrl: \${DISCORD_WEBHOOK_URL}`,
  slack: `  - type: slack
    webhookUrl: \${SLACK_WEBHOOK_URL}`,
  email: `  - type: email
    smtp: \${SMTP_URL}
    from: \${ALERT_EMAIL_FROM}
    to: \${ALERT_EMAIL_TO}`,
};

const ALERT_EXAMPLES = `alerts: []
#  - type: telegram
#    botToken: \${TELEGRAM_BOT_TOKEN}
#    chatId: \${TELEGRAM_CHAT_ID}
#  - type: discord
#    webhookUrl: \${DISCORD_WEBHOOK_URL}
#  - type: slack
#    webhookUrl: \${SLACK_WEBHOOK_URL}
#  - type: email
#    smtp: \${SMTP_URL}    # smtp://user:pass@smtp.example.com:587
#    from: monitor@example.com
#    to: [owner@example.com]`;

/** The commented starter file written by `journeyguard init`. */
export function starterConfig(
  siteName: string,
  url: string,
  detection?: Detection,
  opts: { language?: Language; alert?: AlertChoice } = {},
): string {
  const journeys = stringify(detection?.journeys ?? [{ preset: 'website' }])
    .trimEnd()
    .split('\n')
    .map((l) => `      ${l}`)
    .join('\n');
  const notes: string[] = [];
  if (detection) {
    notes.push(`# Detected platform: ${detection.platform}${detection.signals.length ? ` (${detection.signals.join(', ')})` : ''}`);
    if (detection.cdn) notes.push(`# ${detection.cdn} detected: allow-list the "X-JourneyGuard: 1" header if checks get blocked.`);
    if (detection.captcha) notes.push(`# ${detection.captcha} detected: forms with a visible CAPTCHA are reported as "not tested".`);
  }

  return `# JourneyGuard configuration
# Docs: https://github.com/nxdpro/journeyguard/blob/main/docs/configuration.md
${notes.join('\n')}${notes.length ? '\n' : ''}
settings:
  interval: 15m          # how often journeys run (contact forms default to 24h)
  timeout: 30s           # max wait per step
  retries: 1             # re-run once before declaring a failure
  safeMode: true         # never click "place order" / "pay" buttons
  language: ${opts.language ?? 'en'}           # en | el  (reports and alerts)
  dataDir: ./journeyguard-data
  dashboard:
    host: 127.0.0.1      # the Docker image listens on all interfaces automatically
    port: 8080
    password: \${JOURNEYGUARD_PASSWORD}   # kept in .env
    # publicUrl: https://monitor.example.com

# Alerts fire only when a journey breaks or recovers. Secrets live in .env.
${opts.alert ? `alerts:\n${ALERT_YAML[opts.alert.type]}` : ALERT_EXAMPLES}

sites:
  - name: ${JSON.stringify(siteName)}
    url: ${url}
    journeys:
${journeys}
`;
}
