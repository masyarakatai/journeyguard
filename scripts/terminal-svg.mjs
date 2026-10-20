// Writes docs/assets/demo.svg: an animated terminal replaying `journeyguard demo` (output abridged).
import { writeFileSync } from 'node:fs';

const C = { fg: '#e6edf3', dim: '#8b949e', green: '#3fb950', red: '#f85149', cyan: '#58a6ff', yellow: '#d29922' };
// Each line: [delaySeconds, [[text, color, bold?], ...]]
const L = (delay, ...segs) => [delay, segs];
const lines = [
  L(0, ['$ ', C.green], ['journeyguard demo', C.fg, true]),
  L(1.6, ['JourneyGuard demo', C.fg, true], [' · demo shop running at ', C.fg], ['http://127.0.0.1:4100', C.cyan]),
  L(2.0),
  L(2.2, ['1) The shop is healthy:', C.fg, true]),
  L(2.9, ['Aegean Coffee Co.', C.fg, true], [' › Shop checkout (WooCommerce)  ', C.fg], ['PASSED', C.green, true], ['  1.6s', C.dim]),
  L(3.1, ['  ✔ ', C.green], ['Website', C.fg]),
  L(3.3, ['  ✔ ', C.green], ['Products', C.fg]),
  L(3.5, ['  ✔ ', C.green], ['Add to cart', C.fg]),
  L(3.7, ['  ✔ ', C.green], ['Checkout', C.fg]),
  L(3.9, ['  ✔ ', C.green], ['Payment', C.fg]),
  L(4.1, ['  ○ Place order — not tested (safe mode never submits real orders)', C.dim]),
  L(4.6),
  L(4.8, ['2) Now we break it — what an owner normally never notices:', C.fg, true]),
  L(5.8, ['Aegean Coffee Co.', C.fg, true], [' › Shop checkout (WooCommerce)  ', C.fg], ['FAILED', C.red, true], ['  485ms', C.dim]),
  L(6.0, ['  ✔ ', C.green], ['Website', C.fg]),
  L(6.2, ['  ✔ ', C.green], ['Products', C.fg]),
  L(6.4, ['  ✔ ', C.green], ['Add to cart', C.fg]),
  L(6.8, ['  ✖ ', C.red], ['Checkout', C.fg], [' — ', C.dim], ['HTTP 500 on /checkout/', C.red]),
  L(7.0, ['  ○ Payment — not tested (Checkout failed)', C.dim]),
  L(7.6, ['  → ', C.red], ['PHP/WordPress fatal error', C.fg, true]),
  L(7.8, ['    Usually a plugin or theme update. Check the PHP error log and recent updates.', C.dim]),
  L(8.2, ['  Screenshot: ', C.dim], ['runs/aegean-coffee-co/woocommerce/…/failure.png', C.fg]),
  L(8.6),
  L(8.8, ['Dashboard: ', C.fg, true], ['http://localhost:8080', C.cyan]),
];

const T = 15; // seconds per loop
const W = 860;
const LH = 22;
const TOP = 52;
const H = TOP + lines.length * LH + 20;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (s) => ((s / T) * 100).toFixed(2);

let css = '';
let body = '';
lines.forEach(([delay, segs], i) => {
  if (!segs.length) return;
  const a = Number(pct(delay));
  css += `@keyframes k${i}{0%,${a}%{opacity:0}${(a + 1).toFixed(2)}%,97%{opacity:1}100%{opacity:0}}#l${i}{animation:k${i} ${T}s infinite}`;
  const spans = segs.map(([t, c, b]) => `<tspan fill="${c}"${b ? ' font-weight="700"' : ''}>${esc(t)}</tspan>`).join('');
  body += `<text id="l${i}" x="24" y="${TOP + i * LH}" xml:space="preserve">${spans}</text>`;
});
// Typing effect for the command: a cover that slides off in steps.
css += `@keyframes type{0%{transform:translateX(0)}2%{transform:translateX(0)}9%,100%{transform:translateX(200px)}}#cover{animation:type ${T}s steps(17,end) infinite}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Terminal: journeyguard demo checks a healthy shop, then catches a broken checkout with a plain-language diagnosis">
<style>text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}${css}@media (prefers-reduced-motion:reduce){text,#cover{animation:none!important;opacity:1!important;transform:none!important}}</style>
<rect width="${W}" height="${H}" rx="12" fill="#0d1117"/>
<rect width="${W}" height="34" rx="12" fill="#161b22"/><rect y="22" width="${W}" height="12" fill="#161b22"/>
<circle cx="22" cy="17" r="6" fill="#ff5f57"/><circle cx="42" cy="17" r="6" fill="#febc2e"/><circle cx="62" cy="17" r="6" fill="#28c840"/>
<text x="${W / 2}" y="22" fill="#8b949e" text-anchor="middle" style="font-size:12px">journeyguard demo</text>
${body}
<rect id="cover" x="42" y="${TOP - 15}" width="200" height="20" fill="#0d1117"/>
</svg>
`;
writeFileSync('docs/assets/demo.svg', svg);
console.log(`docs/assets/demo.svg written (${svg.length} bytes, ${lines.length} lines)`);
