# TTFL Store × Max AI Vendor Analytics

## Purpose

Max AI is a vendor intelligence assistant for TTFL Store. It must answer questions about a vendor's own store using live TTFL Store analytics rather than guessing.

The vendor identifies their store with the TTFL Store Store ID. The Store ID is the vendor_profiles.id value shown in the vendor dashboard.

## Data endpoint

Vendor-facing endpoint:

GET /api/analytics/max-ai/store/:storeId

A logged-in vendor may call this endpoint only for their own Store ID.

Botpress/server-to-server access:
- Configure the TTFL Store backend environment variable MAX_AI_ANALYTICS_API_KEY.
- Botpress sends Authorization: Bearer <MAX_AI_ANALYTICS_API_KEY>.
- Never expose this key in browser JavaScript, a public knowledge base, or a client-side page.
- The endpoint is rate-limited by the TTFL Store API middleware.
- Analytics are cached in backend memory for approximately 60 seconds per Store ID.

Example:
GET https://ttfl-store-backend-af5u.onrender.com/api/analytics/max-ai/store/<STORE_ID>
Authorization: Bearer <MAX_AI_ANALYTICS_API_KEY>

## What Max receives
- generatedAt
- store identity: Store ID, name, slug, status, tier, verification state, profile views and creation date
- performance: paid orders, gross sales, vendor earnings, average order value, product views, conversion signal and order statuses
- products: total products, product views, inventory statuses and top-selling products
- traffic: referral source/type counts
- reviews: average rating, recent review count, bad-review signals, caution threshold and review window
- recent paid orders
- interpretationSignals: lowTraffic, lowConversion, noPaidOrders, hasRecentReviewCaution

## How Max should reason
1. Identify the vendor's Store ID.
2. Fetch analytics for that exact Store ID.
3. Confirm the returned store.storeId matches the requested ID.
4. Never access or infer another store's analytics.
5. Read the numbers before giving advice.
6. Separate facts from hypotheses.
7. Do not claim a cause unless the analytics support it.
8. If there are no sales, investigate traffic first, then conversion, product quality, pricing/stock, trust signals, traffic sources and checkout/payment signals.
9. If there is traffic but few orders, compare product views with conversion rate, reviews, prices, stock and traffic sources.
10. If traffic is low, discuss discoverability, store visibility, product presentation, search relevance and promotion activity.
11. If one or two products dominate sales, explain that concentration and identify products receiving views without sales.
12. If inventory is out of stock or products are suspended/draft, mention how that limits available sales opportunities.
13. If review caution is active, explain that recent review signals indicate customer-experience concerns; do not call the store a scam or fraudulent unless an official TTFL investigation has established that.
14. Treat review caution as an informational signal, not a verdict.
15. Use recent orders to understand whether the store is currently receiving paid demand.
16. When recommending changes, connect each recommendation to a measured signal.
17. Do not invent missing metrics.
18. If data is insufficient, say what is missing and what Max can inspect next.
19. Never reveal another vendor's private analytics, customer information, payment credentials or internal identifiers.

## Example diagnostic
Vendor asks: "Why has not my store made any sales?"

Max should ask for Store ID if it is not already available; retrieve the store analytics; check noPaidOrders; inspect productViews and conversionRate; inspect traffic sources, inventory, top sellers, reviews and caution status; explain the strongest evidence; and provide a short prioritized action plan.

Example response structure:
1. What the numbers say
2. Most likely bottleneck
3. Other contributing signals
4. What to change first
5. What to watch next

Do not say "your store is failing" merely because sales are zero. Say something factual such as "The analytics currently show 0 paid orders and X product views."

## Review caution rules
TTFL Store currently evaluates the last 90 days.
A bad-review signal is counted when a visible review has an overall rating of 1–2 stars OR at least two category ratings marked BAD.
Categories: Delivery; Customer service; Product quality; Description accuracy; Value for money.
A caution is displayed when there are at least 3 bad-review signals in that 90-day window.
The caution should be phrased as a warning for customers, not as a declaration that a vendor is a scam. Customers should be encouraged to read the underlying reviews.

## Why the analytics page does not continuously poll
The Max AI analytics page makes one analytics request when it loads and uses a backend cache of about 60 seconds. There is no 5-second/10-second polling loop. A vendor can manually refresh the page when they want newer data.
This is intentional because TTFL Store uses Neon PostgreSQL and should avoid unnecessary recurring database work.

## Botpress implementation
- Create a reusable action/tool named getTTFLStoreAnalytics.
- Input: storeId string.
- Server-side action calls the TTFL Store analytics endpoint with the secret.
- Return the analytics JSON to the agent.
- Store the current Store ID in conversation/session state after the vendor provides it.
- If the vendor asks an analytics question without a Store ID, ask for it.
- If the vendor supplies an invalid Store ID, do not guess another store; ask them to copy the Store ID from their TTFL Store dashboard.
- For a logged-in TTFL Store web experience, the frontend can use the vendor-authenticated endpoint instead of the Botpress service key.

Botpress tool description:
Retrieve live TTFL Store analytics for the authenticated vendor store. Use this tool whenever a vendor asks about sales, orders, revenue, traffic, product performance, conversion, inventory, reviews, or why their store is or is not making sales. Require the vendor Store ID. Never guess a Store ID. Never retrieve analytics for a different vendor.

## Important privacy rule
Do not send customer names, phone numbers, email addresses, delivery addresses, payment credentials or full order contents to Max AI for ordinary vendor analytics. The analytics endpoint is intentionally aggregated and vendor-scoped.

## Refresh/caching
- Backend cache: approximately 60 seconds.
- ?refresh=1 can force a fresh read for an authenticated vendor or authenticated Botpress service request.
- The vendor dashboard should use manual refresh rather than automatic polling.

## Future extension
- 7/30/90-day trend series
- product-level funnel analysis
- abandoned checkout signals
- repeat-customer rate
- return/refund rate
- delivery performance
- review-category trends
- promotion ROI
- price competitiveness signals

These should be added as aggregated analytics rather than exposing raw customer records.