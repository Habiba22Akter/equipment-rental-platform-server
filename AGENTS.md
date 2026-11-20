# Backend notes

- This backend uses JavaScript ES modules. Keep it beginner-friendly and do not add TypeScript or advanced repository/service layers unless requested.
- Main entry point: `src/index.js`; Express app: `src/app.js`.
- Keep MongoDB setup in `src/config/database.js` and environment loading in `src/config/env.js`.
- Put route handlers under `src/routes/<resource>/` and middleware under `src/middleware/`.
- API responses use `{ success, data }` on success and `{ success: false, error: { message } }` on errors.
- Keep real credentials in `.env`; update `.env.example` with names and safe placeholders only.

## Completed foundation

- Added Express app with CORS, JSON parsing, health endpoint, 404 handling, and centralized error handling.
- Added MongoDB connection and ping during startup, configured by `DB_URL` and `DB_NAME`.
- Added starter GET routes for users, equipments, and bookings.
- Added `npm run dev` and `npm start` scripts.
- Verified locally: server startup, MongoDB ping, health and collection endpoints, CORS, JSON parse errors, and 404 response.

## Next recommended step

Implement equipment create/update/delete routes with owner ownership checks, then connect the owner equipment form to those routes.
