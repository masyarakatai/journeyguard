import type { Language, StageStatus } from './types.js';

const STRINGS = {
  en: {
    passed: 'Passed',
    failed: 'Failed',
    warning: 'Warning',
    not_tested: 'Not tested',
    journeyFailed: '{journey} journey failed',
    journeyRecovered: '{journey} is working again',
    failedAt: 'Failed at',
    error: 'Error',
    likelyCause: 'Likely cause',
    checkedAt: 'Checked at',
    report: 'Health report',
    site: 'Site',
    journey: 'Journey',
    duration: 'Duration',
    details: 'Details',
    evidence: 'Evidence',
    screenshot: 'Screenshot at the moment of failure',
    consoleErrors: 'Browser errors',
    failedRequests: 'Failed requests',
    noProblems: 'All journeys are working.',
    problemFound: 'problem needs attention.',
    problemsFound: 'problems need attention.',
    generated: 'Generated',
    poweredBy: 'Monitored with JourneyGuard',
    discovered: 'Observations',
    lastRun: 'Last check',
    history: 'History',
    noRuns: 'No checks yet. Run "journeyguard run" or wait for the scheduler.',
    runNow: 'Run now',
    monitorDown: 'JourneyGuard cannot run checks',
    monitorDownDetail: 'The last checks could not run, so problems on your sites would go unnoticed. Check the server: the browser may fail to start, the disk may be full, or memory may be too low.',
    monitorUp: 'JourneyGuard is checking again',
    monitorUpDetail: 'Checks are running normally again.',
    running: 'Running…',
    queued: 'Already queued…',
    downloadReport: 'Download report',
  },
  el: {
    passed: 'Επιτυχία',
    failed: 'Αποτυχία',
    warning: 'Προειδοποίηση',
    not_tested: 'Δεν ελέγχθηκε',
    journeyFailed: 'Πρόβλημα στη διαδρομή «{journey}»',
    journeyRecovered: 'Η διαδρομή «{journey}» λειτουργεί ξανά',
    failedAt: 'Απέτυχε στο',
    error: 'Σφάλμα',
    likelyCause: 'Πιθανή αιτία',
    checkedAt: 'Έλεγχος',
    report: 'Αναφορά λειτουργίας',
    site: 'Ιστοσελίδα',
    journey: 'Διαδρομή',
    duration: 'Διάρκεια',
    details: 'Λεπτομέρειες',
    evidence: 'Τεχνικά στοιχεία',
    screenshot: 'Στιγμιότυπο τη στιγμή της αποτυχίας',
    consoleErrors: 'Σφάλματα browser',
    failedRequests: 'Αποτυχημένα αιτήματα',
    noProblems: 'Όλες οι διαδρομές λειτουργούν.',
    problemFound: 'πρόβλημα χρειάζεται προσοχή.',
    problemsFound: 'προβλήματα χρειάζονται προσοχή.',
    generated: 'Δημιουργήθηκε',
    poweredBy: 'Παρακολούθηση με JourneyGuard',
    discovered: 'Παρατηρήσεις',
    lastRun: 'Τελευταίος έλεγχος',
    history: 'Ιστορικό',
    noRuns: 'Δεν υπάρχουν έλεγχοι ακόμη. Τρέξτε "journeyguard run" ή περιμένετε τον scheduler.',
    runNow: 'Έλεγχος τώρα',
    monitorDown: 'Το JourneyGuard δεν μπορεί να κάνει ελέγχους',
    monitorDownDetail: 'Οι τελευταίοι έλεγχοι δεν εκτελέστηκαν, οπότε προβλήματα στις ιστοσελίδες σας θα περνούσαν απαρατήρητα. Ελέγξτε τον server: μπορεί να μην ξεκινά ο browser, να γέμισε ο δίσκος ή να μην επαρκεί η μνήμη.',
    monitorUp: 'Το JourneyGuard ελέγχει ξανά κανονικά',
    monitorUpDetail: 'Οι έλεγχοι εκτελούνται ξανά κανονικά.',
    running: 'Σε εξέλιξη…',
    queued: 'Ήδη σε αναμονή…',
    downloadReport: 'Λήψη αναφοράς',
  },
} as const;

export type MessageKey = keyof (typeof STRINGS)['en'];

export function t(lang: Language, key: MessageKey): string {
  return STRINGS[lang][key] ?? STRINGS.en[key];
}

export function statusLabel(lang: Language, status: StageStatus): string {
  return t(lang, status);
}

export const STATUS_ICON: Record<StageStatus, string> = {
  passed: '✅',
  failed: '❌',
  warning: '⚠️',
  not_tested: '⏸️',
};

/**
 * Step errors are written in English because the diagnosis rules read them. For Greek reports and
 * alerts the most common ones are translated when shown; anything else stays as written.
 */
const GREEK_ERRORS: [RegExp, string][] = [
  [/^HTTP (\d+) on (\S+)$/, 'HTTP $1 στη σελίδα $2'],
  [/^Page did not load within (.+?): (\S+)$/, 'Η σελίδα δεν φόρτωσε μέσα σε $1: $2'],
  [/^Could not open (\S+): (.*)$/, 'Δεν ήταν δυνατό να ανοίξει η σελίδα $1: $2'],
  [/^Element not visible after (.+?): (.+)$/, 'Το στοιχείο δεν εμφανίστηκε μέσα σε $1: $2'],
  [/^Page shows an error: (.+)$/, 'Η σελίδα εμφανίζει σφάλμα: $1'],
  [/^Clicked "add to cart" but the cart is still empty$/, 'Πατήθηκε η «Προσθήκη στο καλάθι», αλλά το καλάθι έμεινε άδειο'],
  [/^No confirmation that the product was added to the cart$/, 'Δεν εμφανίστηκε επιβεβαίωση ότι το προϊόν μπήκε στο καλάθι'],
  [/^Checkout sent us back to an empty cart.*$/, 'Το ταμείο γύρισε σε άδειο καλάθι: το καλάθι χάθηκε (συνήθως caching στο καλάθι/ταμείο ή πρόβλημα με cookies)'],
  [/^Checkout says there are no available payment methods$/, 'Το ταμείο λέει ότι δεν υπάρχουν διαθέσιμοι τρόποι πληρωμής'],
  [/^Checkout shows no payment method to choose$/, 'Το ταμείο δεν εμφανίζει κανέναν τρόπο πληρωμής'],
  [/^Payment methods section did not appear on checkout$/, 'Η ενότητα πληρωμής δεν εμφανίστηκε στο ταμείο'],
  [/^Expected payment method is missing: (.+) \(offered: (.*)\)$/, 'Λείπει ο τρόπος πληρωμής: $1 (διαθέσιμοι: $2)'],
  [/^No product is in stock and purchasable.*$/, 'Κανένα προϊόν δεν είναι διαθέσιμο για αγορά'],
  [/^The form could not send the message: (.+)$/, 'Η φόρμα δεν μπόρεσε να στείλει το μήνυμα: $1'],
  [/^No confirmation message appeared after sending the form$/, 'Δεν εμφανίστηκε μήνυμα επιβεβαίωσης μετά την αποστολή της φόρμας'],
  [/^No contact form found on (\S+)$/, 'Δεν βρέθηκε φόρμα επικοινωνίας στη σελίδα $1'],
  [/^SSL certificate expires in (\d+) day\(s\)$/, 'Το πιστοποιητικό SSL λήγει σε $1 ημέρες'],
  [/^SSL certificate expired (\d+) day\(s\) ago$/, 'Το πιστοποιητικό SSL έληξε πριν από $1 ημέρες'],
  [/^Site is not served over HTTPS$/, 'Η ιστοσελίδα δεν χρησιμοποιεί HTTPS'],
  [/^The form has a CAPTCHA.*$/, 'Η φόρμα έχει CAPTCHA, οπότε κανένα ρομπότ (ούτε το JourneyGuard) δεν μπορεί να την υποβάλει. Επιτρέψτε το header του JourneyGuard ή χρησιμοποιήστε test key.'],
  [/^The form's anti-spam or anti-robot check rejected the test \("(.*)"\).*$/, 'Ο έλεγχος anti-spam/anti-robot της φόρμας απέρριψε τη δοκιμή («$1»), οπότε δεν στάλθηκε τίποτα. Επιτρέψτε το JourneyGuard και στείλτε ένα μήνυμα με το χέρι για να βεβαιωθείτε ότι οι πραγματικοί επισκέπτες δεν μπλοκάρονται.'],
  [/^The form treated the test message as spam.*$/, 'Η φόρμα θεώρησε το δοκιμαστικό μήνυμα spam (το μπλόκαρε plugin anti-spam). Επιτρέψτε το JourneyGuard και βεβαιωθείτε ότι δεν απορρίπτονται πραγματικά μηνύματα.'],
  [/^The form rejected the test input(?:: "(.*)")?\..*$/, 'Η φόρμα απέρριψε τα δοκιμαστικά στοιχεία ($1). Ορίστε τι να συμπληρώνεται με την επιλογή «fields».'],
  [/^(.+) blocked the monitor \(HTTP (\d+)\) on (\S+)\..*$/, 'Το $1 μπλόκαρε τον έλεγχο (HTTP $2) στη σελίδα $3. Επιτρέψτε τα αιτήματα με header X-JourneyGuard ή τη διεύθυνση IP του.'],
  [/^Something on the page covers the (.+), so it could not be clicked \((.*)\)\..*$/, 'Κάτι στη σελίδα καλύπτει το στοιχείο «$1» και δεν μπορεί να πατηθεί ($2). Συνήθως είναι cookie banner ή pop-up που δεν έκλεισε.'],
  [/^The cart total is zero.*$/, 'Το σύνολο του καλαθιού είναι μηδέν, οπότε το ταμείο δεν ζητά πληρωμή. Ορίστε productUrl σε προϊόν με τιμή για να ελέγχονται οι τρόποι πληρωμής.'],
  [/^This product loads its options on demand.*$/, 'Το προϊόν φορτώνει τις επιλογές του δυναμικά, οπότε δεν φαίνεται ποιος συνδυασμός είναι διαθέσιμος. Ορίστε productUrl σε απλό προϊόν.'],
];

export function localizeError(text: string, lang: Language): string {
  if (lang !== 'el' || !text) return text;
  for (const [pattern, greek] of GREEK_ERRORS) if (pattern.test(text)) return text.replace(pattern, greek);
  return text;
}
