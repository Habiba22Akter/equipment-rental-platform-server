# Equipment Rental Platform API

Beginner-friendly Express.js and MongoDB backend for the Equipment Rental Platform. The server is written in JavaScript ES modules.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DB_URL` to your MongoDB connection string.
3. Start in development with `npm run dev`, or run with `npm start`.

The server defaults to port `5001` and database `equipment-rental-platform`. `CLIENT_ORIGIN` accepts a comma-separated list of allowed browser origins.

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

The API is called by the Next.js server, not directly by the browser. The Next.js proxy reads the Better Auth session and forwards:

| Header | Meaning |
| --- | --- |
| `x-user-id` | Signed-in user id |
| `x-user-role` | `Customer`, `Owner` or `Admin` |
| `x-api-key` | Shared secret, only required when `INTERNAL_API_KEY` is set |

Ownership checks compare `x-user-id` with the listing's `ownerId`. Admin-only routes check `x-user-role`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DB_URL` | MongoDB connection string (secret) |
| `DB_NAME` | Database name; defaults to `equipment-rental-platform` |
| `PORT` | HTTP port; defaults to `5001` |
| `CLIENT_ORIGIN` | Allowed frontend origin(s), comma-separated |
| `INTERNAL_API_KEY` | Optional shared secret required on write requests |
