# Bank Statement Converter

Converts bank statement PDFs (and scanned images) to Excel.

## Structure

```
/frontend   React SPA (Vite + TanStack Router), calls the backend over /api
/backend    Plain Node HTTP server: POST /api/convert, serves frontend/dist statically
```

The backend is the only thing that talks to bank-parsing logic, OCR.space, and the
filesystem. The frontend never touches PDFs directly — it uploads to `/api/convert`
and downloads the returned `.xlsx`.

## Setup

```
npm install          # installs both workspaces
```

Copy env examples and fill in real values:

```
cp frontend/.env.example frontend/.env   # VITE_SUPABASE_*
cp backend/.env.example backend/.env     # OCR_SPACE_API_KEY
```

## Development

Run both in separate terminals (or use `run-dev.cmd` on Windows, which does this for you):

```
npm run dev:backend    # http://localhost:8080  (POST /api/convert)
npm run dev:frontend   # http://localhost:8090  (proxies /api to :8080)
```

## Production

```
npm run build   # builds frontend/dist
npm run start   # builds, then runs the backend, which also serves frontend/dist
```

Single process, single port — same deploy model as before (e.g. Render), just backed
by a plain Node server instead of TanStack Start's SSR entry.

## Deployment

This is a single monorepo, but `/frontend` and `/backend` deploy as two independent
processes on two different platforms:

- **Frontend → Vercel.** Set the project's root directory to `frontend`. Build
  command `npm run build`, output directory `dist`. Required env vars:
  - `VITE_API_BASE_URL` — the backend's deployed URL (e.g. `https://api.example.com`).
    Leave empty only if frontend and backend somehow share one origin.
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
  - `VITE_APP_BASE_PATH` (optional, defaults to `/`)

- **Backend → Hostinger.** Set the app's root directory to `backend`, start command
  `npm run start` (runs `node src/server.js`). Required env vars:
  - `PORT` — leave unset if Hostinger assigns its own; the server reads it from
    the environment and falls back to `8080` locally.
  - `ALLOWED_ORIGIN` — comma-separated list of origins allowed to call `/api/*`
    (the deployed frontend's URL, plus any Vercel preview-deployment URLs).
  - `OCR_SPACE_API_KEY`

Each folder has its own `package.json`, `.env.example`, and `.gitignore` and builds/
runs correctly with the other folder absent — neither depends on files outside its
own directory. Because the two are on different origins in this deploy, the backend's
CORS headers are driven entirely by `ALLOWED_ORIGIN`, not hardcoded to localhost.

## Tests

```
npm test   # runs backend/tests via node --test
```

Some tests are skipped unless you drop real sample PDFs into `backend/tmp/` (see the
test files for expected filenames) — these are optional local fixtures, not committed.

## Notes on this structure

- The app used to run as a single TanStack Start (SSR) process. This restructure
  converts the frontend to a plain client-side SPA and the backend to a plain Node
  `http` server, so the two can live and deploy as clearly separate concerns. This
  means the app no longer does server-side rendering — routes are client-rendered
  only, and per-route `<title>`/meta tags set via TanStack Router's `head()` option
  are not applied to the document (only the static `<title>` in `frontend/index.html`
  is used). If SEO/SSR matters for public marketing pages, that's a tradeoff worth
  revisiting.
- Client-side auth (Supabase JS + localStorage session) is unchanged. `/api/convert`
  still has no server-side auth check — same as before this restructure.
# bankstatement_converter
