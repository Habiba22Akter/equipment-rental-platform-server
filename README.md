# Equipment Rental Platform API

Beginner-friendly Express.js and MongoDB backend for the Equipment Rental Platform. The server is written in JavaScript ES modules.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DB_URL` to your MongoDB connection string.
3. Start in development with `npm run dev`, or run with `npm start`.

The server defaults to port `5001` and database `equipment-rental-platform`. `CLIENT_ORIGIN` accepts a comma-separated list of allowed browser origins.

## Deploy to Vercel

In Vercel, import the repository and set **Root Directory** to `equipment-rental-platform-server`. Use the default Node/Express detection and npm install command. The root `index.js` exports the Express app for Vercel; `src/index.js` remains the local `npm run dev` entry point. No build command or custom `vercel.json` is needed for this JavaScript API.

Add these variables in the Vercel project's Environment Variables settings (Production, and Preview if needed):

| Variable | Vercel value |
| --- | --- |
| `DB_URL` | MongoDB Atlas connection string; keep it secret |
| `DB_NAME` | `equipment-rental-platform` (or the database name in Atlas) |
| `CLIENT_ORIGIN` | Deployed client origin, e.g. `https://your-client.vercel.app`; add other exact origins comma-separated |
| `BETTER_AUTH_URL` | The deployed Next.js client origin, e.g. `https://your-client.vercel.app` (JWKS is read from its `/api/auth/jwks`) |
| `CLIENT_URL` | The deployed Next.js client origin; used for Stripe success/cancel redirects |
| `INTERNAL_API_KEY` | Optional shared secret; if set, use the same value for the client server's `EQUIPMENT_API_KEY` |
| `JWT_JWKS_URL` | Optional override; otherwise derived from `BETTER_AUTH_URL` |
| `STRIPE_SECRET_KEY` | Stripe secret key for the intended Stripe mode |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the production Stripe webhook endpoint |
| `BDT_PER_USD` | Exchange rate used by the booking checkout conversion (defaults to `120`) |
| `CRON_SECRET` | Long random secret used to authorize the Vercel booking-completion cron |
| `RESEND_API_KEY` | Optional Resend API key for completion emails |
| `EMAIL_FROM` | Verified Resend sender, for example `GearGrid <rentals@your-domain.com>` |

Do not set `PORT` in Vercel; Vercel manages the function port. On the client Vercel project, set `EQUIPMENT_API_URL` to the deployed server origin and, when using an internal key, set `EQUIPMENT_API_KEY` to the same secret as the server's `INTERNAL_API_KEY`. Keep Better Auth's client URL configured for the client deployment.

The production API is `https://equipment-rental-platform-server-nine.vercel.app`. `/api/health` and `/api/equipments` returned HTTP 200 after the latest deployment. A Stripe test-mode webhook destination is configured at `https://equipment-rental-platform-server-nine.vercel.app/api/webhooks/stripe` for `checkout.session.completed` and `checkout.session.expired`; its signing secret is stored in the server Vercel Production variable `STRIPE_WEBHOOK_SECRET`, and the server has been redeployed. Keep `STRIPE_SECRET_KEY` in the same test mode. Complete a real test Checkout and confirm a successful Stripe delivery and matching MongoDB booking/payment records. For live payments, create a separate live-mode endpoint and replace the Vercel secret with its signing secret. `stripe listen` forwards local events only; it does not configure the production endpoint.

The Vercel cron in `vercel.json` calls `/api/cron/complete-bookings` daily at 00:05 UTC. Add a long random `CRON_SECRET` in Vercel Production Environment Variables. Local `npm run dev` also runs `node-cron` hourly. Paid bookings whose rental end date has passed are marked `completed`. To send automatic completion emails, configure `RESEND_API_KEY` and a verified `EMAIL_FROM` sender in Resend and Vercel; without them the booking still completes and the server logs that email was skipped.

Vercel's Express runtime and entrypoint guidance: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express).

## npm packages

- `express` — HTTP API and middleware.
- `mongodb` — MongoDB connection and queries.
- `cors` — configured frontend-origin access.
- `dotenv` — local environment variable loading.
- `jose` — verify Better Auth JWT signatures and claims through JWKS.
- `stripe` — Checkout Sessions and webhook event verification.
- `node-cron` — local hourly booking completion schedule; Vercel uses the scheduled endpoint.

## JWT authentication

The Express API expects the Next.js server to send a Better Auth JWT as:

```http
Authorization: Bearer <jwt>
```

Set `BETTER_AUTH_URL` to the public Next.js origin (for example `http://localhost:3000`). Express downloads the public keys from `${BETTER_AUTH_URL}/api/auth/jwks`, validates issuer/audience, expiration and signature, then sets `req.user` to the verified user ID and role. Identity is no longer trusted from `x-user-id` or `x-user-role`.

The browser's `better-auth.session_token` is still a session cookie, not a JWT. Better Auth's JWT plugin returns a separate JWT from `GET /api/auth/token`; the Next.js server uses that token for Express requests.

For a custom JWKS host, set `JWT_JWKS_URL` instead. Reusable Express middleware is exported as `verifyToken`, `verifyRenter`, `verifyOwner`, and `verifyAdmin`. Renter accounts use the `Customer` role here. Public approved-equipment and review reads stay public; bookings, payments, user management, private listing queries, and write actions require a verified JWT. Ownership is checked against the verified user, not query-string identity values.

## Endpoints

### Equipment

- `GET /api/equipments` — approved equipment (public view)
  - `?all=true` includes pending and rejected listings (used by owner and admin dashboards)
  - `?ownerId=...`, `?status=pending|approved|rejected`, `?category=...`, `?q=...`, `?limit=...`
  - `?page=1&pageSize=9` returns `{ items, total, page, pageSize }` for the public equipment page.
- `GET /api/equipments/:id` — a single listing
- `POST /api/equipments` — create a listing; it starts as `pending`
- `PATCH /api/equipments/:id` — edit a listing (owner or admin); owner edits return to `pending`
- `PATCH /api/equipments/:id/status` — approve or reject a listing (admin only)
- `DELETE /api/equipments/:id` — delete a listing (owner or admin); blocked while bookings are active

### Bookings

- `GET /api/bookings` — booking records
  - `?customerId=...`, `?ownerId=...`, `?equipmentId=...`, `?status=...`
  - `?limit=...&skip=...` supports booking-history pages.
  - Responses include the related equipment name, image and owner
- `GET /api/bookings/:id` — a single booking
- `PATCH /api/bookings/:id/status` — customers may cancel their own booking; owners and admins can move it through `confirmed`, `active`, `completed`, `cancelled`

### Payments

- `GET /api/payments` — JWT required; customers see their transactions, owners see payments for their equipment, admins can view all
- `GET /api/payments/:id` — JWT required; only the customer, equipment owner, or admin can view a payment

### Users

- `GET /api/users` — user records without password data; `?role=Customer|Owner|Admin`
- `GET /api/users/:id` — a single safe user record
- `PATCH /api/users/:id/role` — change a role to `Customer`, `Owner` or `Admin` (real admin only; users cannot change their own role)

### Reviews

- `GET /api/reviews` — reviews with optional `?equipmentId=...`, `?ownerId=...`, `?customerId=...`
- `POST /api/reviews` — review a completed rental; one review per booking, rating 1–5
- `DELETE /api/reviews/:id` — remove your own review (admins may remove any)

### Utility

- `GET /` — API identity
- `GET /api/health` — server health

Responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "message": ... } }`.

## Request identity

The API is called by the Next.js server, not directly by the browser. The Next.js proxy reads the Better Auth session and obtains a JWT, then forwards:

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <jwt>` | Better Auth signature, expiration, user ID and role |
| `x-api-key` | Optional shared secret for mutation protection when `INTERNAL_API_KEY` is set |

Express validates JWT signatures through the Better Auth JWKS endpoint and stores verified identity in `req.user`. Ownership checks compare `req.user.id` with the listing's `ownerId`. Admin-only routes check `req.user.role`. Legacy `x-user-id` and `x-user-role` headers are not accepted for authorization.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DB_URL` | MongoDB connection string (secret) |
| `DB_NAME` | Database name; defaults to `equipment-rental-platform` |
| `PORT` | HTTP port; defaults to `5001` |
| `CLIENT_ORIGIN` | Allowed frontend origin(s), comma-separated |
| `INTERNAL_API_KEY` | Optional shared secret required on write requests |
| `BETTER_AUTH_URL` | Public Next.js origin used as JWT issuer/audience and for JWKS discovery |
| `JWT_JWKS_URL` | Optional explicit JWKS URL override |

## Assignment deployment status

The API implements equipment CRUD/moderation, backend filters and sorting, booking/payment records, Better Auth JWT authorization with reusable role middleware, reviews, favorites and role-aware user management. The deployed API is `https://equipment-rental-platform-server-nine.vercel.app`; health and public equipment GET checks returned HTTP 200. Production Stripe webhook delivery and authenticated role behavior still need end-to-end confirmation.

## Role access rules

- `verifyToken` validates the Better Auth JWT and attaches the signed user ID and role to `req.user`.
- `verifyRenter` represents the project's `Customer` role. `verifyOwner` and `verifyAdmin` enforce their corresponding roles.
- Public equipment browsing and review reads remain available without sign-in.
- Owners can read/manage their own inventory and its bookings/payments. Customers can read/manage their own bookings and payments. Admins can manage users and view marketplace records.
- Creating equipment uses the owner ID in the verified JWT; a request body cannot create a listing for another owner.
- Booking and payment list routes apply the authenticated user's scope even if a request supplies a different customer or owner ID.

The server production deployment is `https://equipment-rental-platform-server-nine.vercel.app`. Health and public equipment GET checks returned HTTP 200 after deployment. Authenticated role behavior and Stripe webhook delivery still need the manual checks described in the project deployment section.
