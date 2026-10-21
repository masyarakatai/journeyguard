import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Language } from './types.js';
import { detect, type Detection } from './detect.js';
import { starterConfig, type AlertChoice } from './templates.js';
import { VERSION } from './version.js';

/** Minimal I/O so the wizard can be driven by tests. */
export interface Prompter {
  ask(question: string, fallback?: string): Promise<string>;
  say(message: string): void;
  close(): void;
}

export function terminalPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(question, fallback) {
      const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
      return answer || fallback || '';
    },
    say: (m) => console.log(m),
    close: () => rl.close(),
  };
}

const T = {
  en: {
    welcome: `JourneyGuard ${VERSION} setup. Press Enter to accept the value in [brackets].`,
    url: 'Website address (e.g. https://my-shop.com)',
    badUrl: 'That does not look like a website address. Try again, e.g. https://my-shop.com',
    detecting: 'Looking at the site…',
    detected: (p: string, j: string) => `Found: ${p}. I will check: ${j}.`,
    notReached: (e: string) => `Could not open the site (${e}). I will set up a basic website check; you can add more later.`,
    alerts: 'Where should alerts go?\n  1) Telegram   2) Discord   3) Email   4) Slack   5) Nowhere for now\nChoose',
    tgHelp: 'In Telegram, open @BotFather, send /newbot, follow the steps and copy the token it gives you.',
    tgToken: 'Bot token',
    tgBad: (e: string) => `Telegram did not accept that token (${e}). Try again or press Enter to skip alerts.`,
    tgBot: (n: string) => `Connected to @${n}.`,
    tgSendNow: (n: string) => `Now open @${n} in Telegram (or add it to a group) and send it any message, then press Enter`,
    tgChat: (c: string) => `Found chat: ${c}`,
    tgNoChat: 'No message found yet. Paste the chat ID manually (or press Enter to try again)',
    testSent: 'Test message sent. Check that it arrived.',
    testFailed: (e: string) => `The test message failed (${e}). You can fix the value in .env later and run "journeyguard test-alerts".`,
    dcHelp: 'In Discord: channel settings › Integrations › Webhooks › New webhook › Copy webhook URL.',
    dcUrl: 'Discord webhook URL',
    slHelp: 'Create an incoming webhook at https://api.slack.com/messaging/webhooks and copy its URL.',
    slUrl: 'Slack webhook URL',
    smtp: 'SMTP server as a URL, e.g. smtps://user:password@smtp.example.com:465',
    mailTo: 'Send alerts to (email address)',
    mailFrom: 'Send alerts from (email address)',
    written: (f: string) => `Saved ${f}`,
    keptEnv: (k: string) => `Kept the existing ${k} in .env`,
    password: (p: string) => `Dashboard password: ${p}  (any username; stored in .env)`,
    hello: 'JourneyGuard is connected ✅ You will get a message here when a journey breaks or recovers.',
    next: 'Next steps:',
    nextDocker: 'With Docker:   docker compose up -d   then open http://<server>:8080',
    nextNode: 'With Node.js:  journeyguard run   (one check now)   ·   journeyguard start   (keeps watching)',
  },
  el: {
    welcome: `Ρύθμιση JourneyGuard ${VERSION}. Πάτα Enter για να κρατήσεις την τιμή στις [αγκύλες].`,
    url: 'Διεύθυνση ιστοσελίδας (π.χ. https://to-eshop-mou.gr)',
    badUrl: 'Δεν μοιάζει με διεύθυνση ιστοσελίδας. Δοκίμασε ξανά, π.χ. https://to-eshop-mou.gr',
    detecting: 'Εξετάζω την ιστοσελίδα…',
    detected: (p: string, j: string) => `Βρέθηκε: ${p}. Θα ελέγχω: ${j}.`,
    notReached: (e: string) => `Δεν άνοιξε η ιστοσελίδα (${e}). Ρυθμίζω βασικό έλεγχο· μπορείς να προσθέσεις κι άλλους αργότερα.`,
    alerts: 'Πού να στέλνονται οι ειδοποιήσεις;\n  1) Telegram   2) Discord   3) Email   4) Slack   5) Πουθενά προς το παρόν\nΕπιλογή',
    tgHelp: 'Στο Telegram άνοιξε το @BotFather, στείλε /newbot, ακολούθησε τα βήματα και αντέγραψε το token που θα σου δώσει.',
    tgToken: 'Token του bot',
    tgBad: (e: string) => `Το Telegram δεν δέχτηκε το token (${e}). Δοκίμασε ξανά ή πάτα Enter για να παραλείψεις τις ειδοποιήσεις.`,
    tgBot: (n: string) => `Συνδέθηκε με το @${n}.`,
    tgSendNow: (n: string) => `Τώρα άνοιξε το @${n} στο Telegram (ή πρόσθεσέ το σε ομάδα), στείλε του οποιοδήποτε μήνυμα και πάτα Enter`,
    tgChat: (c: string) => `Βρέθηκε συνομιλία: ${c}`,
    tgNoChat: 'Δεν βρέθηκε μήνυμα ακόμα. Επικόλλησε το chat ID (ή πάτα Enter για νέα προσπάθεια)',
    testSent: 'Στάλθηκε δοκιμαστικό μήνυμα. Έλεγξε ότι έφτασε.',
    testFailed: (e: string) => `Το δοκιμαστικό μήνυμα απέτυχε (${e}). Μπορείς να διορθώσεις την τιμή στο .env και να τρέξεις "journeyguard test-alerts".`,
    dcHelp: 'Στο Discord: ρυθμίσεις καναλιού › Integrations › Webhooks › New webhook › Copy webhook URL.',
    dcUrl: 'Discord webhook URL',
    slHelp: 'Δημιούργησε incoming webhook στο https://api.slack.com/messaging/webhooks και αντέγραψε το URL.',
    slUrl: 'Slack webhook URL',
    smtp: 'Server SMTP ως URL, π.χ. smtps://user:κωδικός@smtp.example.com:465',
    mailTo: 'Αποστολή ειδοποιήσεων στο (email)',
    mailFrom: 'Αποστολέας ειδοποιήσεων (email)',
    written: (f: string) => `Αποθηκεύτηκε το ${f}`,
    keptEnv: (k: string) => `Κράτησα την υπάρχουσα τιμή ${k} στο .env`,
    password: (p: string) => `Κωδικός dashboard: ${p}  (οποιοδήποτε όνομα χρήστη· αποθηκεύτηκε στο .env)`,
    hello: 'Το JourneyGuard συνδέθηκε ✅ Θα λάβεις μήνυμα εδώ όταν μια διαδρομή αποτύχει ή επανέλθει.',
    next: 'Επόμενα βήματα:',
    nextDocker: 'Με Docker:   docker compose up -d   και άνοιξε το http://<server>:8080',
    nextNode: 'Με Node.js:  journeyguard run   (ένας έλεγχος τώρα)   ·   journeyguard start   (συνεχής έλεγχος)',
  },
  es: {
    welcome: `Configuración de JourneyGuard ${VERSION}. Pulsa Enter para aceptar el valor entre [corchetes].`,
    url: 'Dirección del sitio web (por ejemplo, https://mi-tienda.com)',
    badUrl: 'Eso no parece una dirección web. Inténtalo de nuevo, por ejemplo, https://mi-tienda.com',
    detecting: 'Analizando el sitio…',
    detected: (p: string, j: string) => `Encontrado: ${p}. Comprobaré: ${j}.`,
    notReached: (e: string) => `No se pudo abrir el sitio (${e}). Configuraré una comprobación básica del sitio web; puedes añadir más después.`,
    alerts: '¿Dónde deben llegar las alertas?\n  1) Telegram   2) Discord   3) Email   4) Slack   5) En ningún sitio por ahora\nElige',
    tgHelp: 'En Telegram, abre @BotFather, envía /newbot, sigue los pasos y copia el token que te dé.',
    tgToken: 'Token del bot',
    tgBad: (e: string) => `Telegram no aceptó ese token (${e}). Inténtalo de nuevo o pulsa Enter para omitir las alertas.`,
    tgBot: (n: string) => `Conectado a @${n}.`,
    tgSendNow: (n: string) => `Ahora abre @${n} en Telegram (o añádelo a un grupo), envíale cualquier mensaje y pulsa Enter`,
    tgChat: (c: string) => `Chat encontrado: ${c}`,
    tgNoChat: 'Aún no se encontró ningún mensaje. Pega el ID del chat manualmente (o pulsa Enter para volver a intentarlo)',
    testSent: 'Mensaje de prueba enviado. Comprueba que haya llegado.',
    testFailed: (e: string) => `El mensaje de prueba falló (${e}). Puedes corregir el valor en .env y ejecutar "journeyguard test-alerts".`,
    dcHelp: 'En Discord: ajustes del canal › Integraciones › Webhooks › Nuevo webhook › Copiar URL del webhook.',
    dcUrl: 'URL del webhook de Discord',
    slHelp: 'Crea un webhook entrante en https://api.slack.com/messaging/webhooks y copia su URL.',
    slUrl: 'URL del webhook de Slack',
    smtp: 'Servidor SMTP como URL, por ejemplo, smtps://usuario:contraseña@smtp.example.com:465',
    mailTo: 'Enviar alertas a (dirección de email)',
    mailFrom: 'Enviar alertas desde (dirección de email)',
    written: (f: string) => `Guardado ${f}`,
    keptEnv: (k: string) => `Se conservó el ${k} existente en .env`,
    password: (p: string) => `Contraseña del dashboard: ${p}  (cualquier usuario; guardada en .env)`,
    hello: 'JourneyGuard está conectado ✅ Recibirás un mensaje aquí cuando un recorrido falle o se recupere.',
    next: 'Siguientes pasos:',
    nextDocker: 'Con Docker:   docker compose up -d   y abre http://<servidor>:8080',
    nextNode: 'Con Node.js:  journeyguard run   (una comprobación ahora)   ·   journeyguard start   (sigue comprobando)',
  },
};

type Fetch = typeof fetch;

export function normalizeSiteUrl(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return undefined;
    return u.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

async function telegram(fetchImpl: Fetch, token: string, method: string, body?: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as { ok: boolean; result?: unknown; description?: string };
}

/** The most recent chat that wrote to the bot (private chat, group or channel). */
export function latestChat(updates: unknown): { id: string; title: string } | undefined {
  if (!Array.isArray(updates)) return undefined;
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i] as Record<string, { chat?: { id: number; title?: string; username?: string; first_name?: string } } | undefined>;
    const chat = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message)?.chat;
    if (chat) return { id: String(chat.id), title: chat.title ?? chat.username ?? chat.first_name ?? String(chat.id) };
  }
  return undefined;
}

async function postJson(fetchImpl: Fetch, url: string, body: unknown): Promise<void> {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function askAlerts(p: Prompter, t: (typeof T)['en'], fetchImpl: Fetch): Promise<AlertChoice | undefined> {
  const choice = (await p.ask(t.alerts, '1')).trim();
  const hello = t.hello;

  if (choice === '1') {
    p.say(t.tgHelp);
    for (;;) {
      const token = (await p.ask(t.tgToken)).trim();
      if (!token) return undefined;
      let me;
      try {
        me = await telegram(fetchImpl, token, 'getMe');
      } catch (e) {
        p.say(t.tgBad((e as Error).message));
        continue;
      }
      if (!me.ok) {
        p.say(t.tgBad(me.description ?? 'invalid token'));
        continue;
      }
      const botName = (me.result as { username?: string })?.username ?? 'your_bot';
      p.say(t.tgBot(botName));
      let chatId = '';
      while (!chatId) {
        await p.ask(t.tgSendNow(botName));
        const updates = await telegram(fetchImpl, token, 'getUpdates').catch(() => ({ ok: false, result: [] }));
        const chat = latestChat(updates.result);
        if (chat) {
          p.say(t.tgChat(chat.title));
          chatId = chat.id;
        } else {
          chatId = (await p.ask(t.tgNoChat)).trim();
        }
      }
      try {
        const sent = await telegram(fetchImpl, token, 'sendMessage', { chat_id: chatId, text: hello });
        p.say(sent.ok ? t.testSent : t.testFailed(sent.description ?? 'error'));
      } catch (e) {
        p.say(t.testFailed((e as Error).message));
      }
      return { type: 'telegram', env: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } };
    }
  }

  if (choice === '2' || choice === '4') {
    const discord = choice === '2';
    p.say(discord ? t.dcHelp : t.slHelp);
    const url = (await p.ask(discord ? t.dcUrl : t.slUrl)).trim();
    if (!/^https:\/\//.test(url)) return undefined;
    try {
      await postJson(fetchImpl, url, discord ? { username: 'JourneyGuard', content: hello } : { text: hello });
      p.say(t.testSent);
    } catch (e) {
      p.say(t.testFailed((e as Error).message));
    }
    return discord ? { type: 'discord', env: { DISCORD_WEBHOOK_URL: url } } : { type: 'slack', env: { SLACK_WEBHOOK_URL: url } };
  }

  if (choice === '3') {
    const smtp = (await p.ask(t.smtp)).trim();
    const to = (await p.ask(t.mailTo)).trim();
    const from = (await p.ask(t.mailFrom, to)).trim();
    if (!smtp || !to) return undefined;
    return { type: 'email', env: { SMTP_URL: smtp, ALERT_EMAIL_TO: to, ALERT_EMAIL_FROM: from || to } };
  }
  return undefined;
}

function parseEnv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) map.set(m[1]!, m[2]!);
  }
  return map;
}

function envLine(key: string, value: string): string {
  // Quote values that docker compose or shells would otherwise split or interpret.
  return /^[A-Za-z0-9_./:@+-]*$/.test(value) ? `${key}=${value}` : `${key}='${value.replace(/'/g, "'\\''")}'`;
}

/** Writes or extends .env without ever overwriting values that are already there. */
export async function writeEnv(file: string, values: Record<string, string>, say: (m: string) => void, msg: (typeof T)['en']): Promise<Record<string, string>> {
  const existing = existsSync(file) ? await readFile(file, 'utf8') : '';
  const current = parseEnv(existing);
  const added: string[] = [];
  const effective: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (current.has(key)) {
      say(msg.keptEnv(key));
      effective[key] = current.get(key)!.replace(/^'(.*)'$/, '$1');
      continue;
    }
    added.push(envLine(key, value));
    effective[key] = value;
  }
  if (added.length) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    const header = existing ? '' : '# Secrets for JourneyGuard. Keep this file private.\n';
    await writeFile(file, `${existing}${prefix}${header}${added.join('\n')}\n`);
  }
  await chmod(file, 0o600).catch(() => undefined);
  return effective;
}

export interface SetupOptions {
  configFile: string;
  url?: string;
  interactive: boolean;
  prompter?: Prompter;
  fetchImpl?: Fetch;
  language?: Language;
}

export interface SetupResult {
  configFile: string;
  envFile: string;
  url: string;
  detection?: Detection;
  alert?: AlertChoice;
  password: string;
}

/** `journeyguard init`: ask a few questions (or use defaults), then write journeyguard.yml and .env. */
export async function runSetup(opts: SetupOptions): Promise<SetupResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const p = opts.prompter ?? (opts.interactive ? terminalPrompter() : undefined);
  try {
    let lang: Language = opts.language ?? 'en';
    if (p && opts.interactive && !opts.language) {
      const l = (await p.ask('Language / Γλώσσα / Idioma: 1) English  2) Ελληνικά  3) Español', '1')).trim();
      lang = l === '2' || /^el|^gr|ελλ/i.test(l) ? 'el' : l === '3' || /^es|^spa|^cast/i.test(l) ? 'es' : 'en';
    }
    const t = T[lang];
    if (p && opts.interactive) p.say(t.welcome);

    let url = opts.url ? normalizeSiteUrl(opts.url) : undefined;
    while (!url && p && opts.interactive) {
      url = normalizeSiteUrl(await p.ask(t.url));
      if (!url) p.say(t.badUrl);
    }
    url ??= 'https://example.com';

    let detection: Detection | undefined;
    if (url !== 'https://example.com') {
      p?.say(t.detecting);
      try {
        detection = await detect(url);
        url = new URL(detection.url).origin;
        p?.say(t.detected(detection.platform, detection.journeys.map((j) => j.preset).join(', ')));
      } catch (e) {
        p?.say(t.notReached((e as Error).message));
      }
    }

    const alert = p && opts.interactive ? await askAlerts(p, t, fetchImpl) : undefined;
    const name = new URL(url).hostname.replace(/^www\./, '');
    await writeFile(opts.configFile, starterConfig(name, url, detection, { language: lang, alert }));
    p?.say(t.written(opts.configFile));

    const envFile = path.join(path.dirname(opts.configFile), '.env');
    const env = await writeEnv(envFile, { JOURNEYGUARD_PASSWORD: randomBytes(12).toString('hex'), ...(alert?.env ?? {}) }, (m) => p?.say(m), t);
    p?.say(t.written(envFile));
    p?.say(t.password(env.JOURNEYGUARD_PASSWORD!));
    p?.say(`\n${t.next}\n  ${t.nextDocker}\n  ${t.nextNode}`);
    return { configFile: opts.configFile, envFile, url, detection, alert, password: env.JOURNEYGUARD_PASSWORD! };
  } finally {
    if (!opts.prompter) p?.close();
  }
}
