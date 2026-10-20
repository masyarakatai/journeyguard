import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { latestChat, normalizeSiteUrl, runSetup, type Prompter } from '../src/setup.js';
import { loadConfig } from '../src/config.js';
import { startDemoShop, type DemoShop } from '../src/demo/shop.js';

let shop: DemoShop;
let dir: string;

before(async () => {
  shop = await startDemoShop();
  dir = await mkdtemp(path.join(os.tmpdir(), 'jg-setup-'));
});

after(async () => {
  await shop.close();
  await rm(dir, { recursive: true, force: true });
});

function scripted(answers: string[]): Prompter & { said: string[]; asked: string[] } {
  const said: string[] = [];
  const asked: string[] = [];
  return {
    said,
    asked,
    async ask(question, fallback) {
      asked.push(question);
      const next = answers.shift();
      return next === undefined || next === '' ? (fallback ?? '') : next;
    },
    say: (m) => said.push(m),
    close: () => undefined,
  };
}

function envOf(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1]!, m[2]!.replace(/^'(.*)'$/, '$1')]),
  );
}

test('normalizeSiteUrl adds https and rejects junk', () => {
  assert.equal(normalizeSiteUrl('my-shop.gr'), 'https://my-shop.gr');
  assert.equal(normalizeSiteUrl('http://shop.example.com/'), 'http://shop.example.com');
  assert.equal(normalizeSiteUrl('hello'), undefined);
  assert.equal(normalizeSiteUrl(''), undefined);
});

test('latestChat finds the most recent chat in Telegram updates', () => {
  const updates = [{ message: { chat: { id: 1, first_name: 'Old' } } }, { my_chat_member: { chat: { id: -100, title: 'Shop alerts' } } }];
  assert.deepEqual(latestChat(updates), { id: '-100', title: 'Shop alerts' });
  assert.equal(latestChat([]), undefined);
});

test('guided setup in Greek with Telegram writes a working config and .env', async () => {
  const sub = path.join(dir, 'tg');
  await (await import('node:fs/promises')).mkdir(sub);
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u.replace(/bot[^/]+/, 'bot***'));
    if (u.endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { username: 'aegean_alerts_bot' } }));
    if (u.endsWith('/getUpdates')) return new Response(JSON.stringify({ ok: true, result: [{ update_id: 7, message: { chat: { id: 4242, first_name: 'Nikos' } } }] }));
    if (u.endsWith('/sendMessage')) {
      assert.match(String(init?.body), /"chat_id":"4242"/);
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const p = scripted(['2', '1', '123456:ABCDEF', '']);
  const result = await runSetup({ configFile: path.join(sub, 'journeyguard.yml'), url: shop.url, interactive: true, prompter: p, fetchImpl: fakeFetch });

  assert.equal(result.detection?.platform, 'woocommerce');
  assert.deepEqual(calls, ['https://api.telegram.org/bot***/getMe', 'https://api.telegram.org/bot***/getUpdates', 'https://api.telegram.org/bot***/sendMessage']);
  assert.ok(p.said.some((m) => m.includes('@aegean_alerts_bot')));

  const env = envOf(await readFile(result.envFile, 'utf8'));
  assert.equal(env.TELEGRAM_BOT_TOKEN, '123456:ABCDEF');
  assert.equal(env.TELEGRAM_CHAT_ID, '4242');
  assert.match(env.JOURNEYGUARD_PASSWORD!, /^[0-9a-f]{24}$/);
  assert.equal((await stat(result.envFile)).mode & 0o777, 0o600);

  const config = await loadConfig(result.configFile, env);
  assert.equal(config.settings.language, 'el');
  assert.equal(config.settings.dashboard.password, env.JOURNEYGUARD_PASSWORD);
  assert.deepEqual(config.alerts[0], { type: 'telegram', botToken: '123456:ABCDEF', chatId: '4242' });
  assert.deepEqual(
    config.sites[0]!.journeys.map((j) => j.preset),
    ['website', 'woocommerce', 'contact-form'],
  );
});

test('setup without a terminal uses defaults and never overwrites existing secrets', async () => {
  const sub = path.join(dir, 'quiet');
  await (await import('node:fs/promises')).mkdir(sub);
  await writeFile(path.join(sub, '.env'), 'JOURNEYGUARD_PASSWORD=keep-this-password\nOTHER=1');
  const lines: string[] = [];
  const result = await runSetup({
    configFile: path.join(sub, 'journeyguard.yml'),
    url: shop.url,
    interactive: false,
    prompter: { ask: async (_q, f) => f ?? '', say: (m) => lines.push(m), close: () => undefined },
  });
  assert.equal(result.password, 'keep-this-password');
  const env = await readFile(result.envFile, 'utf8');
  assert.match(env, /^JOURNEYGUARD_PASSWORD=keep-this-password$/m);
  assert.match(env, /^OTHER=1$/m);
  const config = await loadConfig(result.configFile, envOf(env));
  assert.equal(config.alerts.length, 0);
  assert.equal(config.settings.language, 'en');
});
