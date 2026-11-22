# GearGrid Server Agent Notes

## Stack

- JavaScript ES modules with Express 5 and the official MongoDB driver.
- Main entry: `src/index.js`; app setup: `src/app.js`.
- MongoDB setup: `src/config/database.js`; environment: `src/config/env.js`.
- Routes: `src/routes/<resource>/`; middleware: `src/middleware/`.
- JWT: Better Auth is the issuer. Express verifies Bearer tokens from Better Auth's JWKS endpoint.
- Better Auth's JWT is separate from its `better-auth.session_token` cookie; Next.js obtains it from `/api/auth/token` for Express requests.
- User role management allows real admins to assign `Customer`, `Owner` or `Admin`; the Next.js layer separately blocks the configured Demo Admin.

## API conventions

- Mount resource routes below `/api`.
- Success: `{ success: true, data: ... }`
- Error: `{ success: false, error: { message: ... } }`
- Return appropriate status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict, 500 server failure.
- Use centralized `next(error)` handling and centralized not-found/error middleware.
- Keep real credentials in `.env` and placeholders in `.env.example`.

## MongoDB collections

- `equipment`: owner listings and approval state.
- `bookings`: pending/confirmed/active/completed rental records.
- `payments`: Stripe transaction records (USD charge and original BDT total).
- `favorites`: customer favorite equipment.
- `user`: Better Auth users and custom role data.

## Equipment API

- Base route: `/api/equipments`
- `GET /api/equipments`: approved listings by default; `?all=true` includes pending/rejected listings.
- `GET /api/equipments?ownerId=<id>&all=true`: owned listings for an owner.
- `GET /api/equipments/:id`: one equipment record.
- `POST /api/equipments`: create an equipment listing.
- `PATCH /api/equipments/:id`: owner or admin edit.
- `DELETE /api/equipments/:id`: owner or admin delete.
- `PATCH /api/equipments/:id/status`: admin-only approval status update.

The equipment `_id` is a MongoDB ObjectId and must be validated with `ObjectId.isValid()` before querying.

## Ownership and authorization

- Next.js sends a Better Auth Bearer JWT to Express.
- Express exposes verified identity as `req.user = { id, role }`.
- Never trust spoofable identity headers for authorization.
- Owners may only edit/delete their own equipment.
- Admins may manage equipment regardless of owner.
- New listings start with `status: "pending"` and `approvalStatus: "pending"`.
- Owner edits return listings to pending review.
- Prevent deletion when confirmed or active bookings exist.

## Create payload

Required:

- `name`, `description`, `category`, `location`, `imageUrl`, `ownerId`
- `dailyRate`, `availableQuantity`

Optional:

- `rentalType`, `weeklyRate`, `monthlyRate`, `terms`, `ownerName`, `ownerEmail`

## Commands

- `npm run dev` - start with Node watch mode on port 5001.
- `npm start` - start the server normally.
- `npm test` - reserved for test configuration.

## Stripe checkout flow

- `POST /api/bookings` saves a pending booking, converts its BDT total to USD cents, and returns a Stripe Checkout URL.
- `src/stripe.js` creates Checkout Sessions with `bookingId` in Stripe metadata.
- `POST /api/webhooks/stripe` uses the raw request body to verify Stripe signatures.
- A completed checkout marks the booking confirmed/paid and adds one payment record; an expired checkout leaves it pending/unpaid so the customer can retry.
- If a customer returns to retry after Stripe already completed payment but the local webhook was missed, the server retrieves that Stripe session and records the confirmed payment without charging again.
- Pending bookings reserve their requested quantity for the selected dates until the customer or admin cancels the booking.
- `GET /api/equipments/:id/availability?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` returns total, reserved, and available units for those dates.
- The Stripe webhook route is registered before `express.json()` and the internal API key middleware.
- Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `BDT_PER_USD` in the server `.env`. `BDT_PER_USD` defaults to 120.
- Configure `BETTER_AUTH_URL` (or `JWT_JWKS_URL`) so Express can verify Next.js-issued JWTs.
- For local webhook delivery, keep `stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:5001/api/webhooks/stripe` running in a terminal.

## Assignment and release status

- The requested equipment marketplace API, JWT authorization, booking/payment and role-management endpoints are implemented.
- Do not claim production API or webhook availability until a live deployment is configured and verified.
- Current committed-history count is 16 server commits; check Git status because working-tree changes are not included in that count.
