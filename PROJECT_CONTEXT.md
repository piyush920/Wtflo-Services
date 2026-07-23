# Wtflo Services Page - Project Context

## Overview
Static landing page for Wtflo's WhatsApp marketing system services with Zoho Payments checkout, automated invoicing via Zoho Books webhook, GST-compliant billing, and promo code support.

**Live URL:** https://services.wtflo.com  
**GitHub Repo:** https://github.com/piyush920/Wtflo-Services  
**Vercel Project:** wtflo/wtflo-services  

## File Structure
```
Wtflo-Services-main/
├── index.html              # Main page - offer selection, checkout form, Zoho widget
├── payment-success.html    # Success redirect page
├── payment-failure.html    # Failure redirect page
├── favicon.png             # W logo favicon
├── vercel.json             # Routes, CORS headers, rewrites
├── package.json            # Dependencies (none currently)
├── .gitignore
├── PROJECT_CONTEXT.md      # This file
├── api/
│   └── zoho/
│       ├── pricing.js          # [NEW] Shared pricing module - single source of truth
│       ├── books-api.js        # [NEW] Shared Zoho Books API utilities (contact, invoice, tax)
│       ├── create-session.js   # Zoho Payments session creation
│       ├── webhook.js          # Zoho Payments webhook → Zoho Books invoice
│       ├── free-invoice.js     # Zero-amount invoice creation (promo codes)
│       ├── books-auth.js       # Zoho Books OAuth token management
│       ├── books-callback.js   # OAuth callback handler
│       ├── gstin-lookup.js     # Appyflow GSTIN address lookup
│       └── list-taxes.js       # List tax rates (admin only)
└── test/
    └── run.js              # [NEW] Unit tests for pricing module (zero-dependency, node assert)
```

## Local Development Path
```
/Users/piyushsingh/Documents/Wtflo/Wtflo Landing Pages/services/Wtflo-Services-main/
```

## API Endpoints

### 1. Create Payment Session
**Endpoint:** `POST /api/zoho/create-session`  
**CORS:** `https://services.wtflo.com`  
**Purpose:** Creates a Zoho Payments session for non-zero amounts

**Request Body:**
```json
{
  "amount": 59000,           // Client-calculated (IGNORED by backend for security)
  "currency": "INR",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "customer_phone": "+919876543210",
  "customer_gstin": "06ABCDE1234F1Z5",  // Optional
  "customer_company": "Company Ltd",     // Optional
  "customer_address": "123 Main St",
  "customer_city": "Gurugram",
  "customer_state": "Haryana",
  "customer_pincode": "122002",
  "description": "Wtflo - 3 system(s)",
  "offer_ids": "lead-gen,instant-booking,followup",
  "split_type": "full",     // "full" or "split"
  "promo_code": "PILOT2"    // Optional
}
```

**Metadata sent to Zoho Payments (for webhook):**
| Key | Value | Max |
|-----|-------|-----|
| `n` | Customer name | 100 chars |
| `e` | Customer email | 254 chars |
| `p` | Customer phone | 15 chars |
| `c` | Company (optional) | 200 chars |
| `a` | `street\|city\|state\|pincode` (optional) | 250 chars |
| `o` | `offer_ids\|split_type\|promo_code\|gstin` (always sent) | 250 chars |

Note: GSTIN is embedded in the `o` field (4th position) instead of a separate `g` key to stay within Zoho's ~5 metadata entry limit. Webhook reads from `o[3]` with fallback to legacy `g` key.

The `o` metadata key enables the webhook to do **per-session amount validation** instead of just checking against the pre-computed VALID_AMOUNTS set.

**Response (Success):**
```json
{
  "success": true,
  "payment_session_id": "55144000000046009"
}
```

**Response (Error):**
```json
{ "error": "Payment service unavailable" }
```

**Validation:**
- `offer_ids` max 4, must be valid offer IDs
- `promo_code` must be in PROMO_CODES (case-insensitive)
- Amount calculated server-side (client `amount` ignored)

### 2. Free Invoice (Zero Amount)
**Endpoint:** `POST /api/zoho/free-invoice`  
**CORS:** `https://services.wtflo.com`  
**Purpose:** Creates invoice directly in Zoho Books for ₹0 totals (promo codes)

**Request Body:**
```json
{
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "customer_phone": "+919876543210",
  "customer_gstin": "06ABCDE1234F1Z5",
  "customer_company": "Company Ltd",
  "customer_address": "123 Main St",
  "customer_city": "Gurugram",
  "customer_state": "Haryana",
  "customer_pincode": "122002",
  "description": "Wtflo - 2 system(s) (Promo: PILOT2)",
  "offer_ids": "lead-gen,instant-booking",
  "promo_code": "PILOT2"
}
```

**Response:**
```json
{ "success": true, "invoice_id": "123", "invoice_number": "INV-001" }
```

### 3. Webhook (Payment Success)
**Endpoint:** `POST /api/zoho/webhook`  
**CORS:** `https://services.wtflo.com`  
**Purpose:** Receives `payment.succeeded` events from Zoho Payments, creates invoice in Zoho Books

**Flow:**
1. Receives webhook payload from Zoho Payments
2. **In-memory dedup**: rejects if payment_id already processed (redundant webhook guard)
3. **Amount validation**:
   - If `o` metadata present: validates using `calculateAmount(offer_ids, split_type, promo_code)` — authoritative per-session check
   - If no metadata (legacy): falls back to pre-computed VALID_AMOUNTS set
4. Checks for duplicate invoices (reference_number lookup)
5. Extracts customer metadata from payment
6. Looks up GSTIN via Appyflow API (for company name auto-fill)
7. Finds or creates contact in Zoho Books
8. Creates invoice with line items
9. Records payment against invoice
10. Sends invoice email (fire-and-forget)

### 4. GSTIN Lookup
**Endpoint:** `GET /api/zoho/gstin-lookup?gstin=06ABCDE1234F1Z5`  
**Purpose:** Verify GSTIN and auto-fill address fields

### 5. List Taxes (Admin)
**Endpoint:** `GET /api/zoho/list-taxes`  
**Auth:** Requires `ADMIN_API_KEY` header  
**Purpose:** Lists all tax rates from Zoho Books

## Zoho Configuration

### Zoho Payments
- **Account ID:** `60078356828`
- **API Key (client-side):** `1003.1f758e8911608a8ceae9ce09438b2118.c9a664816fb956340b75cfa5e252df13`
- **OAuth Client ID:** `1005.YHUTX2QJA6X3PGONYG7DENNNMZA4YD`
- **API Base:** `https://payments.zoho.in/api/v1`
- **OAuth Base:** `https://accounts.zoho.in`
- **Widget Script:** `https://static.zohocdn.com/zpay/zpay-js/v1/zpayments.js`
- **Payment Methods:** `['upi', 'card']`

### Zoho Books
- **Org ID:** `60077520698`
- **OAuth Client ID:** `1000.9AO7L7JMWKSJNLXX5KJB966YYMMHTW`
- **OAuth Client Secret:** `8f5bb7d2d9284f42f6f75ea63334efebd252c9c86b`
- **API Base:** `https://www.zohoapis.in/books/v3`
- **Tax IDs:**
  - Intra-state (GST @18%): `3931303000000035025`
  - Inter-state (IGST 18%): `3931303000000032179`

### Appyflow GSTIN Lookup
- **API:** `https://appyflow.in/api/verifyGST?gstNo={GSTIN}&key_secret={API_KEY}`
- **API Key:** Set as `APPYFLOW_API_KEY` env var on Vercel

## Environment Variables (Vercel)
| Variable | Description |
|----------|-------------|
| `ZOHO_CLIENT_ID` | Zoho Payments OAuth client ID |
| `ZOHO_CLIENT_SECRET` | Zoho Payments OAuth client secret |
| `ZOHO_SIGNING_KEY` | Zoho Payments webhook signing key |
| `ZOHO_PAYMENTS_REFRESH_TOKEN` | Zoho Payments OAuth refresh token |
| `ZOHO_BOOKS_CLIENT_ID` | Zoho Books OAuth client ID |
| `ZOHO_BOOKS_CLIENT_SECRET` | Zoho Books OAuth client secret |
| `ZOHO_BOOKS_REFRESH_TOKEN` | Zoho Books OAuth refresh token |
| `ZOHO_BOOKS_ORG_ID` | Zoho Books organization ID |
| `APPYFLOW_API_KEY` | Appyflow GSTIN lookup API key |
| `BANK_DETAILS` | Bank details for invoice notes |
| `ADMIN_API_KEY` | Admin API key for list-taxes endpoint |

## Offer IDs
| ID | Name | Price |
|----|------|-------|
| `lead-gen` | Lead Generation from Meta & WhatsApp Ads | ₹25,000 |
| `instant-booking` | WhatsApp Booking System | ₹25,000 |
| `followup` | Follow-Up System | ₹25,000 |
| `recovery` | WhatsApp Recovery System | ₹25,000 |
| `test-payment` | TEST - ₹1 Payment (test mode only) | ₹1 |

## Promo Codes
| Code | Free Systems | Notes |
|------|-------------|-------|
| `PILOT1` | 1 | Free-invoice path if total = 0 |
| `PILOT2` | 2 | Free-invoice path if total = 0 |
| `PILOT3` | 3 | Free-invoice path if total = 0 |
| `FOUNDER4` | 4 | Free-invoice path if total = 0 |

**Promo Logic:**
- Promo codes make N systems free (highest-priced first)
- When total = 0 (all systems free), frontend calls `/api/zoho/free-invoice`
- When total > 0 (some systems paid), frontend calls `/api/zoho/create-session`
- Promo codes disable the 10% bundle discount
- Promo codes are case-insensitive

## Pricing Calculation (Server-Side)
```
subtotal = sum(offer prices)
if promo_code:
    promoDiscount = sum of N highest-priced offers
    discount = 0
elif split_type == 'full':
    discount = round(subtotal * 0.10)
else:
    discount = 0

taxable = subtotal - discount - promoDiscount
gst = round(taxable * 0.18)
total = taxable + gst
return (split_type == 'full') ? total : round(total / 2)
```

Pricing logic lives in `api/zoho/pricing.js` — imported by `create-session.js` and `webhook.js`.

## Frontend Flow
1. User selects offers (any order, any combination)
2. User fills contact form (name, email, phone, address, etc.)
3. User optionally enters promo code
4. User selects payment split (Full or 50-50)
5. User clicks "Pay Now"
6. Frontend calculates total:
   - If total = 0 → calls `/api/zoho/free-invoice` → redirects to success page
   - If total > 0 → calls `/api/zoho/create-session` → opens Zoho Payments widget
7. On success → redirect to `/payment-success`
8. On failure → redirect to `/payment-failure`

**Form validation uses inline error messages (not `alert()`) for better UX.**

## Git Workflow
```bash
# Edit files in Wtflo-Services-main/
git add .
git commit -m "description of changes"
git push origin main
# Vercel auto-deploys on push to main
```

**Important:** The git repo must point to `https://github.com/piyush920/Wtflo-Services.git`  
If working from the ZIP-extracted directory, initialize git first:
```bash
cd Wtflo-Services-main/
git init
git remote add origin https://github.com/piyush920/Wtflo-Services.git
git add .
git commit -m "initial"
git push -u origin main
```

## Deployment
- **Auto-deploy:** Push to `main` branch on GitHub → Vercel auto-deploys
- **Manual deploy:** `vercel --prod` (requires Vercel CLI)
- **Custom domain:** `services.wtflo.com` (configured in Vercel)
- **HTTPS:** Automatic via Vercel

## Troubleshooting

### "Payment service unavailable"
- **Cause:** Zoho Payments API error or token refresh failure
- **Fix:** Retry (transient OAuth issue). Check Vercel logs.
- **Test:** `curl -X POST https://services.wtflo.com/api/zoho/create-session ...`

### "Payment session is invalid or expired"
- **Cause:** Zoho Payments widget rejecting the session
- **Fix:** Hard refresh (Ctrl+Shift+R). Clear browser cache.
- **Note:** This is a Zoho widget error, not our code.

### Free invoice timeout
- **Cause:** Zoho Books API calls taking too long
- **Fix:** Already addressed with 8s AbortController timeouts
- **Status:** `?send=true` removed, email is fire-and-forget

### Zoho Books PUT 401 errors
- **Cause:** OAuth refresh token lacks write scope
- **Fix:** Revoke old connection at accounts.zoho.in/myapps, re-authorize with full scopes
- **Workaround:** Address set on contact creation (POST), not update (PUT)

### Metadata limit exceeded
- **Cause:** Zoho Payments has ~5 metadata entry limit
- **Fix:** Address fields combined into single pipe-delimited entry: `street|city|state|pincode`

### Webhook not firing
- **Check:** Zoho Payments dashboard → Settings → Webhooks
- **URL:** `https://services.wtflo.com/api/zoho/webhook`
- **Event:** `payment.succeeded`

## Testing
- **Unit tests:** `node test/run.js` (49 tests covering all pricing combinations, GSTIN validation, state code extraction)
- **Test mode:** Add `?test=1` to URL for ₹1 test payment offer
- **Test offer:** `test-payment` at ₹1 (only visible in test mode)
- **Admin API:** `GET /api/zoho/list-taxes` with `ADMIN_API_KEY` header

## Key Code Locations

### Frontend (index.html)
- **Offer definitions:** Lines 769-854
- **Promo codes:** Lines 862-867
- **Promo apply logic:** Lines 893-928
- **Pricing calculation:** Lines 1188-1251
- **Payment flow:** Lines 1253-1422
- **Zoho widget init:** Lines 1382-1409

### Backend (api/zoho/)
- **pricing.js:** Shared OFFERS, PROMO_CODES, calculateAmount, computeAllValidAmounts, validateGSTIN
- **books-api.js:** Shared booksApiCall, getTaxIds, findOrCreateContact, createInvoice, sendInvoiceEmail, recordPayment
- **create-session.js:** Session creation + metadata (`o` key for webhook amount validation)
- **webhook.js:** VALID_AMOUNTS, in-memory dedup, metadata-based amount validation, invoice creation
- **free-invoice.js:** Promo invoice creation (zero-amount path)
- **books-auth.js:** Token caching (5-minute expiry buffer)

## Supplier Details
- **Name:** Wtflo
- **Address:** 1145 Near Galleria Market, Sushant Lok Phase 1, Gurugram, Haryana 122002
- **GSTIN:** 06QGRPS3410R1Z9
- **State Code:** 06 (Haryana)
- **SAC Code:** 998365 (Internet advertising)

## Important Notes
1. **Amount is always calculated server-side** - client `amount` is ignored for security
2. **GST @18%** (CGST 9% + SGST 9% intra-state, IGST 18% inter-state)
3. **50-50 split** = 50% setup fee now, 50% on completion (no discount)
4. **Full payment** = 10% bundle discount (unless promo code applied)
5. **Promo codes** disable the 10% discount and make N systems free
6. **Any card selectable** in any order (no sequential unlock)
7. **Page is post-sales-call** - selling happens on the call, page just shows deliverables + price + pay button

## Refactoring Summary (July 2026)

### New Files
- `api/zoho/pricing.js` — Shared pricing module (OFFERS, PROMO_CODES, calculateAmount, computeAllValidAmounts, validateGSTIN, state code helpers)
- `api/zoho/books-api.js` — Shared Zoho Books API utilities (booksApiCall, getTaxIds, findOrCreateContact, createInvoice, sendInvoiceEmail, recordPayment)
- `test/run.js` — 49 unit tests for pricing module (zero-dependency, runs with `node test/run.js`)

### Changes Made

**1. Eliminated pricing drift risk:**
- Pricing logic (`calculateAmount`) now lives in ONE place: `pricing.js`
- `create-session.js` and `webhook.js` both import from `pricing.js`
- `computeAllValidAmounts()` generates the exhaustive set of all possible valid amounts for webhook validation

**2. Webhook reliability improvements:**
- **In-memory dedup**: Prevents duplicate invoice creation from redundant webhook calls
- **Metadata-based amount validation**: If `o` metadata key (offer_ids|split_type|promo_code) is present, validates amount per-session via `calculateAmount` instead of just checking the pre-computed set
- Falls back to `VALID_AMOUNTS` set for legacy payments without metadata

**3. Zero-amount invoice path (free-invoice.js):**
- Simplified using shared `books-api.js` utilities
- Uses `findOrCreateContact` (with optional GSTIN lookup for company name auto-fill)
- Uses shared `createInvoice`, `sendInvoiceEmail` from `books-api.js`

**4. Frontend form validation:**
- Replaced all `alert()` calls with inline error messages in a styled error bar
- Errors auto-dismiss after 5 seconds
- No page-jarring `alert()` dialogs during sales calls

**5. Promo code case-insensitivity:**
- `calculateAmount` now normalizes promo codes to uppercase internally
- Both frontend and backend handle `pilot1`, `PILOT1`, `Pilot1` etc.

**6. Testing:**
- 49 zero-dependency unit tests covering all pricing combinations (1-4 offers × full/split × all promo codes)
- Tests for VALID_AMOUNTS completeness
- Tests for GSTIN validation, state code extraction
- Tests for edge cases (unknown promo, test payment, rounding)
