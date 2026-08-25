# TTFL Store — Backend (Identity & Access)

Phase 1 of the TTFL Store backend: users, vendors, admin, and full
authentication. Products, orders, payments, and commissions extend this
same codebase additively in later phases.

## Stack
- Node.js + TypeScript, Express
- PostgreSQL via Prisma ORM
- Argon2id password hashing
- JWT access tokens (15 min) + rotating opaque refresh tokens (30 days), both in httpOnly cookies
- Zod request validation, Helmet, CORS, rate limiting
- Winston logging

## ⚠️ Not verified in this sandbox
This environment's network allowlist doesn't include `binaries.prisma.sh`,
so `prisma generate` / `prisma validate` couldn't run here — the same way
Google Fonts couldn't be fetched for the frontend build. The schema and
TypeScript were written and reviewed carefully, but **run `npm install &&
npx prisma generate` locally before you trust it compiles clean**, and fix
forward from whatever `tsc` reports.

## Setup
```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and JWT secrets at minimum
npx prisma generate
npx prisma migrate dev --name init
npm run dev             # http://localhost:4000
```

Create your first admin:
```bash
ADMIN_EMAIL=you@thetronforge.com ADMIN_PASSWORD=SomeStrongPass1 npm run seed:admin
```

## Deploy (Render)
1. New Web Service → connect this repo.
2. Build command: `npm install && npm run build`
3. Start command: `npx prisma migrate deploy && npm start`
4. Add a Render PostgreSQL instance, set `DATABASE_URL` from it.
5. Set `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (32+ random chars each),
   `APP_URL` (your Vercel frontend URL), `CORS_ORIGIN` (same), and
   `COOKIE_CROSS_SITE=true` since frontend and backend are on different
   domains.

## Structure
```
prisma/schema.prisma       User, Address, Session, verification/reset tokens,
                            VendorProfile, AuditLog
prisma/seed.ts              bootstraps one admin account
src/config/env.ts           typed env, fails fast if required vars missing
src/lib/                    prisma client, jwt, password hashing, opaque
                             tokens, cookies, logger, email stub
src/middleware/             auth (JWT + RBAC), rate limiting, error handler
src/modules/auth/           register (customer/vendor), login, refresh,
                             logout, verify email, forgot/reset/change
                             password, delete account, /me
src/modules/vendors/        vendor self-service profile + admin
                             approve/reject/suspend/tier endpoints
src/app.ts, src/server.ts   Express app assembly + bootstrap
```

## Auth model
- **Three roles**: `CUSTOMER`, `VENDOR`, `ADMIN` on a single `User` table —
  matches spec §9. A `VendorProfile` is created alongside the user on
  vendor registration, starting `status: PENDING` until an admin approves
  it (spec §17, §36).
- **Access/refresh split**: short-lived JWT for authorization checks on
  every request, long-lived opaque refresh token stored server-side
  (hashed) so any session can be revoked instantly — required for "session
  management" and "login security" in spec §8.
- **Refresh rotation**: every `/refresh` call invalidates the token it was
  given and issues a new one, so a leaked-but-already-used refresh token is
  a dead end.
- **Password reset invalidates all sessions** — if someone's password was
  compromised, resetting it kills every active login, not just the current
  one.
- **OAuth-ready**: the schema and login flow don't assume password-only —
  adding `POST /api/auth/oauth/:provider` later just needs to find-or-create
  a `User` and call the same `issueSession` helper. No rebuild required, per
  spec §8.

## API reference (Phase 1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register/customer | — | Create a customer account |
| POST | /api/auth/register/vendor | — | Create a vendor account + pending store |
| POST | /api/auth/login | — | Log in |
| POST | /api/auth/refresh | refresh cookie | Rotate session |
| POST | /api/auth/logout | — | Revoke current session |
| POST | /api/auth/verify-email | — | Confirm email with token |
| POST | /api/auth/forgot-password | — | Request reset link |
| POST | /api/auth/reset-password | — | Reset with token |
| GET | /api/auth/me | required | Current user |
| POST | /api/auth/change-password | required | Change password |
| DELETE | /api/auth/account | required | Soft-delete own account |
| GET | /api/vendors/me/store | vendor | Own store profile |
| GET | /api/vendors/admin/applications | admin | List vendor applications |
| POST | /api/vendors/admin/:id/approve | admin | Approve vendor |
| POST | /api/vendors/admin/:id/reject | admin | Reject vendor (with reason) |
| POST | /api/vendors/admin/:id/suspend | admin | Suspend vendor |
| POST | /api/vendors/admin/:id/tier | admin | Change vendor tier |
| GET | /api/categories | — | List top-level categories + children |
| GET | /api/categories/:slug | — | Category detail |
| POST | /api/categories | admin | Create category |
| PATCH | /api/categories/:id | admin | Update category |
| GET | /api/products | — | Search/filter/paginate active products |
| GET | /api/products/:slug | — | Product detail (increments view count) |
| GET | /api/products/me/list | vendor | Own listings |
| POST | /api/products | vendor (approved) | Create a product |
| PATCH | /api/products/:id | vendor (owner) | Update own product |
| DELETE | /api/products/:id | vendor (owner) | Soft-delete own product |
| POST | /api/products/by-id/:id/referral | — | Record an external-link/WhatsApp click, returns the destination to redirect to |
| POST | /api/products/:id/suspend | admin | Suspend a listing |
| POST | /api/products/:id/reinstate | admin | Reinstate a suspended listing |
| POST | /api/orders/checkout | customer | Create order + Paystack checkout link |
| GET | /api/orders/verify/:reference | required | Re-verify a payment (fallback to webhook) |
| POST | /api/payments/webhook | Paystack only (HMAC-signed) | Confirms payment, finalizes order |
| GET | /api/orders/me | customer | Own order history |
| GET | /api/orders/:orderNumber | owner / vendor-on-order / admin | Order detail |
| GET | /api/orders/vendor/me | vendor | Own sub-orders to fulfill |
| PATCH | /api/orders/vendor/:id/status | vendor (owner) | Advance fulfillment status |

## Catalog & selling methods (Phase 2, new)

- **Categories**: simple one-level parent/child tree (`Category.parentId`).
  Admin-managed; slugs auto-generated and de-duplicated.
- **Products**: belong to one vendor + one category, carry price/previous
  price (discount is derived, not stored), condition, stock, images
  (ordered, first = primary), free-form `specifications` JSON, and a
  `sellingMethod`.
- **Vendors must be `APPROVED` before they can list products** — enforced
  in the service layer, not just a UI assumption.
- **Selling method validation is a discriminated union** (spec §14):
  `CHECKOUT` needs nothing extra, `EXTERNAL_LINK` requires a valid
  `externalUrl`, `WHATSAPP` accepts an optional per-product number and
  falls back to the vendor's store WhatsApp number.
- **Referral tracking (spec §15)**: the frontend calls
  `POST /api/products/by-id/:id/referral` *before* opening the external
  link or WhatsApp chat. The row is written to `ReferralEvent` first, and
  the response hands back the exact destination URL (including a
  pre-filled WhatsApp message) — so a click can never happen without being
  recorded, and the frontend never needs to know the vendor's raw WhatsApp
  number or construct wa.me links itself.
- **Search** (`GET /api/products`) supports free-text (`q`), category,
  vendor, price range, condition, selling method, location, verified-only,
  sort (relevance/price/newest), and pagination — spec §11's filter list,
  minus rating (no reviews table yet, so `sort=rating` currently falls back
  to popularity-by-views).

## Commerce loop (Phase 3, new)

- **Cart lives on the frontend** — nothing server-side until checkout, so
  browsing doesn't need auth. `POST /api/orders/checkout` takes a flat list
  of `{productId, quantity}` and a delivery address.
- **Multi-vendor split (spec §22)**: checkout groups cart items by vendor
  into one `Order` (what the customer paid, once) with one `VendorOrder`
  per vendor inside it (what each vendor fulfills and gets paid for,
  independently — separate status, separate commission line).
- **Only `CHECKOUT`-method products can go through the cart** — products
  listed as `EXTERNAL_LINK` or `WHATSAPP` are rejected at checkout with a
  clear error, since they're sold off-platform by design (spec §14).
- **Stock and price are re-validated server-side at checkout**, never
  trusted from the client, and stock is decremented inside the same DB
  transaction that marks the order paid — so two people can't both buy the
  last unit.
- **Paystack (spec §20)**: `lib/paystack.ts` wraps initialize/verify and
  HMAC-SHA512 webhook signature checking. The secret key never leaves the
  backend. `verifyAndFinalizePayment` is idempotent and re-verifies the
  amount against Paystack directly — it's called from both the webhook
  (source of truth) and a `/verify/:reference` fallback the frontend can
  poll after the Paystack redirect, so a slow/missed webhook doesn't strand
  a paid order in "pending."
- **Webhook body handling**: the raw-body route is registered in `app.ts`
  *before* `express.json()` specifically because HMAC verification needs
  the exact bytes Paystack sent — see the comment there if you're wiring
  in another webhook later and wondering why it's not just another route
  file.
- **Commissions (spec §16)**: `lib/commissions.ts` resolves a rate per
  vendor — an active `CommissionRule` row wins, then
  `VendorProfile.commissionRateOverride`, then a hard-coded tier default
  (Free 8% / Pro 6% / Business 4% / Enterprise 2%). The resolved rate and
  amount are snapshotted onto the `VendorOrder` at checkout time, so a
  later rate change never rewrites a past order's numbers.
- **Order numbers**: `TTFL-{year}-{6 random digits}`, retried on collision.
- **Fulfillment status**: vendors move their own `VendorOrder` forward
  through a fixed transition map (`PENDING → PROCESSING → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`,
  with `CANCELLED` allowed early on) — enforced in the service layer, not
  just left to the frontend to get right.

⚠️ You'll need real Paystack test keys (`PAYSTACK_SECRET_KEY`,
`PAYSTACK_PUBLIC_KEY`) in `.env` to exercise checkout at all — I don't have
an account to generate them, and this sandbox couldn't reach
`api.paystack.co` even if I did. Register a free Paystack test account and
point the webhook URL (Paystack dashboard → Settings → API Keys & Webhooks)
at `https://<your-render-url>/api/payments/webhook`.

## Phase 2 — commission/tier/notification hardening + full marketplace features

Everything below is new since the checkout-loop handoff. Commission rates
now come from the `VendorPlan` table (admin-editable) instead of a
hard-coded map — see `lib/commissions.ts` and `modules/vendor-plans/`.

### Vendor tiers, actually enforced
`VendorPlan` (one row per tier, admin CRUD via `PUT /api/vendor-plans/:tier`)
holds price, billing period, product limit, commission rate, and a free-form
features list. `products.service.createProduct` calls
`assertProductLimitNotExceeded` before every insert — a FREE-tier vendor
genuinely cannot create product #21 if their plan caps at 20; this isn't a
frontend-only restriction.

### Vendor subscriptions
`modules/subscriptions/` — FREE activates instantly (no charge), paid tiers
go through Paystack exactly like checkout (initialize → customer pays →
`verifyAndActivateSubscription` re-verifies against Paystack directly before
flipping `VendorProfile.tier`). Cancelling drops a vendor to FREE immediately
— there's no scheduled downgrade-at-renewal job, so a cancelled paid plan
doesn't run out its remaining paid period; flagged here as a real gap, not
silently glossed over.

### Featured products & stores
`modules/featured/` — same Paystack-then-verify pattern. Placement pricing
(`PLACEMENT_PRICE_PER_DAY` in `featured.service.ts`) is still a hard-coded
constant, not an admin-configurable table — the one deliberate scope cut in
this pass, called out in the file itself. Public `GET /api/featured/products?placement=HOMEPAGE`
etc. is what the frontend homepage/category/search pages should call to pull
active paid placements.

### Reviews
`modules/reviews/` — a review requires a real `OrderItem` from that
customer's own **paid** order for that exact product; the DB itself enforces
one review per customer per product (`@@unique([productId, customerId])`)
and one review per order item (`orderItemId @unique`), so this can't be
raced around even by two simultaneous requests. `Product.avgRating` /
`reviewCount` are a cache, recomputed after every create/hide/restore/delete
— list pages never need a live join.

### Wishlist, Coupons
Wishlist is a straight add/remove/list against `WishlistItem`. Coupons
(`modules/coupons/`) are validated **only** server-side —
`validateCoupon()` is the single function both the cart-preview endpoint
(`POST /api/coupons/preview`) and real checkout call, so a discount shown in
the UI can never drift from what actually gets charged. Vendor-specific
coupons reduce that vendor's own subtotal/commission; TTFL-wide coupons are
platform-funded and don't touch vendor payouts — see the comment in
`orders.service.checkout` for the reasoning.

### Vendor payouts
`modules/payouts/` — balance is *derived* (sum of `vendorEarnings` on paid,
non-cancelled `VendorOrder`s, minus what's already flagged `payoutStatus:
PAID`), not stored as a running total that could drift. Marking a payout
"paid" is a **record**, not a transfer — spec explicitly said not to
auto-transfer money without a tested integration, so an admin does the
actual bank transfer manually and then marks it here. `MIN_PAYOUT_AMOUNT`
is another hard-coded constant flagged for a future admin-settings table.

### Email — now a real queue, not a console stub
`lib/email-queue.ts` + `lib/email-adapter.ts`. Every `EmailLog` row stores
its own fully-rendered HTML, so retries and even a full backend restart can
resend without any in-memory state — this was a real bug in my first draft
(the queue logged "processing" but had nothing to actually send with) that
I caught and fixed before shipping this pass. Retry backoff: 5s → 30s → 2m →
10m → 30m, then `FAILED`. Set `EMAIL_PROVIDER=smtp` plus `EMAIL_HOST` /
`EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` to actually send; leave it
`console` to keep just logging.

**Honest limitation**: this is an in-process worker (a `setInterval` sweep +
per-message timers), not a separate worker backed by Redis/BullMQ. That
needs a Redis instance — one more external account this project doesn't
have. It works correctly for a single backend instance; it will double-send
if you ever run more than one instance of this backend without swapping
this file's internals for a real job queue.

### WhatsApp notifications
`lib/whatsapp-notifications.ts` — real Meta WhatsApp Business Cloud API
integration (not a mock), gated behind `WHATSAPP_API_TOKEN` /
`WHATSAPP_PHONE_NUMBER_ID`. Without those set, it logs instead of sending —
same honest pattern as the email adapter before a provider's configured.
The **customer-facing** "Chat on WhatsApp" button (spec §14/§15) needed no
API and was already working before this phase; this only adds
admin/vendor push notifications (new order, new vendor application).

### Live support
`modules/support/` — REST-polled conversations (`SupportConversation` +
`SupportMessage`), not WebSockets. That's a deliberate scope call: real-time
chat needs a persistent-connection layer that's a bigger infrastructure
decision than this pass should make silently. The message model is
MAX-AI-ready as specced — a future MAX integration is just another caller of
`postMessage()`, no schema change needed to add it as a first-line
assistant before human handoff.

### Image uploads
`modules/uploads/` — real Cloudinary integration (multer memory storage →
buffer straight to Cloudinary, never touches disk), with server-side file
type/size validation, not just a frontend check. Requires
`CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`.
Images are auto-optimized (`f_auto,q_auto`) — the returned URL already
serves WebP/AVIF to browsers that support it. **The vendor product
form on the frontend still hasn't been updated to use this endpoint** —
it still takes pasted URLs. Wiring `POST /api/uploads/product-image` into
`components/product-form.tsx` is frontend work not done in this pass.

### Admin & vendor analytics
`modules/analytics/` — every number is a real aggregation query against
live tables (spec §41 "no fake production data"), including a raw-SQL
`date_trunc`-based revenue time series for day/week/month grouping. Vendor
analytics scope every query by `vendorId` so one vendor structurally cannot
see another's numbers through this API.

### Delivery tracking & referral expansion
`VendorOrder` gained `deliveryMethod`, `deliveryFee`, `deliveryProvider`,
`trackingNumber`, `trackingUrl`, `estimatedDeliveryAt` — set by vendors
when they mark an order shipped (no dedicated endpoint yet; update these
via the existing status-update flow if you extend it). `ReferralEvent`
gained `campaign` and `deviceType` fields per spec §14, though nothing
populates `deviceType` from the User-Agent yet — that's a small follow-up
(a UA-parsing library call in `products.controller.referral`).

### SEO
`app/sitemap.ts` (frontend) dynamically pages through the real product
catalog (48 at a time, capped at 480 products for now) plus every category
and vendor store — verified compiling clean in a full `next build`. Product
and store detail pages already had per-page metadata + JSON-LD from the
prior phase; this phase didn't need to touch those.

## What's STILL not built (frontend, mostly)
- Reviews UI, wishlist UI, coupon-entry-at-checkout UI — the backend for
  all three is real and tested-by-compilation; zero frontend pages consume
  them yet
- Vendor subscription upgrade/downgrade UI, featured listing purchase UI
- Admin/vendor analytics dashboard UI (the data endpoints exist; no charts)
- Image upload UI (form still takes pasted URLs — see above)
- Live support chat UI (widget + admin inbox)
- Admin UI for: vendor plans, coupons, featured listing approval/pricing,
  payouts, email logs, audit logs, referral stats
- The real `ttflstore.png` logo — still a placeholder wordmark
- A scheduled job to actually downgrade a cancelled subscription at
  `renewalDate` instead of immediately
- Refund processing (spec mentions it; no refund flow exists — payment
  status can be set to REFUNDED but nothing drives that transition)

## Phase 2b — the last honest gaps closed

Found and fixed while doing a final pass, not left for later:

- **Refunds now actually work.** `lib/paystack.ts` gained `refundTransaction`,
  `orders.service.refundOrder` calls it for real, restocks every item, marks
  the order and all its `VendorOrder`s `REFUNDED`, and emails the customer.
  Admin-only, via `POST /api/orders/admin/:orderId/refund`. Before this,
  `PaymentStatus.REFUNDED` existed as an enum value nothing ever set —
  caught that gap on a final audit pass, not left silently unbuilt.
- **Per-vendor commission overrides are now settable.** The
  `VendorProfile.commissionRateOverride` field existed and was *read* by
  `resolveCommissionRate()` since Phase 1, but nothing ever *wrote* it —
  another gap caught on the same pass. `POST /api/vendors/admin/:id/commission-override`
  fixes that (spec §16/§17's "custom commission agreements").
- **Admin audit logs and email logs are now viewable**, not just recorded —
  `GET /api/analytics/admin/audit-logs` and `/email-logs`, both with a
  frontend page (spec §28 explicitly lists both under the admin dashboard).
- **Admin order list** — `GET /api/orders/admin/list` — needed as the
  refund flow's prerequisite (an admin has to find the order before
  refunding it), also useful standalone.

## What's still genuinely not built, full stop
- Refunds are all-or-nothing per order — no partial/line-item refunds
- Multi-staff vendor accounts, Enterprise API keys (spec mentions both,
  neither has any schema or endpoints)
- Scheduled downgrade-at-renewal for cancelled subscriptions — still
  immediate, as documented in Phase 2
- Everything else flagged in the Phase 2 section above (in-process email
  queue, REST-polled support chat, featured-listing UI has pricing set by
  admin now via /admin/settings but no per-placement admin approval queue
  beyond cancel)
- Never run against a real Postgres/Paystack/Cloudinary/SMTP/WhatsApp
  account — every "works" claim here means "compiles clean and the logic
  was reasoned through," not "observed working in production." Please
  treat first real deployment as integration testing, not launch.
