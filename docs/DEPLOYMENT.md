# Deployment guide

Board Game Referee supports **two deployment profiles** from the same codebase:

| Profile | Purpose | Who uses it |
|---------|---------|-------------|
| **Public demo** | Portfolio / recruiters | Anyone with the README link |
| **Personal** | Full app for you and invited users | You, your husband, a few close friends |

Use **separate hosting instances** so your private rulebooks never mix with public demo traffic.

---

## Architecture overview

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  DEMO INSTANCE (public)     │     │  PERSONAL INSTANCE (private) │
│  ─────────────────────      │     │  ──────────────────────────  │
│  DEMO_MODE=1                │     │  DEMO_MODE=0                 │
│  no API_ACCESS_KEY          │     │  API_ACCESS_KEY=secret       │
│  pre-seeded sample game     │     │  persistent volume           │
│  read-only for visitors     │     │  invite links ?access=SECRET │
│  in README / portfolio      │     │  not linked from README      │
└─────────────────────────────┘     └─────────────────────────────┘
```

Both instances use the same Docker image. Only environment variables differ.

---

## 1. Public demo (portfolio)

**Goal:** Recruiters open one link and ask a question on a sample rulebook in under a minute.

### Environment variables

Copy [`deploy/demo.env.example`](../deploy/demo.env.example) and set:

| Variable | Value |
|----------|--------|
| `ENVIRONMENT` | `production` |
| `DEMO_MODE` | `1` |
| `PRESEED_DEMO_RULEBOOK` | `1` (default when `DEMO_MODE=1`) |
| `ANTHROPIC_API_KEY` | Your API key |
| `CORS_ORIGINS` | `https://your-demo-url.onrender.com` |
| `API_ACCESS_KEY` | **Leave unset** |
| `RATE_LIMIT_LLM_MAX` | `15` (recommended for public demo) |
| `RETRIEVAL_TELEMETRY` | `0` |
| `RULING_FEEDBACK` | `0` |

Also set a **monthly spending limit** on your Anthropic API key in the Anthropic console.

### What visitors can do

- Ask, search, and dispute on the **pre-seeded sample game**
- See citations and page previews

### What visitors cannot do

- Upload PDFs
- Delete or pin rulebooks
- Re-index, BGG import, clear FAQ cache

The UI shows a **Public demo** banner and hides library-management controls.

### Deploy on Render

1. Push this repo to GitHub.
2. Create a **New Web Service** → connect repo → **Docker** runtime.
3. Use [`render.demo.yaml`](../render.demo.yaml) or set env vars manually.
4. Set secrets in the Render dashboard: `ANTHROPIC_API_KEY`, `CORS_ORIGINS`.
5. Deploy and open `https://your-service.onrender.com`.
6. Add the URL to your README under **Live demo**.

### Deploy locally (demo)

```bash
cp deploy/demo.env.example deploy/demo.env
# Edit deploy/demo.env — set ANTHROPIC_API_KEY

docker compose -f docker-compose.demo.yml --env-file deploy/demo.env up --build
```

Open http://localhost:8000 — the sample game should appear in the library.

### Free-tier notes

- **Cold starts:** Render free sleeps after ~15 min idle; first visit may take 30–60s.
- **Ephemeral disk:** Uploads on the demo instance are not meant to persist; the sample game is re-seeded on startup if missing.

---

## 2. Personal instance (full app)

**Goal:** Upload your real rulebooks, use all features, share with your husband via invite link.

### Environment variables

Copy [`deploy/personal.env.example`](../deploy/personal.env.example) and set:

| Variable | Value |
|----------|--------|
| `ENVIRONMENT` | `production` |
| `DEMO_MODE` | `0` |
| `PRESEED_DEMO_RULEBOOK` | `0` |
| `ANTHROPIC_API_KEY` | Your API key (can be same or separate key) |
| `API_ACCESS_KEY` | Long random secret (`openssl rand -hex 32`) |
| `CORS_ORIGINS` | `https://your-private-url.fly.dev` |
| `DATA_DIR` | `/data` with a **persistent volume** attached |

Do **not** put this URL in your public README.

### Sharing with your husband

Send an invite link (the access code is stored for that browser session):

```
https://your-private-url.fly.dev/?access=YOUR_API_ACCESS_KEY
```

The `?access=` parameter is removed from the address bar after load. He can also paste the code on the access gate screen.

### Deploy on Fly.io (recommended for persistence)

Fly supports attached volumes so uploads survive restarts.

1. Install [`flyctl`](https://fly.io/docs/hands-on/install-flyctl/).
2. `fly launch` from the repo root (use the included Dockerfile).
3. Create a volume: `fly volumes create referee_data --size 1`
4. Mount it at `/data` in `fly.toml`.
5. Set secrets:
   ```bash
   fly secrets set ANTHROPIC_API_KEY=sk-... API_ACCESS_KEY=... CORS_ORIGINS=https://...
   fly secrets set DEMO_MODE=0 ENVIRONMENT=production
   ```
6. Deploy: `fly deploy`

See [`render.personal.yaml`](../render.personal.yaml) for Render-based personal deploy (attach a disk if available on your plan).

### Deploy locally (personal)

```bash
cp deploy/personal.env.example deploy/personal.env
# Edit deploy/personal.env

docker compose -f docker-compose.personal.yml --env-file deploy/personal.env up --build
```

Open http://localhost:8000/?access=YOUR_API_ACCESS_KEY

---

## 3. Local development

No demo mode, no API key — full features:

```bash
./scripts/dev.sh
```

Frontend: http://localhost:5173  
Backend: http://localhost:8000

---

## 4. Environment reference

| Variable | Demo | Personal | Local dev |
|----------|------|----------|-----------|
| `DEMO_MODE` | `1` | `0` | unset / `0` |
| `PRESEED_DEMO_RULEBOOK` | `1` | `0` | unset / `0` |
| `API_ACCESS_KEY` | unset | **required** | unset |
| `ENVIRONMENT` | `production` | `production` | unset |
| `RATE_LIMIT_ENABLED` | `1` | `1` | `0` |
| `RETRIEVAL_TELEMETRY` | `0` | optional | `1` |
| `RULING_FEEDBACK` | `0` | optional | `1` |
| `OCR_FALLBACK` | `1` | `1` | `0` |

Full list: [`backend/.env.example`](../backend/.env.example) and [README Configuration](../README.md#configuration).

---

## 5. API behaviour

### `/api/config` (public)

```json
{
  "auth_required": false,
  "demo_mode": true,
  "full_access": false
}
```

- `auth_required` — `true` when `API_ACCESS_KEY` is set
- `demo_mode` — `true` when `DEMO_MODE=1`
- `full_access` — `true` when not in demo mode, or request includes valid API key

### Demo mode restrictions (anonymous users)

| Endpoint | Allowed |
|----------|---------|
| `GET /api/rulebooks` | Demo rulebooks only |
| `POST .../ask`, `.../dispute`, `.../search` | Demo rulebooks only |
| `GET .../preview`, `.../examples` | Demo rulebooks only |
| Upload, delete, pin, reindex, BGG | **403** `demo_readonly` |

Authenticated requests (valid `X-API-Key` or `Authorization: Bearer`) bypass demo restrictions even on a demo-configured instance (hybrid mode — optional, not the recommended two-instance setup).

---

## 6. Checklist

### Demo instance (portfolio)

- [ ] `DEMO_MODE=1`, no `API_ACCESS_KEY`
- [ ] `CORS_ORIGINS` matches demo URL
- [ ] Anthropic spending cap set
- [ ] Live smoke test: open URL → sample game visible → ask a question → citation appears
- [ ] README updated with live demo link and example question

### Personal instance

- [ ] `DEMO_MODE=0`, `API_ACCESS_KEY` set
- [ ] Persistent volume on `DATA_DIR`
- [ ] Invite link tested in a private browser window
- [ ] URL **not** in public README

---

## 7. Troubleshooting

| Problem | Fix |
|---------|-----|
| Access gate on personal instance | Open `?access=YOUR_KEY` or set key on gate screen |
| Empty library on demo | Check logs for seed errors; ensure `backend/assets/demo-rulebook.pdf` is in the image |
| 401 on personal instance | `VITE_API_ACCESS_KEY` not needed if using `?access=` links; key must match `API_ACCESS_KEY` |
| 403 demo_readonly | Expected on demo — use personal instance to upload |
| Cold start timeout | Normal on Render free; mention in README |
| CORS errors | `CORS_ORIGINS` must exactly match browser URL (no trailing slash) |

---

## 8. Cost control

1. **Anthropic console** — set monthly spend limit per API key (use separate keys for demo vs personal if you want).
2. **Rate limits** — tune `RATE_LIMIT_LLM_MAX` on the demo instance.
3. **FAQ cache** — enabled by default; repeat questions skip the LLM.

---

## Related files

| File | Purpose |
|------|---------|
| [`deploy/demo.env.example`](../deploy/demo.env.example) | Demo env template |
| [`deploy/personal.env.example`](../deploy/personal.env.example) | Personal env template |
| [`docker-compose.demo.yml`](../docker-compose.demo.yml) | Local demo Docker |
| [`docker-compose.personal.yml`](../docker-compose.personal.yml) | Local personal Docker |
| [`render.demo.yaml`](../render.demo.yaml) | Render blueprint — demo |
| [`render.personal.yaml`](../render.personal.yaml) | Render blueprint — personal |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI on push |
