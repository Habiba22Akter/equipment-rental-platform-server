# Equipment Rental Platform API

Beginner-friendly Express.js and MongoDB backend for the Equipment Rental Platform. The server is written in JavaScript ES modules.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DB_URL` to your MongoDB connection string.
3. Start in development with `npm run dev`, or run with `npm start`.

The server defaults to port `5001` and database `equipment-rental-platform`. `CLIENT_ORIGIN` accepts a comma-separated list of allowed browser origins.

## JWT authentication

The Express API expects the Next.js server to send a Better Auth JWT as:

```http
Authorization: Bearer <jwt>
```

Set `BETTER_AUTH_URL` to the public Next.js origin (for example `http://localhost:3000`). Express downloads the public keys from `${BETTER_AUTH_URL}/api/auth/jwks`, validates issuer/audience, expiration and signature, then sets `req.user` to the verified user ID and role. Identity is no longer trusted from `x-user-id` or `x-user-role`.

The browser's `better-auth.session_token` is still a session cookie, not a JWT. Better Auth's JWT plugin returns a separate JWT from `GET /api/auth/token`; the Next.js server uses that token for Express requests.

For a custom JWKS host, set `JWT_JWKS_URL` instead. `INTERNAL_API_KEY` remains optional, but JWT verification is required for mutations and protected resources.

## Endpoints

### Equipment

- `GET /api/equipments` — approved equipment (public view)
  - `?all=true` includes pending and rejected listings (used by owner and admin dashboards)
  - `?ownerId=...`, `?status=pending|approved|rejected`, `?category=...`, `?q=...`, `?limit=...`
- `GET /api/equipments/:id` — a single listing
- `POST /api/equipments` — create a listing; it starts as `pending`
- `PATCH /api/equipments/:id` — edit a listing (owner or admin); owner edits return to `pending`
- `PATCH /api/equipments/:id/status` — approve or reject a listing (admin only)
- `DELETE /api/equipments/:id` — delete a listing (owner or admin); blocked while bookings are active

### Bookings

- `GET /api/bookings` — booking records
  - `?customerId=...`, `?ownerId=...`, `?equipmentId=...`, `?status=...`
  - Responses include the related equipment name, image and owner
- `GET /api/bookings/:id` — a single booking
- `PATCH /api/bookings/:id/status` — customers may cancel their own booking; owners and admins can move it through `confirmed`, `active`, `completed`, `cancelled`

### Users

- `GET /api/users` — user records without password data; `?role=Customer|Owner|Admin`
- `GET /api/users/:id` — a single safe user record
- `PATCH /api/users/:id/role` — change a role between `Customer` and `Owner` (admin only; `Admin` cannot be assigned here)

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
