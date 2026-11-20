# Equipment Rental Platform API

Beginner-friendly Express.js and MongoDB backend for the Equipment Rental Platform. The server is written in JavaScript ES modules.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DB_URL` to your MongoDB connection string.
3. Start in development with `npm run dev`, or run with `npm start`.

The server defaults to port `5001` and database `equipment-rental-platform`. `CLIENT_ORIGIN` accepts a comma-separated list of allowed browser origins.

## Starter endpoints

- `GET /` — API identity
- `GET /api/health` — server health
- `GET /api/users` — user records with password fields excluded
- `GET /api/equipments` — equipment records
- `GET /api/bookings` — booking records

Responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "message": ... } }`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DB_URL` | MongoDB connection string (secret) |
| `DB_NAME` | Database name; defaults to `equipment-rental-platform` |
| `PORT` | HTTP port; defaults to `5001` |
| `CLIENT_ORIGIN` | Allowed frontend origin(s), comma-separated |

Authentication middleware, role permissions, and equipment management are not part of this starter foundation yet.
