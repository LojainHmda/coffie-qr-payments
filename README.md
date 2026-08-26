# Coffee Machine Payments — AFS Gateway POC

A small Next.js application whose only purpose is to prove one thing:

> Can we create an AFS checkout, show the AFS Copy&Pay form, take a TEST card
> payment, and verify the result server-side?

It is **TEST environment only**. No real money moves.

---

## Current scope

**Machine-first ordering** — the customer chooses their drinks *on the machine*.
The machine asks this server to price and record the order, then prints a QR for
that one order. The phone that scans it can do exactly one thing: pay.

```
Machine screen -> Order (priced here) -> per-order QR
                                            |
                                       phone scans
                                            |
                                    Payment -> AFS transaction
                                            |
                             machine polls -> dispense
```

- The QR is **per order, not per machine**. It carries one opaque pay token,
  expires (15 minutes by default), and is useless once the order is paid.
- Machines are authenticated API clients: an order is attributed to whoever
  holds the key, and no request body can claim a different machine.
- Multi-drink baskets with quantities, totalled in integer minor units so no
  floating-point drift ever reaches AFS.
- Server-owned pricing: the machine sends product ids and counts, never a price.
  The phone sends neither.
- Payment-method abstraction (CARD / APPLE_PAY / GOOGLE_PAY) that offers only
  what AFS has actually provisioned — today that is card only.
- Prepare an AFS checkout server-to-server (`POST /v1/checkouts`).
- Render the official AFS Copy&Pay widget in the browser.
- Verify the outcome server-to-server (`GET /v1/checkouts/{id}/payment`).
- Idempotent verification: refreshing the result page cannot duplicate an order.
- The machine is told to dispense only after that server-side verification —
  never because a phone reached a success screen.
- Owner dashboard with machine and status filters.
- A webhook endpoint that is reachable and ready for AFS to configure.

## Not included yet

Real coffee machine hardware · dispensing · inventory · stock · production
payments · customer accounts · refunds · subscriptions · database persistence ·
authentication on the admin pages or the machine screen.

**Orders and payments are held in memory.** Restarting the dev server clears
them, and with them every outstanding pay token.

---

## The flow, and who is allowed to say what

| Step | Who | May state | May never state |
| --- | --- | --- | --- |
| Choose drinks | customer, on the machine | — | — |
| Create order | machine (API key) | product ids, quantities | its own identity, any price |
| Show QR | machine | — | the pay token as readable text |
| Pay | customer's phone | pay token, payment method | machine, product, order id, amount |
| Settle | this server, talking to AFS | everything | — |
| Dispense | machine (polling) | — | — |

The customer's phone holds one opaque token that resolves to one already-priced
order. There is nothing left in the payment request to tamper with.

---

## Pages

| Path | Who | What |
| --- | --- | --- |
| `/machine/{code}` | the machine | The machine's own screen: choose drinks, print the QR, wait for payment, dispense |
| `/admin/machines` | you | Machine registry and a link into each machine's screen |
| `/admin/orders` | owner | Every order: machine, items, amount, method, status, AFS transaction id |
| `/pay/{payToken}` | customer | The scanned order: its items, its total, and the ways to pay |
| `/pay/{payToken}/result` | customer | shopperResultUrl target; verifies with AFS and shows the outcome |
| `/payment-test` | you | The original fixed-amount AFS harness, kept for regressions |

## Machine API

For real hardware. The simulator at `/machine/{code}` uses server actions
instead, so no machine key is ever sent to a browser.

```bash
# Ring up an order
curl -X POST http://localhost:3000/api/v1/machine/orders \
  -H "Authorization: Bearer $MACHINE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lines":[{"productId":"prd_coffee","quantity":2}]}'
# -> { orderId, orderNumber, total, currency, payToken, payUrl, qrSvg, expiresAt }

# Poll until it is time to pour
curl http://localhost:3000/api/v1/machine/orders/$ORDER_ID \
  -H "Authorization: Bearer $MACHINE_KEY"
# -> { status, total, currency, items, dispense }
```

`dispense` turns true only after this server has verified the payment with AFS.
A machine can only read its own orders, even with a valid key.

---

## Test it from your phone

Both devices must be on the same Wi-Fi.

1. `npm run dev` — Next.js already listens on every interface.
2. Find your LAN address (`ipconfig` on Windows, e.g. `192.168.1.45`).
3. On your computer, open the machine's screen at
   **http://<lan-ip>:3000/machine/MACHINE-001**.
   Opening it at that address is what makes the QR encode it too; the screen
   warns you if the code still points at localhost.
4. Choose drinks with the + buttons — say two Coffees — and tap **Checkout**.
   The machine screen now shows a QR and the total, AED 6.00.
5. Scan that QR with the phone's normal camera app. No app install.
6. The phone shows the order you just rang up. There is nothing to choose:
   only how to pay. Only Card appears, because that is the only method AFS has
   provisioned (see **Payment methods** below).
7. Pay with an AFS test card; complete the 3-D Secure challenge if prompted.
8. The phone lands on the result page, which verifies with AFS server-side.
9. Watch the machine screen: within a couple of seconds it flips to
   **Payment received / Dispensing your drink**. That came from polling the
   server, not from the phone.
10. Open **http://<lan-ip>:3000/admin/orders** to see the order.

Leave the QR unpaid for 15 minutes and both screens say so — the code expires,
and the phone explains that nothing was charged.

If Windows Firewall blocks the connection, allow inbound TCP 3000 for private
networks.

### Why `allowedDevOrigins` is in `next.config.ts`

Next.js blocks cross-origin requests to dev-only assets. Opening the app at
`http://192.168.1.45:3000` when the dev server was started as `localhost` makes
`/_next/static/chunks/*.js` return **403**. The page still looks right, because
it is server-rendered — but the client bundle never loads, nothing hydrates,
and every button is dead HTML. It reads as broken JavaScript rather than a
blocked request.

`next.config.ts` therefore detects this machine's LAN addresses with
`os.networkInterfaces()` and allows them, so the QR flow works on whatever
Wi-Fi you are on with no config edit. `DEV_ORIGINS=host1,host2` adds more (a
tunnel hostname, a `.local` name). The setting is development-only.

---

## Payment methods — measured, not assumed

`lib/payments/methods.ts` decides what the customer is offered. Two gates must
both pass before a button appears:

1. **Merchant gate** — has AFS provisioned this method on our entity?
2. **Device gate** — can this browser really complete it? Checked with the
   vendors' own availability APIs in
   `components/pay/useAvailablePaymentMethods.ts`, never by sniffing the user
   agent.

### What the configured entity actually supports

Probed against the live TEST gateway. For a real checkout on our entity the
Copy&Pay widget resolves:

```json
"brandConfig": { "brands": ["MASTER","VISA"], "overrideShopBrands": true }
```

and the widget payload contains **no `applePayConfig` and no `googlePayConfig`**
(it does contain `samsungPayConfig`, `pazeConfig`, `clickToPayConfig` and
others, so their absence is meaningful).

Note that `POST /v1/checkouts` happily accepts `paymentBrand=APPLEPAY` and
returns `000.200.100`. AFS does not validate brand provisioning at checkout
creation, so **that response is not evidence of wallet support.** The resolved
widget brand list is.

**Conclusion: as last probed, Apple Pay and Google Pay were not provisioned.**
Until AFS enables them the app shows card only, and says on screen why each
wallet is missing rather than leaving a silent gap.

### The wallet integration itself is built

All three methods are implemented end to end, so enabling a wallet is
configuration, not code:

| Path | Purpose |
| --- | --- |
| `lib/payments/methods.ts` | Merchant gate + the `data-brands` token per method |
| `lib/payments/wallets.ts` | Builds the browser-safe Apple Pay / Google Pay config |
| `components/pay/wpwlOptions.ts` | Turns that config into `window.wpwlOptions` |
| `components/pay/useAvailablePaymentMethods.ts` | Device gate, with a reason per wallet |

A wallet button is not just `APPLEPAY` in `data-brands`. The Copy&Pay widget
wraps the Apple Pay JS API and the Google Pay API, and both need merchant
configuration that AFS cannot infer from the checkout — Apple's `total`,
`currencyCode`, `countryCode`, `supportedNetworks` and `merchantCapabilities`;
Google's **mandatory** `gatewayMerchantId`. That is what
`lib/payments/wallets.ts` produces and `wpwlOptions.ts` applies, before the
widget script loads (it reads the global exactly once at boot).

Two details worth knowing:

- The Apple Pay sheet's total comes from the **checkout the server created**,
  not from the price this page rendered, so the sheet always shows what AFS
  will actually charge.
- `googlePay.gatewayMerchantId` is the AFS entity id, so the entity id — and
  only the entity id — is sent to the browser. The access token is not read by
  that module at all, and a unit test asserts it never appears in the payload.

### To enable Apple Pay

1. AFS enables the `APPLEPAY` brand on the entity.
2. Certificates. Either use AFS's (Open Payment Platform → Administration →
   Mobile Payment → *Apple Pay Web Merchant Registration*: host the
   domain-verification file, register the domain — no Apple developer account
   needed), or your own Merchant ID plus a Payment Processing Certificate and a
   Merchant Identity Certificate generated from the CSRs OPP issues.
3. Every serving domain registered — with AFS, or with Apple if you brought
   your own certificates — and serving
   `/.well-known/apple-developer-merchantid-domain-association`.
4. HTTPS on a public domain. A LAN address can never show Apple Pay.
5. Safari / iOS WebKit, or any browser on iOS 18 when
   `AFS_APPLE_PAY_MERCHANT_ID` is set (that switches the availability check to
   Apple's `applePayCapabilities`, which also reports whether the customer has
   a card that can pay on the web).

### To enable Google Pay

1. AFS enables the `GOOGLEPAY` brand on the entity.
2. `AFS_ENTITY_ID` — already configured; it is sent as `gatewayMerchantId`.
3. A Google Pay Business Console merchant id for production
   (`AFS_GOOGLE_PAY_MERCHANT_ID`). TEST works before approval.
4. HTTPS — the API requires a secure context.
5. Chrome / Chromium / Android.

Then set `AFS_WALLET_METHODS=APPLE_PAY,GOOGLE_PAY` (or either) and check the
wallet variables in `.env.local.example`. If the acquirer decrypts the wallet
token rather than AFS, set `AFS_WALLET_DECRYPTION=ACQUIRER` — the brands become
`APPLEPAYTKN` / `GOOGLEPAYTKN` and Google Pay additionally needs
`AFS_GOOGLE_PAY_GATEWAY`.

Because both wallets need HTTPS, neither can be demoed over the LAN address.
Use the Cloud Run URL, or a tunnel
(`cloudflared tunnel --url http://localhost:3000`) with `APP_BASE_URL` set to
the https URL.

A wallet named in `AFS_WALLET_METHODS` but missing what it needs degrades to
"no button" rather than to a broken page, and logs `wallet.config.incomplete`
saying what is missing.

---

## Architecture

```
COFFEE MACHINE (/machine/{code})
   │  customer picks drinks on the machine itself
   │  1. POST /api/v1/machine/orders     Authorization: Bearer <machine key>
   │     { lines: [{ productId, quantity }] }        (no prices in the request)
   ▼
Next.js  ── resolves the machine FROM THE KEY, prices each line from the
   │        catalogue, totals in integer minor units, mints a pay token
   │  2. { orderId, total, currency, payToken, payUrl, qrSvg, expiresAt }
   ▼
Machine prints a QR of  {base}/pay/{payToken}      ← per order, expires
   │
   │  customer scans it
   ▼
PHONE (/pay/{payToken})
   │  shows the order the machine rang up; the only choice left is how to pay
   │  3. POST /api/v1/payments/checkout   { payToken, method }
   ▼
Next.js API route  ──4. POST https://eu-test.oppwa.com/v1/checkouts──▶  AFS
   │                    Authorization: Bearer <AFS_ACCESS_TOKEN>          │
   │                    entityId, amount=<the ORDER's total>, currency,   │
   │                    paymentType=DB, merchantTransactionId,            │
   │                    customer.*/billing.* (3DS2), integrity=true       │
   │                    (NOT shopperResultUrl — see gotcha below)         │
   │  ◀───────────────  5. { id: checkoutId, result.code: 000.200.100 } ──┘
   │
   │  6. { checkoutId, amount, currency, widgetScriptUrl, integrity, brands }
   ▼
Phone loads https://eu-test.oppwa.com/v1/paymentWidgets.js?checkoutId=…
   │  7. AFS renders the card form (or the wallet sheet); the form's action
   │     carries the shopperResultUrl. Card data goes phone → AFS only.
   │     It never touches this application.
   │     3-D Secure challenge (if the card requires it) happens here.
   ▼
AFS redirects to shopperResultUrl:
   /pay/{payToken}/result?resourcePath=/v1/checkouts/{checkoutId}/payment
   │
   ▼
Result page (server component)
   │  8. GET https://eu-test.oppwa.com{resourcePath}?entityId=…  ──▶  AFS
   │  ◀── { id, amount, currency, result.code, paymentBrand } ──────┘
   │  9. Classify the result code, check amount + currency match what the
   │     server asked for, check the checkout belongs to THIS order,
   │     then mark the order PAID and render SUCCESS / FAILED.
   ▼
        ┌──────────────────────────────────────────┐
        │ Meanwhile the machine has been polling   │
        │ GET /api/v1/machine/orders/{orderId}     │
        │ It sees dispense:true and pours.         │
        └──────────────────────────────────────────┘

(separately) AFS ──POST──▶ /api/v1/payments/afs/webhook   [not yet verified]
```

**The redirect is never treated as proof of payment.** Only step 8 decides —
and only step 8 is what eventually makes a drink come out.

### Where things live

| Path | Purpose |
| --- | --- |
| `lib/catalog/machines.ts` | Machine registry + API-key identity (constant-time) |
| `lib/catalog/products.ts` | Product catalogue — the only authority on price |
| `lib/orders/order.ts` | `Order`, `OrderItem`, `OrderStatus`, the pay window |
| `lib/orders/store.ts` | In-memory order store + the payToken index |
| `lib/orders/checkout.ts` | Machine basket -> order -> checkout -> verified payment -> dispense |
| `lib/orders/money.ts` | Integer-minor-unit arithmetic; no float ever reaches AFS |
| `lib/machines/auth.ts` | `Authorization: Bearer <machine key>` |
| `lib/machines/orderQr.ts` | Renders an order's QR to SVG, server-side |
| `lib/qr/url.ts` | Which base URL a QR should encode |
| `lib/payments/methods.ts` | Which payment methods AFS has actually provisioned |
| `lib/payments/wallets.ts` | Apple Pay / Google Pay widget configuration (browser-safe) |
| `components/pay/wpwlOptions.ts` | Builds `window.wpwlOptions` for the chosen method |
| `components/pay/useAvailablePaymentMethods.ts` | Device gate: can this browser really pay this way |
| `lib/payments/payment.ts` | `PaymentStatus`, `PaymentMethod`, `PaymentRecord` — provider-independent |
| `lib/payments/store.ts` | In-memory payment store, with the terminal-state guard |
| `lib/payments/afs/client.ts` | The only place that talks HTTP to AFS |
| `lib/payments/afs/service.ts` | `prepareCheckout` / `verifyPaymentByResourcePath` |
| `lib/payments/afs/verification.ts` | Result-code classification + amount/currency check |
| `lib/payments/afs/webhook.ts` | Webhook envelope + AES-256-GCM decryption (pending key) |
| `lib/payments/afs/config.ts` | Environment validation, `getAppBaseUrl` |
| `lib/payments/log.ts` | Sanitised logging |
| `lib/validation/payment.ts` | Zod request schemas |
| `app/machine/[code]/**` | The machine's screen and its server actions |
| `app/pay/[token]/**` | Customer payment flow, keyed by pay token |
| `app/admin/**` | Machine registry and owner dashboard |
| `app/api/v1/machine/orders` | Machine creates an order (authenticated) |
| `app/api/v1/machine/orders/[orderId]` | Machine polls it until `dispense` |
| `app/api/v1/payments/checkout` | Create the AFS checkout for a scanned pay token |
| `app/api/v1/payments/afs/status` | Server-side payment verification (JSON) |
| `app/api/v1/payments/afs/webhook` | Receives AFS notifications |

--- | --- |
| `app/payment-test/page.tsx` | The POC page |
| `app/payment-test/components/PaymentTest.tsx` | Start Payment button + Copy&Pay widget mount |
| `app/payment-test/result/page.tsx` | shopperResultUrl target; verifies server-side and renders the result |
| `app/api/v1/payments/afs/checkout/route.ts` | Creates the AFS checkout |
| `app/api/v1/payments/afs/status/route.ts` | Server-side payment verification (JSON) |
| `app/api/v1/payments/afs/webhook/route.ts` | Receives AFS notifications |
| `lib/payments/afs/client.ts` | The only place that talks HTTP to AFS |
| `lib/payments/afs/service.ts` | prepareTestCheckout / verifyPaymentByResourcePath |
| `lib/payments/afs/verification.ts` | Result-code classification + amount/currency check |
| `lib/payments/afs/webhook.ts` | Webhook envelope + AES-256-GCM decryption (pending key) |
| `lib/payments/afs/config.ts` | Environment validation |
| `lib/payments/payment.ts` | `PaymentStatus`, `PaymentRecord` — provider-independent |
| `lib/payments/store.ts` | In-memory payment store (swap for a table later) |
| `lib/payments/log.ts` | Sanitised logging |
| `lib/validation/payment.ts` | Zod request schemas |

---

## Environment setup

Copy the example file and fill in the two secrets AFS gave you:

```bash
cp .env.local.example .env.local
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `AFS_ENTITY_ID` | yes | Merchant entity id from AFS. |
| `AFS_ACCESS_TOKEN` | yes | Bearer token from AFS. **Server-side only.** |
| `AFS_BASE_URL` | no (default `https://eu-test.oppwa.com/`) | AFS endpoint. Must be https and end with `/`. |
| `AFS_CURRENCY` | no (default `AED`) | ISO 4217 code. |
| `AFS_WEBHOOK_DECRYPTION_KEY` | not yet | 64 hex characters. AFS supplies it after they configure our webhook URL. Leave empty for now. |
| `APP_BASE_URL` | no | Absolute public URL of this app. Leave empty locally — the Host header the client used is used instead, which is what makes the LAN flow work. |
| `AFS_WALLET_METHODS` | no | Wallets AFS has provisioned: `APPLE_PAY`, `GOOGLE_PAY`. Empty = card only. Set it only after AFS confirms the wallet is live on the entity. |
| `AFS_WALLET_DISPLAY_NAME` | no (default `Coffee Machine`) | Merchant name on both wallet sheets, and the Apple Pay total's label. |
| `AFS_WALLET_COUNTRY` | no (default `AE`) | ISO 3166 country for the Apple Pay sheet. |
| `AFS_WALLET_NETWORKS` | no (default `VISA,MASTERCARD`) | Card networks offered in both wallets; translated to each vendor's spelling. |
| `AFS_APPLE_PAY_MERCHANT_ID` | no | Apple Merchant ID. Empty = the entity id is used, which is right when AFS supplies the certificates. |
| `AFS_GOOGLE_PAY_MERCHANT_ID` | production | Google Pay Business Console merchant id. Google requires it once the site is approved. |
| `AFS_WALLET_DECRYPTION` | no (default `PLATFORM`) | `PLATFORM` (AFS decrypts) or `ACQUIRER` (`APPLEPAYTKN` / `GOOGLEPAYTKN`). |
| `AFS_GOOGLE_PAY_GATEWAY` | with `ACQUIRER` | Payment provider configured for Google Pay, sent as `googlePay.gateway`. |
| `AFS_WALLET_COLLECT_CONTACT` | no (default off) | Ask the wallet sheet for email + billing address and submit them with the payment. |
| `QR_BASE_URL` | no | Forces the URL the QR codes encode. Leave empty; the machine screen uses the address you opened it with. |
| `MACHINE_API_KEYS` | production | `MACHINE-001:key,MACHINE-002:key`. Without it every machine uses the demo key committed to this repo. |
| `ORDER_PAY_WINDOW_MINUTES` | no (default `15`) | How long a printed QR can still start a payment. |

Rules that are enforced, not just documented:

- None of these may be prefixed `NEXT_PUBLIC_`. The token would ship to the browser.
- `.env.local` is git-ignored; `.env.local.example` (placeholders only) is committed.
- The access token is attached to requests in `lib/payments/afs/client.ts` and
  nowhere else. It is never returned in an API response and never logged.

---

## Run locally

```bash
npm install
npm run dev
```

Then open:

**http://localhost:3000/payment-test**

Other commands:

```bash
npm test        # unit tests (AFS is mocked; no credentials needed)
npm run typecheck
npm run lint
npm run build
```

---

## Manual end-to-end test (AFS TEST environment)

1. Put the real `AFS_ENTITY_ID` and `AFS_ACCESS_TOKEN` in `.env.local`.
2. `npm run dev`.
3. Open http://localhost:3000/payment-test — it shows Coffee, AED 5.00.
4. Click **Start Payment**. The backend calls AFS and the Copy&Pay form appears.
5. Enter an **AFS test card**. Expiry: any future date. CVV: any 3 digits.
   Test card numbers come from AFS — either the testing page of
   https://afs.docs.oppwa.com/ or the onboarding pack AFS sent. Do not invent
   card numbers and never use a real card.
6. Submit. If the card is a 3-D Secure **challenge** card, the ACS simulator
   appears with a `transStatus` dropdown — pick **Approve** for a successful
   payment or **Decline** to exercise the failure path — then Submit.
7. AFS redirects to `/payment-test/result?resourcePath=…`. That page calls AFS
   server-to-server and shows SUCCESS or FAILED with the amount, currency,
   transaction id and AFS result code.
8. Check the terminal: the sanitised log lines `afs.checkout.created` and
   `afs.payment.verified` should appear.

Verified against the AFS TEST environment with card `5200000000000015`:

| Challenge choice | Result shown | AFS result code |
| --- | --- | --- |
| Approve | SUCCESS | `000.100.110` Request successfully processed in 'Merchant in Integrator Test Mode' |
| Decline | FAILED | `100.380.401` User Authentication Failed |

### Gotcha: shopperResultUrl belongs to the form, not the checkout

`shopperResultUrl` is **not** sent on `POST /v1/checkouts`. With Copy&Pay the
widget submits it from the payment form's `action`. If the checkout also
carries it, AFS rejects the payment with

```
parameterErrors: [{ name: "shopperResultUrl",
                    message: "was already set and cannot be overwritten" }]
```

The payment then never executes, so the later status lookup returns
`200.300.404 - No payment session found for the requested id` with no
transaction anywhere — which looks like an expiry or credentials problem but
is neither. See the comment in `lib/payments/afs/service.ts`.

To confirm the webhook endpoint is reachable:

```bash
curl http://localhost:3000/api/v1/payments/afs/webhook
# {"endpoint":"afs-webhook","method":"POST","ready":true,"decryptionConfigured":false}
```

---

## Webhook

Give AFS this URL, over HTTPS, once the app is deployed:

```
https://<your-domain>/api/v1/payments/afs/webhook
```

For a local test against real AFS traffic, expose port 3000 with a tunnel
(`ngrok http 3000`, `cloudflared tunnel --url http://localhost:3000`) and give
AFS the tunnel's https URL plus the same path. Set `APP_BASE_URL` to the tunnel
URL so `shopperResultUrl` matches.

Current behaviour: the endpoint accepts the POST, logs metadata only
(content type, whether the IV and auth-tag headers were present, ciphertext
size), and returns `200 {"received":true,"verified":false}`. AFS retries unless
it gets a 2xx within 30 seconds, so it always answers 2xx.

The AES-256-GCM decryption described in the AFS docs is implemented in
`lib/payments/afs/webhook.ts` and covered by a round-trip unit test, but it has
**never been run against a real AFS notification** because
`AFS_WEBHOOK_DECRYPTION_KEY` has not been issued. Until it has, a webhook is not
treated as an authenticated statement about a payment — the status API is the
source of truth.

---

## Security notes

- The machine authenticates with an API key and its identity comes ONLY from
  that key. A request body naming a machine is rejected by `strictObject`, so a
  machine cannot write orders against another machine.
- API keys are compared in constant time over SHA-256 digests, and every
  machine is checked even after a match, so neither the key's contents nor its
  position in the registry leaks through timing.
- The pay token is a bearer credential for exactly one order. It is never
  logged, never returned to the machine after creation, and never rendered as
  text on the machine screen — only inside the QR image.
- The pay window (15 minutes) is enforced when a checkout is CREATED and never
  when one is verified: a customer returning late from a 3-D Secure challenge
  must still have their payment settled and their drink poured.
- Verification checks that the AFS checkout belongs to the same order as the
  scanned token, so a valid token cannot be used to settle someone else's
  payment.
- Order totals are computed in integer minor units. A floating-point total
  would be rejected by AFS as an amount mismatch, or worse, silently accepted.
- The machine dispenses on `dispense:true`, which is set only by the
  server-to-server verification — never by the phone reaching a success screen.
- 3-D Secure 2 needs customer/billing data on the checkout (`TEST_CUSTOMER` in
  `lib/payments/afs/constants.ts`); the widget supplies the card and browser
  data itself. Without it a challenge card cannot authenticate.
- Card data goes from the browser to AFS. It never reaches this application, so
  there is nothing to store, log, or leak.
- The amount is a server constant (`TEST_PAYMENT_AMOUNT`). The checkout endpoint
  rejects a request body that even mentions `amount` or `currency`.
- After payment, the amount and currency AFS reports are compared with what the
  server asked for. A "successful" result code with the wrong amount is recorded
  as FAILED.
- `resourcePath` arrives from the browser and is validated against
  `/v1/checkouts/{id}/payment` before it is used to build a request URL.
- `lib/payments/log.ts` redacts keys matching token/secret/number/cvv/… and masks
  card-number-shaped digit runs. Nothing logs raw request bodies.
- Error responses carry a safe public message; internal detail is added only when
  `NODE_ENV !== "production"`.

---

## Deployment (Google Cloud Run)

Live: `https://coffie-qr-payments-530422771583.us-central1.run.app`
Project `kartacagenai`, region `us-central1`.

```bash
gcloud run deploy coffie-qr-payments --source .   --project kartacagenai --region us-central1   --allow-unauthenticated --port 8080   --min-instances 1 --max-instances 1 --memory 512Mi   --set-env-vars "AFS_BASE_URL=https://eu-test.oppwa.com/,AFS_CURRENCY=AED"
```

`--min-instances 1 --max-instances 1` is **not** a performance setting, it is a
correctness one. Orders and payments live in memory (see `lib/store/memory.ts`),
so a second container would not see orders created by the first and the payment
flow would fail on its second step. Do not raise `--max-instances` until a real
database replaces the in-memory store. One instance also means state is lost
whenever Cloud Run replaces the container — a deploy, a health event, an infra
move — so treat the order history as demo data, not records.

Credentials are never committed and never baked into the image:

- `AFS_ACCESS_TOKEN` comes from Secret Manager (`afs-access-token`).
- `AFS_ENTITY_ID`, `AFS_BASE_URL`, `AFS_CURRENCY` are plain env vars.
- `.gcloudignore` and `.dockerignore` both exclude every `.env*` file except
  the placeholder example, so `.env.local` cannot reach a build context.

`shopperResultUrl` and the QR codes need no configuration: both are derived from
the `Host`/`X-Forwarded-*` headers, so they resolve to the public https URL
automatically. `APP_BASE_URL` / `QR_BASE_URL` override that if ever needed.

---

## Before this can go to production

1. Real AFS production credentials and `AFS_BASE_URL` (currently the TEST host),
   plus a separate live entity id.
2. `AFS_WEBHOOK_DECRYPTION_KEY` from AFS, then verify the decryption in
   `lib/payments/afs/webhook.ts` against a real notification and let verified
   notifications drive payment state.
3. Persistence: replace `lib/payments/store.ts` with a real payments table. The
   in-memory store is lost on restart and is not shared between instances.
4. Authentication on `/admin/*` and `/machine/*`. All of them are wide open
   today, so anyone who can reach the app can ring up an order on any machine.
   Also set `MACHINE_API_KEYS`: the fallback keys are committed to this repo.
5. HTTPS everywhere, plus rate limiting on the order and checkout endpoints —
   today anyone who can reach the app can create unlimited orders and checkouts.
6. Wallet provisioning with AFS if Apple Pay / Google Pay are wanted — the code
   is done, the entity is not (see **Payment methods** above). Also forces a
   public https domain, and for Apple Pay a registered domain-association file.
7. Reconciliation and refunds, monitoring/alerting on `afs.*` log events, and a
   retention policy for payment records.
8. Real machine provisioning and hardware integration: today the three demo
   machines are hard-coded in `lib/catalog/machines.ts`, and `/machine/{code}`
   is a browser stand-in for a screen that does not exist. Real hardware talks
   to the machine API instead — see **Machine API** above.
