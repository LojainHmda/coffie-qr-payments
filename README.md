# Coffee Machine Payments — AFS Gateway POC

A small Next.js application whose only purpose is to prove one thing:

> Can we create an AFS checkout, show the AFS Copy&Pay form, take a TEST card
> payment, and verify the result server-side?

It is **TEST environment only**. No real money moves.

---

## Current scope

**QR payment flow** — the customer scans a machine QR with their phone camera,
picks a drink, pays through AFS, and the owner sees the order.

```
QR -> Machine -> Order -> Product -> Payment -> AFS transaction
```

- Three demo machines, each with its own opaque QR token.
- Server-rendered QR codes on an admin page.
- Mobile-first product selection and payment pages.
- Server-owned pricing: the browser sends a product id, never a price.
- Payment-method abstraction (CARD / APPLE_PAY / GOOGLE_PAY) that offers only
  what AFS has actually provisioned — today that is card only.
- Prepare an AFS checkout server-to-server (`POST /v1/checkouts`).
- Render the official AFS Copy&Pay widget in the browser.
- Verify the outcome server-to-server (`GET /v1/checkouts/{id}/payment`).
- Idempotent verification: refreshing the result page cannot duplicate an order.
- Owner dashboard with machine and status filters.
- A webhook endpoint that is reachable and ready for AFS to configure.

## Not included yet

Coffee machine hardware integration · dispensing · inventory · stock ·
production payments · customer accounts · refunds · subscriptions · database
persistence · authentication on the admin pages.

**Orders and payments are held in memory.** Restarting the dev server clears
them. The QR tokens are hard-coded, so printed QR codes keep working.

---

## Pages

| Path | Who | What |
| --- | --- | --- |
| `/admin/machines` | you | One QR per machine, with its URL and a copy button |
| `/admin/orders` | owner | Every order: machine, product, amount, method, status, AFS transaction id |
| `/pay/{machineToken}` | customer | Drinks available at the scanned machine |
| `/pay/{machineToken}/checkout?productId=` | customer | Price, payment methods, Copy&Pay widget |
| `/pay/{machineToken}/result` | customer | shopperResultUrl target; verifies with AFS and shows the outcome |
| `/payment-test` | you | The original fixed-amount AFS harness, kept for regressions |

---

## Test it from your phone

Both devices must be on the same Wi-Fi.

1. `npm run dev` — Next.js already listens on every interface.
2. Find your LAN address (`ipconfig` on Windows, e.g. `192.168.1.45`).
3. On your computer, open **http://<lan-ip>:3000/admin/machines**.
   Opening it at that address is what makes the QR codes encode it too; the
   page warns you if they still point at localhost.
4. Scan a QR with the phone's normal camera app. No app install.
5. Pick Coffee — AED 3.00.
6. Choose a payment method. Only Card appears, because that is the only method
   AFS has provisioned (see **Payment methods** below).
7. Pay with an AFS test card; complete the 3-D Secure challenge if prompted.
8. You land on the result page, which verifies with AFS server-side.
9. Open **http://<lan-ip>:3000/admin/orders** to see the order.

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

**Conclusion: Apple Pay and Google Pay are not available today.** The app shows
card only, and says so on screen rather than hiding it.

### To enable Apple Pay

1. AFS enables the `APPLEPAY` brand on the entity.
2. Apple Merchant ID plus a payment-processing certificate exchanged with AFS.
3. Every serving domain registered with Apple **and** serving
   `/.well-known/apple-developer-merchantid-domain-association`.
4. HTTPS on a public domain. A LAN address can never show Apple Pay.
5. Safari / iOS WebKit only.

### To enable Google Pay

1. AFS enables the `GOOGLEPAY` brand and supplies the gateway merchant id.
2. A Google Pay Business Console merchant id (TEST works before approval).
3. HTTPS — the API requires a secure context.
4. Chrome / Chromium / Android.

Then set `AFS_WALLET_METHODS=APPLE_PAY,GOOGLE_PAY` (or either). Because both
need HTTPS, a wallet cannot be demoed over the LAN address — that needs a
tunnel (`cloudflared tunnel --url http://localhost:3000`) with `APP_BASE_URL`
set to the https URL.

---

## Architecture

```
Browser (/payment-test)
   │  1. POST /api/v1/payments/afs/checkout        (no amount in the request)
   ▼
Next.js API route  ──2. POST https://eu-test.oppwa.com/v1/checkouts──▶  AFS
   │                    Authorization: Bearer <AFS_ACCESS_TOKEN>          │
   │                    entityId, amount=5.00, currency=AED,              │
   │                    paymentType=DB, merchantTransactionId,            │
   │                    customer.*/billing.* (3DS2), integrity=true       │
   │                    (NOT shopperResultUrl — see gotcha below)         │
   │  ◀───────────────  3. { id: checkoutId, result.code: 000.200.100 } ──┘
   │
   │  4. { checkoutId, amount, currency, widgetScriptUrl, integrity }
   ▼
Browser loads https://eu-test.oppwa.com/v1/paymentWidgets.js?checkoutId=…
   │  5. AFS renders the card form; the form's action carries the
   │     shopperResultUrl. Card data goes browser → AFS only.
   │     It never touches this application.
   │     3-D Secure challenge (if the card requires it) happens here.
   ▼
AFS redirects to shopperResultUrl:
   /payment-test/result?resourcePath=/v1/checkouts/{checkoutId}/payment
   │
   ▼
Result page (server component)
   │  6. GET https://eu-test.oppwa.com{resourcePath}?entityId=…  ──▶  AFS
   │  ◀── { id, amount, currency, result.code, paymentBrand } ──────┘
   │  7. Classify the result code, check amount + currency match what the
   │     server asked for, then render SUCCESS / FAILED.
   ▼
SUCCESS or FAILED shown to the customer

(separately) AFS ──POST──▶ /api/v1/payments/afs/webhook   [not yet verified]
```

**The redirect is never treated as proof of payment.** Only step 6 decides.

### Where things live

| Path | Purpose |
| --- | --- |
| `lib/catalog/machines.ts` | Machine registry + opaque QR token resolution |
| `lib/catalog/products.ts` | Product catalogue — the only authority on price |
| `lib/orders/order.ts` | `Order`, `OrderItem`, `OrderStatus` |
| `lib/orders/store.ts` | In-memory order store (swap for a table later) |
| `lib/orders/checkout.ts` | QR token -> order -> checkout -> verified payment |
| `lib/qr/url.ts` | Which base URL a QR should encode |
| `lib/payments/methods.ts` | Which payment methods AFS has actually provisioned |
| `lib/payments/payment.ts` | `PaymentStatus`, `PaymentMethod`, `PaymentRecord` — provider-independent |
| `lib/payments/store.ts` | In-memory payment store, with the terminal-state guard |
| `lib/payments/afs/client.ts` | The only place that talks HTTP to AFS |
| `lib/payments/afs/service.ts` | `prepareCheckout` / `verifyPaymentByResourcePath` |
| `lib/payments/afs/verification.ts` | Result-code classification + amount/currency check |
| `lib/payments/afs/webhook.ts` | Webhook envelope + AES-256-GCM decryption (pending key) |
| `lib/payments/afs/config.ts` | Environment validation, `getAppBaseUrl` |
| `lib/payments/log.ts` | Sanitised logging |
| `lib/validation/payment.ts` | Zod request schemas |
| `app/pay/[token]/**` | Customer QR flow |
| `app/admin/**` | QR demo page and owner dashboard |
| `app/api/v1/orders` | Create an order from a machine token + product id |
| `app/api/v1/payments/checkout` | Create the AFS checkout for an order |
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
| `AFS_WALLET_METHODS` | no | Wallets AFS has provisioned: `APPLE_PAY`, `GOOGLE_PAY`. **Leave empty** — neither is enabled on the current entity. |
| `QR_BASE_URL` | no | Forces the URL the QR codes encode. Leave empty; the QR page uses the address you opened it with. |

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
4. Authentication on `/admin/*`. Both admin pages are wide open today.
5. HTTPS everywhere, plus rate limiting on the order and checkout endpoints —
   today anyone who can reach the app can create unlimited orders and checkouts.
6. Wallet provisioning with AFS if Apple Pay / Google Pay are wanted (see
   **Payment methods** above), which also forces a public https domain.
7. Reconciliation and refunds, monitoring/alerting on `afs.*` log events, and a
   retention policy for payment records.
8. Real machine provisioning: today the three demo machines and their QR tokens
   are hard-coded in `lib/catalog/machines.ts`.
