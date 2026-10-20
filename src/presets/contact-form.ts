import type { Locator } from 'playwright';
import type { Step, StepContext } from '../types.js';
import { gotoUrl, NotTestedError, safeClick, StepError } from '../steps.js';
import { ANTI_BOT_TEXT, noFatalErrors, pageText, plain } from './common.js';
import { label, optBool, optRecord, optStr, type PresetBuilder } from './options.js';

/** The form JourneyGuard picked on this page is tagged so later steps use exactly the same one. */
const PICKED = 'form[data-journeyguard-form]';
/** Widgets a person has to interact with. Invisible reCAPTCHA v3 / invisible hCaptcha do not count. */
const INTERACTIVE_CAPTCHA =
  'iframe[src*="recaptcha"][src*="anchor"]:not([src*="size=invisible"]), iframe[src*="hcaptcha.com"]:not([src*="size=invisible"]), iframe[src*="challenges.cloudflare.com"], input.et_pb_contact_captcha';
const SUCCESS_MARKERS = [
  'form.wpcf7-form.sent',
  '.wpcf7-mail-sent-ok',
  '.wpforms-confirmation-container',
  '.wpforms-confirmation-container-full',
  '.gform_confirmation_message',
  '.elementor-message-success',
  '.ff-message-success',
  '.nf-response-msg',
  '[data-journeyguard="success"]',
];
/**
 * The site accepted the message but could not send it: the outage this preset exists to catch.
 * WPForms, Elementor and Divi use the same box for input and anti-spam errors, so its text decides.
 */
const SEND_FAILURE_MARKERS = [
  'form.wpcf7-form.failed',
  'form.wpcf7-form.aborted',
  '.wpcf7-mail-sent-ng',
  '.wpforms-error-container',
  '.elementor-message-danger',
  '.et-pb-contact-message ul',
];
/** Anti-spam rejected the test. Contact Form 7 shows the same text as a mail failure, so the class decides. */
const SPAM_MARKERS = ['form.wpcf7-form.spam', '.wpcf7-spam-blocked'];
/** The form rejected our input (a required field we could not guess): our test is incomplete, not the site. */
const VALIDATION_MARKERS = [
  'form.wpcf7-form.invalid',
  'form.wpcf7-form.unaccepted',
  '.wpcf7-validation-errors',
  '.gform_validation_errors',
  'label.wpforms-error',
  '.nf-error-msg',
  '.ff-el-is-error',
  '.elementor-field-group.elementor-error',
  '.et_contact_error',
];
const RESPONSE_OUTPUT = '.wpcf7-response-output, .wpforms-error-container, .elementor-message, .gform_validation_errors, .nf-error-msg, .et-pb-contact-message';
/** Wording of an input error inside a shared error box (matched against plain() text). */
const VALIDATION_TEXT = /required|invalid|please (?:fill|enter|complete|correct|check|see the errors)|fill in the following|form is invalid|υποχρεωτικ|μη εγκυρ|συμπληρωστε|ελεγξτε τα πεδια/;
const SUCCESS_TEXT =
  /thank you|thanks for (contacting|your message|getting in touch)|message (was|has been) sent|we('ll| will) (be in touch|get back)|ευχαριστούμε|το μήνυμά σας (στάλθηκε|εστάλη|έχει σταλεί|ελήφθη)|θα επικοινωνήσουμε/gi;
const FAILURE_TEXT =
  /error (occurred )?(while )?trying to send your message|failed to send|could not be sent|message was not sent|σφάλμα κατά την αποστολή|δεν ήταν δυνατή η αποστολή|το μήνυμα δεν (στάλθηκε|εστάλη)/i;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** The first line of the page that newly matches the anti-bot wording, for the report. */
function antiBotLine(after: string, before: string): string | undefined {
  if (countMatches(plain(after), ANTI_BOT_TEXT) <= countMatches(plain(before), ANTI_BOT_TEXT)) return undefined;
  const seen = new Set(before.split('\n').map((l) => l.trim()));
  const line = after.split('\n').map((l) => l.trim()).find((l) => !seen.has(l) && countMatches(plain(l), ANTI_BOT_TEXT) > 0);
  return (line ?? 'anti-spam check').slice(0, 160);
}

function antiBotError(line: string): NotTestedError {
  return new NotTestedError(
    `The form's anti-spam or anti-robot check rejected the test ("${line}"), so nothing was sent. Allow-list the monitor (X-JourneyGuard header or its IP address), or set submit: false. Send one message by hand to make sure real visitors are not blocked too.`,
  );
}

async function anyVisible(loc: Locator): Promise<Locator | undefined> {
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
  return undefined;
}

/**
 * Picks the real contact form: visible, with an email field or a message box, more than a single
 * input (that would be a newsletter or search box), not a login form, preferably in the main content.
 */
async function pickForm(ctx: StepContext): Promise<string | undefined> {
  return ctx.page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    // Forms that collect something other than a message: comments, reviews, search, log-in, the shop.
    const NOT_CONTACT =
      '#commentform, .comment-form, #review_form form, [role=search], .search-form, .searchform, form.checkout, .woocommerce-checkout, .woocommerce-cart-form, form.cart, .variations_form, .woocommerce-form-login, .woocommerce-form-register, .woocommerce-form-coupon, .woocommerce-ResetPassword';
    const NOT_CONTACT_ACTION = /wp-comments-post|wp-login|[?&]s=|\/search|\/cart|\/checkout|\/my-account/i;
    const CONTACT_PLUGIN =
      '.wpcf7-form, .wpforms-form, [id^=gform_], .elementor-form, .nf-form-layout form, .frm-show-form, .frm-fluent-form, .fluent_form, .et_pb_contact_form, .forminator-custom-form, .hs-form, [class*=contact], [id*=contact]';
    const NEWSLETTER = '.mc4wp-form, #mc-embedded-subscribe-form, .mailpoet_form, .sib_signup_form, .klaviyo-form, [class*=newsletter], [class*=subscribe]';
    const forms = Array.from(document.querySelectorAll('form'));
    let best: HTMLFormElement | undefined;
    let bestScore = -Infinity;
    for (const form of forms) {
      if (!visible(form) || form.querySelector('input[type=password]') || form.matches(NOT_CONTACT) || form.closest('#respond, #reviews')) continue;
      if (NOT_CONTACT_ACTION.test(form.getAttribute('action') || '')) continue;
      const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter(
        (el) => visible(el) && !['hidden', 'submit', 'button', 'image', 'reset'].includes((el.getAttribute('type') || '').toLowerCase()),
      );
      const hasEmail = fields.some((el) => (el.getAttribute('type') || '').toLowerCase() === 'email' || /e-?mail/i.test(el.getAttribute('name') || ''));
      const hasTextarea = fields.some((el) => el.tagName === 'TEXTAREA');
      if ((!hasEmail && !hasTextarea) || (fields.length <= 1 && !hasTextarea)) continue;
      const score =
        fields.length +
        (hasTextarea ? 10 : 0) +
        (form.matches(CONTACT_PLUGIN) || form.closest('.wpcf7, .wpforms-container, .gform_wrapper, .nf-form-cont, .et_pb_contact') ? 6 : 0) +
        (form.closest('main, article, [role=main], .entry-content') ? 3 : 0) -
        (form.closest('header, footer, nav, aside') ? 5 : 0) -
        (form.matches(NEWSLETTER) ? 8 : 0);
      if (score > bestScore) {
        best = form;
        bestScore = score;
      }
    }
    document.querySelectorAll('[data-journeyguard-form]').forEach((el) => el.removeAttribute('data-journeyguard-form'));
    if (!best) return undefined;
    best.setAttribute('data-journeyguard-form', '');
    return best.id ? `#${best.id}` : best.getAttribute('action') || 'form';
  });
}

async function autoFill(form: Locator, ctx: StepContext, email: string, message: string, phone: string): Promise<number> {
  const fields = form.locator('input, textarea, select');
  const count = await fields.count();
  let filled = 0;
  const radioGroups = new Set<string>();
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    if (!(await field.isVisible()) || !(await field.isEditable().catch(() => false))) continue;
    const a = await field.evaluate((el) => {
      const e = el as HTMLInputElement;
      return {
        tag: e.tagName.toLowerCase(),
        type: (e.getAttribute('type') || 'text').toLowerCase(),
        key: `${e.name} ${e.id} ${e.placeholder} ${e.getAttribute('autocomplete') ?? ''} ${e.getAttribute('aria-label') ?? ''}`.toLowerCase(),
        name: e.name,
        required: e.required || e.getAttribute('aria-required') === 'true',
      };
    });
    if (['hidden', 'submit', 'button', 'image', 'file', 'password', 'reset'].includes(a.type)) continue;
    if (a.tag === 'select') {
      const value = await field.evaluate((el) => Array.from((el as HTMLSelectElement).options).find((o) => o.value && !o.disabled)?.value);
      if (value) await field.selectOption(value);
      filled++;
      continue;
    }
    if (a.type === 'checkbox') {
      if (a.required || /accept|consent|gdpr|privacy|terms|agree|συναιν|αποδέχ|όρους/.test(a.key)) await field.check();
      continue;
    }
    if (a.type === 'radio') {
      if (!radioGroups.has(a.name)) {
        radioGroups.add(a.name);
        await field.check();
      }
      continue;
    }
    let value = 'JourneyGuard Test';
    if (a.tag === 'textarea') value = message;
    else if (a.type === 'email' || /e-?mail/.test(a.key)) value = email;
    else if (a.type === 'tel' || /phone|tel|mobile|τηλ|κινητ/.test(a.key)) value = phone;
    else if (a.type === 'number') value = '1';
    else if (a.type === 'url') value = 'https://example.com';
    else if (a.type === 'date') value = new Date().toISOString().slice(0, 10);
    else if (/subject|θέμα/.test(a.key)) value = 'JourneyGuard automated test';
    await field.fill(value);
    filled++;
  }
  ctx.info.fieldsFilled = filled;
  return filled;
}

export const contactFormPreset: PresetBuilder = (options, { lang }) => {
  const path = optStr(options, 'path') ?? '/contact';
  const formSelector = optStr(options, 'form');
  const email = optStr(options, 'email') ?? 'journeyguard-test@example.com';
  const phone = optStr(options, 'phone') ?? '2100000000';
  const message =
    optStr(options, 'message') ?? 'Automated test message from JourneyGuard to confirm this form works. Please ignore.';
  const successText = optStr(options, 'successText');
  const overrides = optRecord(options, 'fields');
  const captcha = optStr(options, 'captcha') ?? 'skip';
  // submit: false checks the form is there and can be filled in, without sending anything.
  const submit = optBool(options, 'submit', true);

  const findForm = (ctx: StepContext) => ctx.page.locator(formSelector ?? PICKED).first();

  const sendStep: Step = {
    name: 'Send and see confirmation',
    custom: async (ctx) => {
      const form = findForm(ctx);
      const before = await pageText(ctx);
      const beforeUrl = ctx.page.url();
      const submit = form.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
      await safeClick(ctx, submit, 'submit button', ctx.timeoutMs);

      const responseText = async (fallback: Locator): Promise<string> => {
        const output = await anyVisible(ctx.page.locator(RESPONSE_OUTPUT));
        const text = (output ? await output.innerText().catch(() => '') : '') || (await fallback.innerText().catch(() => ''));
        return text.trim().slice(0, 200);
      };

      const deadline = Date.now() + ctx.timeoutMs;
      while (Date.now() < deadline) {
        // Read the text first: markers checked afterwards are at least as fresh, so a spam
        // status is never mistaken for a mail failure that uses the same wording.
        const text = await pageText(ctx);
        if (await anyVisible(ctx.page.locator(SPAM_MARKERS.join(', ')))) {
          throw new NotTestedError('The form treated the test message as spam (an anti-spam plugin such as Akismet blocked it). Allow-list the monitor, and check that real messages are not rejected too.');
        }
        const invalid = await anyVisible(ctx.page.locator(VALIDATION_MARKERS.join(', ')));
        if (invalid) {
          const out = await responseText(invalid);
          throw new NotTestedError(`The form rejected the test input${out ? `: "${out}"` : ''}. Tell JourneyGuard how to fill the required fields with the "fields" option.`);
        }
        const robot = antiBotLine(text, before);
        if (robot) throw antiBotError(robot);
        const failure = await anyVisible(ctx.page.locator(SEND_FAILURE_MARKERS.join(', ')));
        if (failure) {
          const out = await responseText(failure);
          if (countMatches(plain(out), ANTI_BOT_TEXT) > 0) throw antiBotError(out);
          if (VALIDATION_TEXT.test(plain(out))) {
            throw new NotTestedError(`The form rejected the test input: "${out}". Tell JourneyGuard how to fill the required fields with the "fields" option.`);
          }
          throw new StepError(`The form could not send the message: ${out || 'submission failed'}`);
        }
        if (FAILURE_TEXT.test(text) && !FAILURE_TEXT.test(before)) {
          throw new StepError(`The form could not send the message: ${FAILURE_TEXT.exec(text)?.[0] ?? 'message not sent'}`);
        }
        if (successText && text.includes(successText) && !before.includes(successText)) return;
        if (!successText) {
          if (await anyVisible(ctx.page.locator(SUCCESS_MARKERS.join(', ')))) return;
          if (countMatches(text, SUCCESS_TEXT) > countMatches(before, SUCCESS_TEXT)) return;
          if (ctx.page.url() !== beforeUrl && /thank|success|sent|ευχαριστ/i.test(ctx.page.url())) return;
        }
        await ctx.page.waitForTimeout(300);
      }
      const robot = antiBotLine(await pageText(ctx), before);
      if (robot) throw antiBotError(robot);
      throw new StepError(successText ? `Confirmation text "${successText}" did not appear` : 'No confirmation message appeared after sending the form');
    },
  };

  return {
    name: label(lang, 'contactJourney'),
    defaultInterval: submit ? '24h' : undefined,
    defaultRetries: submit ? 0 : undefined,
    stages: [
      {
        name: label(lang, 'contactPage'),
        steps: [
          { name: `${path} opens`, custom: (ctx) => gotoUrl(ctx, path, ctx.timeoutMs) },
          noFatalErrors(),
          {
            name: 'Form visible',
            custom: async (ctx) => {
              if (formSelector) {
                try {
                  await findForm(ctx).waitFor({ state: 'visible', timeout: ctx.timeoutMs });
                } catch {
                  throw new StepError(`No form matching ${formSelector} on ${path}`);
                }
                return;
              }
              // Forms built by page builders often appear after load, so keep looking until the timeout.
              const deadline = Date.now() + ctx.timeoutMs;
              let picked: string | undefined;
              while (!picked && Date.now() < deadline) {
                picked = await pickForm(ctx).catch(() => undefined);
                if (!picked) await ctx.page.waitForTimeout(400);
              }
              if (!picked) throw new StepError(`No contact form found on ${path}`);
              ctx.info.form = picked;
            },
          },
        ],
      },
      {
        name: label(lang, submit ? 'submitForm' : 'fillForm'),
        steps: [
          {
            name: 'No interactive CAPTCHA',
            custom: async (ctx) => {
              if (captcha === 'ignore') return;
              const widgets = findForm(ctx).locator(INTERACTIVE_CAPTCHA);
              const n = await widgets.count();
              let interactive = false;
              for (let i = 0; i < n && !interactive; i++) {
                const box = await widgets.nth(i).boundingBox().catch(() => null);
                interactive = !!box && box.width > 30 && box.height > 30;
              }
              if (interactive) {
                throw new NotTestedError(
                  'The form has a CAPTCHA, so robots (including JourneyGuard) cannot submit it. Allow-list the JourneyGuard header or use a test key.',
                );
              }
            },
          },
          {
            name: 'Fill in the form',
            custom: async (ctx) => {
              const form = findForm(ctx);
              await autoFill(form, ctx, email, message, phone);
              for (const [selector, value] of Object.entries(overrides)) await ctx.page.locator(selector).first().fill(value);
            },
          },
          ...(submit ? [sendStep] : []),
        ],
      },
      { name: label(lang, 'emailDelivered'), steps: [], notTestedReason: label(lang, submit ? 'imapLater' : 'submitDisabled') },
    ],
  };
};
