# Allow-listing JourneyGuard

If a firewall or bot-protection product challenges JourneyGuard, the affected
journey is reported as **not tested**, not as a customer outage. Allow-list
only the monitor, and test the rule with `journeyguard test-alerts` or one
manual run. Keep the firewall enabled for everyone else.

Before creating a rule, find the **public egress IP** of the machine running
JourneyGuard. This is the address the site sees, not necessarily the VPS's
private address. If the monitor runs behind NAT, a proxy or a load balancer,
use the final egress address (and keep it stable if possible).

## Cloudflare

Cloudflare supports a narrow WAF custom rule matching a request header. The
default marker is `X-JourneyGuard: 1`, but that value is public and can be
spoofed. A random secret header value is safer when the rule skips security
products.

1. Put a long random value in the environment of the JourneyGuard process:

   ```yaml
   settings:
     headers:
       X-JourneyGuard: ${JOURNEYGUARD_HEADER}
   ```

   ```dotenv
   JOURNEYGUARD_HEADER=replace-with-a-long-random-value
   ```

   Do not commit the value. The header is sent to the monitored site only; it
   is not sent to third-party resources loaded by the page.
2. In the Cloudflare dashboard, open **Security rules**, choose **Create
   rule** > **Custom rules**, and create an expression like this (use your
   actual secret):

   ```text
   http.request.headers["x-journeyguard"][0] eq "replace-with-a-long-random-value"
   ```
3. Choose **Skip** as the action. Select only the products that are blocking
   the monitor, such as the relevant Managed Rules or rate-limiting rule, then
   save and deploy. Do not skip all security controls unless you have a
   specific reason and have reviewed the impact. Cloudflare's Skip action
   cannot bypass Bot Fight Mode on plans where that product does not support
   skipping it.

See Cloudflare's [Skip action documentation](https://developers.cloudflare.com/waf/custom-rules/skip/)
for the current dashboard and available-skip-options. A header rule is not an
authentication mechanism: anyone who learns the secret can send it, so rotate
it if it leaks and prefer an IP restriction as well when practical.

## Wordfence

Wordfence's reliable allow-list is the monitor's public IP address:

1. In WordPress, open **Wordfence > Firewall > All Firewall Options**.
2. Add the monitor IP to **Allowlisted IP addresses that bypass all rules**
   (the label may be **Whitelisted IP addresses** in older versions), then
   save the firewall settings.
3. Run a check and review the Wordfence live traffic and firewall logs. Remove
   the entry if the address is shared or changes unexpectedly.

Do not rely on a user-agent match as the only Wordfence exception. The
JourneyGuard user agent is `JourneyGuard/<version>` appended to a normal Chrome
user agent, and user agents are easy to forge. If another layer in front of
WordPress provides a narrowly scoped user-agent allow rule, combine it with
the monitor IP and verify that Wordfence still logs normal customer traffic.
Use Wordfence's [firewall options](https://www.wordfence.com/help/firewall/options/)
as the version-specific reference.

## Sucuri

For the Sucuri Website Firewall, add the monitor's public egress IP to the
WAF's **Access Control** allow list (IP allow-list/whitelist), then save or
deploy the change. If Sucuri is in front of the origin, configure the rule in
the Sucuri dashboard rather than only in WordPress. Purge cached challenge
responses if the dashboard offers that option, then run a fresh check.

Prefer the IP list over a user-agent exception. A user-agent rule, where
available in your Sucuri plan or another proxy layer, should match the full
JourneyGuard user-agent pattern and be restricted to the monitor IP; it is not
secret and can be spoofed. Follow Sucuri's [knowledge base](https://docs.sucuri.net/)
for the controls available on your account.

## Imunify360

On a server protected by Imunify360, add the monitor's public egress IP to the
Imunify360 Firewall allow list/white list in the server or hosting panel. The
exact menu and label depend on whether Imunify360 is managed through cPanel,
Plesk or DirectAdmin. If you administer it on the command line, use the
allow-list operation documented for the installed Imunify360 version, then
confirm the rule is active in the panel and logs.

Use an IP rule as the primary exception. A user-agent allow rule may be
available in a hosting panel or an upstream WAF, but it is not a substitute
for an IP restriction and can be spoofed. Do not disable Imunify360 Firewall,
Proactive Defense or malware protection globally just to make a monitor pass.
If the IP changes, update the allow list and rerun the check. See the
[Imunify360 product documentation](https://docs.imunify360.com/) for the
current panel and CLI references.

## Choosing a signal

| Signal | Strength | Tradeoff |
|---|---|---|
| Monitor public IP | Strongest and simplest | Requires a stable egress IP; shared NAT can be too broad |
| Secret `X-JourneyGuard` value | Narrow and works when IPs change | Must stay secret; a leaked value can be replayed |
| JourneyGuard user agent | Easy to identify in logs | Public and spoofable; not supported as a bypass by every firewall |
| Default `X-JourneyGuard: 1` | No configuration needed | Public and should not be used to skip broad security controls |

Whenever possible, combine the monitor IP with the secret header, scope the
exception to the monitored hostname and required paths, and verify that
ordinary visitors are still challenged by the protection you intended to
keep.
