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
