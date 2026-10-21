import type { Hint, Language, RunResult } from './types.js';

/**
 * Rule-based diagnosis: turns raw evidence into a plain-language explanation a shop owner
 * can act on (or forward to their developer). No AI or network calls involved.
 */

type Text = { en: string; el: string; es: string };
interface Rule {
  id: string;
  severity: Hint['severity'];
  title: Text;
  detail: Text;
  test: (run: RunResult, haystack: string) => boolean;
}

const has = (re: RegExp) => (_run: RunResult, haystack: string) => re.test(haystack);
const failedReq = (run: RunResult, re: RegExp) => (run.evidence?.failedRequests ?? []).some((r) => re.test(r.url));

const RULES: Rule[] = [
  {
    id: 'dns',
    severity: 'critical',
    test: has(/ERR_NAME_NOT_RESOLVED|ENOTFOUND/),
    title: { en: 'The domain does not resolve', el: 'Το domain δεν βρίσκεται', es: 'El dominio no se resuelve' },
    detail: {
      en: 'The domain name does not point to any server. Check that the domain has not expired and that its DNS records are correct.',
      el: 'Το όνομα του domain δεν οδηγεί σε κανέναν server. Ελέγξτε ότι το domain δεν έχει λήξει και ότι οι εγγραφές DNS είναι σωστές.',
      es: 'El nombre de dominio no apunta a ningún servidor. Comprueba que no haya caducado y que sus registros DNS sean correctos.',
    },
  },
  {
    id: 'ssl',
    severity: 'critical',
    test: has(/ERR_CERT_|SSL certificate expired|ERR_SSL_/),
    title: { en: 'SSL certificate problem', el: 'Πρόβλημα με το πιστοποιητικό SSL', es: 'Problema con el certificado SSL' },
    detail: {
      en: 'Browsers show a security warning, so most visitors leave. Renew or reinstall the SSL certificate.',
      el: 'Οι browsers εμφανίζουν προειδοποίηση ασφαλείας και οι περισσότεροι επισκέπτες φεύγουν. Ανανεώστε ή εγκαταστήστε ξανά το πιστοποιητικό SSL.',
      es: 'Los navegadores muestran una advertencia de seguridad y la mayoría de visitantes se va. Renueva o reinstala el certificado SSL.',
    },
  },
  {
    id: 'ssl-expiring',
    severity: 'warning',
    test: has(/SSL certificate expires in/),
    title: { en: 'SSL certificate is about to expire', el: 'Το πιστοποιητικό SSL λήγει σύντομα', es: 'El certificado SSL está a punto de caducar' },
    detail: {
      en: 'Renew it now. If auto-renewal is configured, check why it has not run.',
      el: 'Ανανεώστε το τώρα. Αν υπάρχει αυτόματη ανανέωση, ελέγξτε γιατί δεν έχει εκτελεστεί.',
      es: 'Renuévalo ahora. Si la renovación automática está configurada, comprueba por qué no se ha ejecutado.',
    },
  },
  {
    id: 'unreachable',
    severity: 'critical',
    test: has(/ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_CONNECTION_RESET|ECONNREFUSED|Page did not load within/),
    title: { en: 'The server is not responding', el: 'Ο server δεν απαντά', es: 'El servidor no responde' },
    detail: {
      en: 'The website did not answer in time. The server may be down or overloaded; contact your hosting provider.',
      el: 'Η ιστοσελίδα δεν απάντησε εγκαίρως. Ο server μπορεί να είναι εκτός λειτουργίας ή υπερφορτωμένος· επικοινωνήστε με την εταιρεία φιλοξενίας.',
      es: 'El sitio web no respondió a tiempo. El servidor puede estar caído o sobrecargado; contacta con tu proveedor de alojamiento.',
    },
  },
  {
    id: 'bot-protection',
    severity: 'warning',
    test: has(/blocked the monitor|bot challenge|verify (that )?you are (a )?human/i),
    title: { en: 'A firewall is blocking the monitor', el: 'Κάποιο firewall μπλοκάρει τον έλεγχο', es: 'Un cortafuegos bloquea el monitor' },
    detail: {
      en: 'Bot protection (e.g. Cloudflare or a security plugin) stopped JourneyGuard. Allow-list requests with the "X-JourneyGuard" header or the JourneyGuard user agent. Real customers may be affected too if the rules are too strict.',
      el: 'Η προστασία από bots (π.χ. Cloudflare ή plugin ασφαλείας) σταμάτησε το JourneyGuard. Επιτρέψτε τα αιτήματα με header "X-JourneyGuard" ή user agent JourneyGuard. Αν οι κανόνες είναι πολύ αυστηροί, μπορεί να επηρεάζονται και πραγματικοί πελάτες.',
      es: 'La protección contra bots (por ejemplo, Cloudflare o un plugin de seguridad) detuvo JourneyGuard. Permite las solicitudes con el encabezado «X-JourneyGuard» o el agente de usuario de JourneyGuard. Los clientes reales también pueden verse afectados si las reglas son demasiado estrictas.',
    },
  },
  {
    id: 'forbidden',
    severity: 'critical',
    test: has(/HTTP 403 on/),
    title: { en: 'The server refuses access (HTTP 403)', el: 'Ο server αρνείται την πρόσβαση (HTTP 403)', es: 'El servidor rechaza el acceso (HTTP 403)' },
    detail: {
      en: 'The page answered "403 Forbidden" without any firewall signature, so real visitors are probably refused too. Check file permissions, .htaccess rules and security plugins, especially after a migration or update.',
      el: 'Η σελίδα απάντησε «403 Forbidden» χωρίς ένδειξη firewall, οπότε πιθανότατα απορρίπτονται και οι πραγματικοί επισκέπτες. Ελέγξτε δικαιώματα αρχείων, κανόνες .htaccess και plugins ασφαλείας, ειδικά μετά από μεταφορά ή ενημέρωση.',
      es: 'La página respondió «403 Forbidden» sin señales de un cortafuegos, así que probablemente también rechaza a los visitantes reales. Revisa los permisos de archivos, las reglas de .htaccess y los plugins de seguridad, especialmente después de una migración o actualización.',
    },
  },
  {
    id: 'wp-critical',
    severity: 'critical',
    test: has(/WordPress critical error|PHP fatal error|critical error on (this|your) website|κρίσιμο σφάλμα|^\s*(fatal|parse) error:/im),
    title: { en: 'PHP/WordPress fatal error', el: 'Κρίσιμο σφάλμα PHP/WordPress', es: 'Error fatal de PHP/WordPress' },
    detail: {
      en: 'Usually caused by a plugin or theme update, or a PHP version change. Check the PHP error log and recently updated plugins.',
      el: 'Συνήθως οφείλεται σε ενημέρωση plugin ή θέματος, ή σε αλλαγή έκδοσης PHP. Ελέγξτε το PHP error log και τα πρόσφατα ενημερωμένα plugins.',
      es: 'Suele deberse a una actualización de un plugin o tema, o a un cambio de versión de PHP. Revisa el registro de errores de PHP y los plugins actualizados recientemente.',
    },
  },
  {
    id: 'database',
    severity: 'critical',
    test: has(/Database connection error|error establishing a database connection/i),
    title: { en: 'The database is unreachable', el: 'Η βάση δεδομένων δεν είναι διαθέσιμη', es: 'No se puede acceder a la base de datos' },
    detail: {
      en: 'The site cannot reach its database. The database server may be down, full, or its credentials changed.',
      el: 'Η ιστοσελίδα δεν συνδέεται με τη βάση δεδομένων. Ο database server μπορεί να έχει πέσει, να είναι γεμάτος ή να άλλαξαν τα στοιχεία σύνδεσης.',
      es: 'El sitio no puede acceder a su base de datos. El servidor de la base de datos puede estar caído, lleno o tener credenciales distintas.',
    },
  },
  {
    id: 'maintenance',
    severity: 'critical',
    test: has(/maintenance mode|briefly unavailable for scheduled maintenance/i),
    title: { en: 'Stuck in maintenance mode', el: 'Κολλημένο σε κατάσταση συντήρησης', es: 'Atascado en modo de mantenimiento' },
    detail: {
      en: 'An interrupted update left WordPress in maintenance mode. Delete the ".maintenance" file in the site root and re-run the update.',
      el: 'Μια διακοπείσα ενημέρωση άφησε το WordPress σε κατάσταση συντήρησης. Διαγράψτε το αρχείο ".maintenance" στον κεντρικό φάκελο και επαναλάβετε την ενημέρωση.',
      es: 'Una actualización interrumpida dejó WordPress en modo de mantenimiento. Elimina el archivo «.maintenance» de la raíz del sitio y repite la actualización.',
    },
  },
  {
    id: 'server-error',
    severity: 'critical',
    test: (run, h) => /HTTP 5\d\d|Server gateway error/.test(h) || (run.evidence?.httpStatus ?? 0) >= 500,
    title: { en: 'Server error (5xx)', el: 'Σφάλμα server (5xx)', es: 'Error del servidor (5xx)' },
    detail: {
      en: 'The server failed while building the page. Check the server and PHP error logs around the time of this check.',
      el: 'Ο server απέτυχε να δημιουργήσει τη σελίδα. Ελέγξτε τα logs του server και της PHP για την ώρα του ελέγχου.',
      es: 'El servidor falló al generar la página. Revisa los registros de errores del servidor y de PHP alrededor de la hora de esta comprobación.',
    },
  },
  {
    id: 'cart-session',
    severity: 'critical',
    test: has(/cart session was lost/),
    title: { en: 'Customers lose their cart at checkout', el: 'Οι πελάτες χάνουν το καλάθι τους στο checkout', es: 'Los clientes pierden el carrito al comprar' },
    detail: {
      en: 'Cart and checkout pages are probably being cached. Exclude /cart, /checkout and /my-account from page caching and the CDN.',
      el: 'Πιθανότατα γίνεται caching στις σελίδες καλαθιού και ολοκλήρωσης. Εξαιρέστε τα /cart, /checkout και /my-account από το page cache και το CDN.',
      es: 'Probablemente se están guardando en caché las páginas del carrito y de compra. Excluye /cart, /checkout y /my-account de la caché de páginas y del CDN.',
    },
  },
  {
    id: 'add-to-cart',
    severity: 'critical',
    test: has(/cart is still empty|No confirmation that the product was added/),
    title: { en: '"Add to cart" does not work', el: 'Το "Προσθήκη στο καλάθι" δεν λειτουργεί', es: '«Añadir al carrito» no funciona' },
    detail: {
      en: 'Often a JavaScript conflict after a plugin/theme update, a blocked AJAX request, or a stock/price problem with the product.',
      el: 'Συχνά οφείλεται σε σύγκρουση JavaScript μετά από ενημέρωση plugin/θέματος, σε μπλοκαρισμένο AJAX αίτημα ή σε πρόβλημα αποθέματος/τιμής του προϊόντος.',
      es: 'A menudo se debe a un conflicto de JavaScript después de actualizar un plugin o tema, una solicitud AJAX bloqueada o un problema de existencias o precio del producto.',
    },
  },
  {
    id: 'ajax',
    severity: 'warning',
    test: (run) => failedReq(run, /admin-ajax\.php|[?&]wc-ajax=|\/wp-json\/|\/cart\/add/),
    title: { en: 'Background requests are failing', el: 'Αποτυγχάνουν τα αιτήματα στο παρασκήνιο', es: 'Fallan las solicitudes en segundo plano' },
    detail: {
      en: 'Requests that power the cart and forms (AJAX/REST) returned errors. A security plugin, firewall rule or server error may be blocking them.',
      el: 'Τα αιτήματα που τροφοδοτούν το καλάθι και τις φόρμες (AJAX/REST) επέστρεψαν σφάλμα. Μπορεί να τα μπλοκάρει plugin ασφαλείας, κανόνας firewall ή σφάλμα server.',
      es: 'Las solicitudes que hacen funcionar el carrito y los formularios (AJAX/REST) devolvieron errores. Puede que las bloquee un plugin de seguridad, una regla del cortafuegos o un error del servidor.',
    },
  },
  {
    id: 'no-payment-methods',
    severity: 'critical',
    test: has(/no available payment methods|Payment methods section did not appear|no payment method to choose/),
    title: { en: 'Customers cannot choose a payment method', el: 'Οι πελάτες δεν μπορούν να επιλέξουν τρόπο πληρωμής', es: 'Los clientes no pueden elegir un método de pago' },
    detail: {
      en: 'The payment gateway is disabled, its API keys expired, or it is restricted for this country/currency. Check the payment settings.',
      el: 'Ο πάροχος πληρωμών είναι απενεργοποιημένος, έληξαν τα API keys ή υπάρχει περιορισμός χώρας/νομίσματος. Ελέγξτε τις ρυθμίσεις πληρωμών.',
      es: 'La pasarela de pago está desactivada, sus claves API han caducado o tiene restricciones para este país o moneda. Revisa la configuración de pagos.',
    },
  },
  {
    id: 'payment-missing',
    severity: 'critical',
    test: has(/Expected payment method is missing/),
    title: { en: 'A payment method has disappeared', el: 'Χάθηκε ένας τρόπος πληρωμής', es: 'Ha desaparecido un método de pago' },
    detail: {
      en: 'Checkout still works with the other methods, but customers who pay this way cannot. The gateway was probably switched off, its keys expired, or a plugin update broke it. Check its settings and the gateway account.',
      el: 'Το ταμείο λειτουργεί με τους άλλους τρόπους, αλλά όσοι πληρώνουν έτσι δεν μπορούν. Πιθανότατα ο πάροχος απενεργοποιήθηκε, έληξαν τα κλειδιά του ή τον χάλασε κάποια ενημέρωση plugin. Ελέγξτε τις ρυθμίσεις του και τον λογαριασμό στον πάροχο.',
      es: 'El proceso de compra sigue funcionando con los demás métodos, pero los clientes que pagan así no pueden hacerlo. Probablemente se desactivó la pasarela, caducaron sus claves o una actualización de plugin la rompió. Revisa su configuración y la cuenta de la pasarela.',
    },
  },
  {
    id: 'payment-script',
    severity: 'critical',
    test: (run) =>
      failedReq(run, /stripe\.com|paypal\.com|paypalobjects|vivapayments|viva\.com|jccsecure|braintreegateway|klarna/i) ||
      (run.evidence?.consoleErrors ?? []).some((e) => /stripe|paypal|viva|jcc|braintree/i.test(e)),
    title: { en: 'The payment provider failed to load', el: 'Ο πάροχος πληρωμών δεν φορτώθηκε', es: 'El proveedor de pagos no se cargó' },
    detail: {
      en: 'A script from the payment provider failed. Card fields or payment buttons may be missing for customers.',
      el: 'Απέτυχε script του παρόχου πληρωμών. Τα πεδία κάρτας ή τα κουμπιά πληρωμής μπορεί να λείπουν για τους πελάτες.',
      es: 'Falló un script del proveedor de pagos. Puede que falten los campos de tarjeta o los botones de pago para los clientes.',
    },
  },
  {
    id: 'mail',
    severity: 'critical',
    test: has(/could not send the message|error (occurred )?(while )?trying to send your message/i),
    title: { en: 'Messages from customers are being lost', el: 'Χάνονται τα μηνύματα των πελατών', es: 'Se pierden los mensajes de los clientes' },
    detail: {
      en: 'The form could not send its email. Most often the site cannot send mail at all: configure SMTP with a real mail provider and test delivery.',
      el: 'Η φόρμα δεν μπόρεσε να στείλει email. Συνήθως η ιστοσελίδα δεν μπορεί να στείλει καθόλου email: ρυθμίστε SMTP με κανονικό πάροχο email και δοκιμάστε την αποστολή.',
      es: 'El formulario no pudo enviar su correo. Lo más habitual es que el sitio no pueda enviar correos: configura SMTP con un proveedor real y prueba la entrega.',
    },
  },
  {
    id: 'overlay',
    severity: 'warning',
    test: has(/covers the .* so it could not be clicked/),
    title: { en: 'A banner or pop-up is in the way', el: 'Ένα banner ή pop-up εμποδίζει τον έλεγχο', es: 'Un banner o una ventana emergente bloquea el paso' },
    detail: {
      en: 'JourneyGuard closes common cookie banners and pop-ups (always choosing "necessary only"), but this one stayed on top of the button. Check on a phone that customers can close it, then report it as a false alarm so it can be recognised, or add a click step that closes it.',
      el: 'Το JourneyGuard κλείνει τα συνηθισμένα cookie banners και pop-ups (πάντα με «Μόνο τα απαραίτητα»), αλλά αυτό έμεινε πάνω από το κουμπί. Ελέγξτε από κινητό ότι οι πελάτες μπορούν να το κλείσουν και αναφέρετέ το ως ψευδή συναγερμό ώστε να αναγνωρίζεται, ή προσθέστε ένα βήμα click που το κλείνει.',
      es: 'JourneyGuard cierra los banners de cookies y ventanas emergentes habituales (siempre eligiendo «solo lo necesario»), pero este se quedó sobre el botón. Comprueba desde un móvil que los clientes puedan cerrarlo y repórtalo como una falsa alarma para reconocerlo, o añade un paso de clic que lo cierre.',
    },
  },
  {
    id: 'spam',
    severity: 'warning',
    test: has(/treated the test (message )?as spam|anti-spam or anti-robot check rejected/),
    title: { en: 'Anti-spam blocked the test', el: 'Το anti-spam μπλόκαρε τη δοκιμή', es: 'El antispam bloqueó la prueba' },
    detail: {
      en: 'Allow-list JourneyGuard in the anti-spam plugin so the check is meaningful, and confirm real messages are not being rejected.',
      el: 'Επιτρέψτε το JourneyGuard στο plugin anti-spam ώστε ο έλεγχος να έχει νόημα, και βεβαιωθείτε ότι δεν απορρίπτονται πραγματικά μηνύματα.',
      es: 'Incluye JourneyGuard en la lista de permitidos del plugin antispam para que la comprobación sea útil y confirma que no se rechacen mensajes reales.',
    },
  },
  {
    id: 'captcha',
    severity: 'info',
    test: has(/has a CAPTCHA/),
    title: { en: 'Form protected by CAPTCHA', el: 'Η φόρμα προστατεύεται με CAPTCHA', es: 'Formulario protegido por CAPTCHA' },
    detail: {
      en: 'JourneyGuard does not bypass CAPTCHAs. Use a test site key for the monitor or allow-list its header.',
      el: 'Το JourneyGuard δεν παρακάμπτει CAPTCHA. Χρησιμοποιήστε test key για τον έλεγχο ή επιτρέψτε το header του.',
      es: 'JourneyGuard no evita los CAPTCHA. Usa una clave de sitio de prueba para el monitor o incluye su encabezado en la lista de permitidos.',
    },
  },
  {
    id: 'out-of-stock',
    severity: 'warning',
    test: has(/No product is (in stock|available)|no published products/),
    title: { en: 'No product can be bought', el: 'Κανένα προϊόν δεν μπορεί να αγοραστεί', es: 'No se puede comprar ningún producto' },
    detail: {
      en: 'Every product looks out of stock or unavailable. If that is unexpected, check stock sync; otherwise set "productUrl" for the monitor.',
      el: 'Όλα τα προϊόντα φαίνονται εξαντλημένα ή μη διαθέσιμα. Αν δεν είναι αναμενόμενο, ελέγξτε τον συγχρονισμό αποθήκης· αλλιώς ορίστε "productUrl" για τον έλεγχο.',
      es: 'Todos los productos parecen agotados o no disponibles. Si no es lo esperado, revisa la sincronización del inventario; si no, define «productUrl» para el monitor.',
    },
  },
  {
    id: 'password',
    severity: 'critical',
    test: has(/password-protected/),
    title: { en: 'The store is closed to the public', el: 'Το κατάστημα είναι κλειστό για το κοινό', es: 'La tienda está cerrada al público' },
    detail: {
      en: 'Remove the storefront password in Shopify (Online Store › Preferences) if the store should be open.',
      el: 'Αφαιρέστε τον κωδικό του καταστήματος στο Shopify (Online Store › Preferences) αν το κατάστημα πρέπει να είναι ανοιχτό.',
      es: 'Elimina la contraseña de escaparate en Shopify (Online Store › Preferences) si la tienda debe estar abierta.',
    },
  },
  {
    id: 'safe-mode',
    severity: 'info',
    test: has(/Safe mode blocked/),
    title: { en: 'Safe mode stopped a real purchase', el: 'Η ασφαλής λειτουργία σταμάτησε πραγματική αγορά', es: 'El modo seguro detuvo una compra real' },
    detail: {
      en: 'A step tried to press a "place order / pay" button. Remove that step, or run against a store in payment test mode with safeMode: false.',
      el: 'Ένα βήμα προσπάθησε να πατήσει κουμπί "ολοκλήρωση παραγγελίας / πληρωμή". Αφαιρέστε το βήμα ή τρέξτε σε κατάστημα με test mode πληρωμών και safeMode: false.',
      es: 'Un paso intentó pulsar un botón de «realizar pedido / pagar». Elimina ese paso o ejecuta la comprobación en una tienda con el modo de prueba de pagos y safeMode: false.',
    },
  },
  {
    id: 'js-error',
    severity: 'warning',
    test: (run) => run.status === 'failed' && (run.evidence?.consoleErrors ?? []).some((e) => /^Uncaught /.test(e)),
    title: { en: 'JavaScript errors on the page', el: 'Σφάλματα JavaScript στη σελίδα', es: 'Errores de JavaScript en la página' },
    detail: {
      en: 'A script crashed on the page. Crashed scripts often stop buttons and forms from working.',
      el: 'Ένα script κατέρρευσε στη σελίδα. Τα σφάλματα JavaScript συχνά σταματούν κουμπιά και φόρμες.',
      es: 'Un script falló en la página. Los scripts fallidos suelen impedir que funcionen los botones y formularios.',
    },
  },
  {
    id: 'layout-changed',
    severity: 'warning',
    test: has(/Element not visible after/),
    title: { en: 'Something expected is missing from the page', el: 'Λείπει κάτι αναμενόμενο από τη σελίδα', es: 'Falta algo que debería estar en la página' },
    detail: {
      en: 'A button, field or section did not appear. Either the page is broken, or its design changed (e.g. after a theme update) and the journey needs updating.',
      el: 'Ένα κουμπί, πεδίο ή ενότητα δεν εμφανίστηκε. Είτε η σελίδα έχει πρόβλημα, είτε άλλαξε ο σχεδιασμός (π.χ. μετά από ενημέρωση θέματος) και πρέπει να ενημερωθεί η διαδρομή.',
      es: 'No apareció un botón, campo o sección. La página puede estar rota o su diseño puede haber cambiado (por ejemplo, tras actualizar el tema) y el recorrido necesita actualizarse.',
    },
  },
  {
    id: 'flaky',
    severity: 'warning',
    test: (run) => run.info.flaky === true,
    title: { en: 'Intermittent problem', el: 'Διακοπτόμενο πρόβλημα', es: 'Problema intermitente' },
    detail: {
      en: 'The journey failed once and passed on retry. Some customers are probably hitting the same failure.',
      el: 'Η διαδρομή απέτυχε μία φορά και πέρασε στη δεύτερη προσπάθεια. Πιθανότατα κάποιοι πελάτες συναντούν το ίδιο πρόβλημα.',
      es: 'El recorrido falló una vez y pasó al reintentarlo. Probablemente algunos clientes encuentran el mismo fallo.',
    },
  },
  {
    id: 'slow',
    severity: 'warning',
    test: (run) => Number(run.info.homepageLoadMs ?? 0) > 5_000,
    title: { en: 'The homepage is slow', el: 'Η αρχική σελίδα είναι αργή', es: 'La página de inicio es lenta' },
    detail: {
      en: 'Pages that take more than a few seconds lose visitors and rank lower on Google. Consider caching, image optimisation and better hosting.',
      el: 'Σελίδες που αργούν πάνω από λίγα δευτερόλεπτα χάνουν επισκέπτες και πέφτουν στο Google. Εξετάστε caching, βελτιστοποίηση εικόνων και καλύτερο hosting.',
      es: 'Las páginas que tardan más de unos segundos pierden visitantes y posiciones en Google. Considera usar caché, optimizar imágenes y contratar un mejor alojamiento.',
    },
  },
];

export function diagnose(run: RunResult, language: Language = 'en'): Hint[] {
  if (run.status === 'passed') return [];
  const failed = run.stages.find((s) => s.status === 'failed');
  const parts = [
    failed?.error ?? '',
    ...run.stages.map((s) => s.reason ?? ''),
    ...run.stages.flatMap((s) => s.steps.map((st) => st.error ?? '')),
    // Page text only counts when the page is short, i.e. an error page rather than an article.
    (run.evidence?.textSample ?? '').length < 1_500 ? (run.evidence?.textSample ?? '') : '',
    run.evidence?.title ?? '',
  ];
  const haystack = parts.join('\n');
  const hints: Hint[] = [];
  for (const rule of RULES) {
    if (rule.test(run, haystack)) {
      hints.push({ id: rule.id, severity: rule.severity, title: rule.title[language], detail: rule.detail[language] });
    }
  }
  // Specific causes make the generic hints redundant.
  const ids = new Set(hints.map((h) => h.id));
  return hints.filter((h) => {
    if (h.id === 'layout-changed' && hints.some((o) => o.severity === 'critical')) return false;
    if (h.id === 'server-error' && (ids.has('wp-critical') || ids.has('database') || ids.has('maintenance'))) return false;
    return true;
  });
}

export const RULE_IDS = RULES.map((r) => r.id);
