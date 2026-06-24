# Deployment guide

Board Game Referee is designed for a simple real-world pattern: **upload a rulebook, ask a question at the table, close the tab, come back weeks later** — from a **phone, laptop, or another device**.

The **recommended setup** is **one cloud deploy** with:

- a **public demo** for recruiters (pre-seeded sample game, no upload)
- **full access** for you and family via an invite link
- a **persistent disk** so uploaded PDFs survive restarts

---

## Recommended: one deploy, two access levels

```
https://your-app.example.com
│
├── Public (README link, no secret)
│   └── Demo only — sample game, ask / search / dispute
│
└── Family (?access=SECRET bookmark on each device)
    └── Full app — upload rulebooks, your library everywhere
```

| Who | URL | Access |
|-----|-----|--------|
| Recruiters | `https://your-app.example.com` | Demo sample game |
| You, husband, close friends | `https://your-app.example.com/?access=SECRET` | Full app, shared library |

**Typical session:** upload PDF → ask 1–3 questions → forget about it until the next game night. Rulebooks stay on the server volume; chat history is per-browser (see [Cross-device notes](#cross-device-notes)).

### Environment variables

Copy [`deploy/hybrid.env.example`](../deploy/hybrid.env.example) → `deploy/hybrid.env`:

| Variable | Value |
|----------|--------|
| `ENVIRONMENT` | `production` |
| `DEMO_MODE` | `1` |
| `PRESEED_DEMO_RULEBOOK` | `1` |
| `API_ACCESS_KEY` | Long random secret (`openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY` | Your API key |
| `CORS_ORIGINS` | `https://your-exact-app-url` (no trailing slash) |
| `DATA_DIR` | `/data` with a **persistent volume** mounted |
| `OCR_FALLBACK` | `1` |
| `RATE_LIMIT_LLM_MAX` | `15` (tune for public demo traffic) |
| `RETRIEVAL_TELEMETRY` | `0` |
| `RULING_FEEDBACK` | `0` |

**Docker frontend build (hybrid):** the Dockerfile defaults `VITE_DEMO_MODE=1` so the bundled SPA treats a brief `/api/config` failure as public demo (not the access gate). Personal-only images: `docker build --build-arg VITE_DEMO_MODE=0 .`. Do **not** bake `VITE_API_ACCESS_KEY` into the image — family access uses `?access=` at runtime.

Set a **monthly spending limit** on your Anthropic key in the [Anthropic console](https://console.anthropic.com).

### Deploy on Fly.io (recommended — persistent volume)

Fly attaches a volume at `/data` so uploads survive deploys and restarts.

1. Install [`flyctl`](https://fly.io/docs/hands-on/install-flyctl/).
2. From the repo root: `fly launch` (use the included Dockerfile, don’t add a second Postgres/Redis).
3. Create a volume in the same region as your app:
   ```bash
   fly volumes create referee_data --size 1 --region <your-region>
   ```
4. Mount `/data` in `fly.toml` (Fly may prompt during launch):
   ```toml
   [mounts]
     source = "referee_data"
     destination = "/data"
   ```
5. Set secrets:
   ```bash
   fly secrets set \
     ANTHROPIC_API_KEY=sk-... \
     API_ACCESS_KEY=$(openssl rand -hex 32) \
     CORS_ORIGINS=https://your-app.fly.dev \
     DEMO_MODE=1 \
     PRESEED_DEMO_RULEBOOK=1 \
     ENVIRONMENT=production \
     DATA_DIR=/data
   ```
6. `fly deploy`
7. Smoke test:
   - Public: `https://your-app.fly.dev` → sample game → ask a question
   - Family: `https://your-app.fly.dev/?access=YOUR_API_ACCESS_KEY` → upload a PDF

### Deploy on Render

Render can run the same hybrid config. **Attach a persistent disk** — the free tier without disk will wipe uploads on restart.

1. New **Web Service** → repo → **Docker** runtime.
2. Use [`render.yaml`](../render.yaml) or set env vars from [`deploy/hybrid.env.example`](../deploy/hybrid.env.example).
3. Add a disk mounted at `/data`; set `DATA_DIR=/data`.
4. Set secrets: `ANTHROPIC_API_KEY`, `API_ACCESS_KEY`, `CORS_ORIGINS`.
5. Add the **public** URL to your README (no `?access=`).

### Local Docker (hybrid)

```bash
cp deploy/hybrid.env.example deploy/hybrid.env
# Edit deploy/hybrid.env — set ANTHROPIC_API_KEY and API_ACCESS_KEY

docker compose -f docker-compose.hybrid.yml --env-file deploy/hybrid.env up --build
```

- Public demo: http://localhost:8000  
- Full access: http://localhost:8000/?access=YOUR_API_ACCESS_KEY  

---

## Cross-device notes

| Data | Where it lives | Cross-device? |
|------|----------------|---------------|
| **Rulebooks (PDFs + index)** | Server volume (`DATA_DIR`) | ✅ Same library on phone and laptop after `?access=` |
| **Chat / recent rulings** | Browser `localStorage` | ❌ Per device and browser — new phone = fresh conversation, same rulebooks |
| **Access code** | `sessionStorage` after `?access=` | Re-bookmark `?access=SECRET` on each device; survives until you quit the browser |

**On each device:** bookmark the family URL once. Don’t put it in the README or GitHub.

---

## What each access level can do

### Public (no API key)

- Ask, search, dispute on the **pre-seeded sample game**
- Citations and page previews
- UI shows a **Public demo** banner

Cannot: upload, delete, pin, re-index, BGG import.

### Family (valid `?access=` or `X-API-Key`)

- Everything: upload rulebooks, full library, all devices sharing the same server data
- No demo banner; upload controls visible

---

## API behaviour

### `GET /api/config`

```json
{
  "auth_required": false,
  "demo_mode": true,
  "full_access": false
}
```

| Field | Meaning |
|-------|---------|
| `auth_required` | `true` only on **personal-only** deploys (`DEMO_MODE=0` + key). Hybrid demo stays open to anonymous users. |
| `demo_mode` | `true` when `DEMO_MODE=1` |
| `full_access` | `true` with a valid API key, or when not in demo mode |

### Demo restrictions (anonymous + `DEMO_MODE=1`)

| Endpoint | Anonymous |
|----------|-----------|
| `GET /api/rulebooks` | Demo rulebooks only |
| `POST .../ask`, `.../dispute`, `.../search` | Demo rulebooks only |
| Upload, delete, pin, reindex, BGG | **403** `demo_readonly` |

Requests with a valid API key bypass demo restrictions on the same instance.

---

## Checklist (recommended hybrid deploy)

- [ ] `DEMO_MODE=1`, `API_ACCESS_KEY` set, `PRESEED_DEMO_RULEBOOK=1`
- [ ] Docker image built with `VITE_DEMO_MODE=1` (Dockerfile default; hybrid `docker compose` passes it)
- [ ] Persistent volume on `/data` (not ephemeral-only hosting)
- [ ] `CORS_ORIGINS` matches your public URL exactly
- [ ] Anthropic monthly spend cap set
- [ ] Public smoke test: sample game → ask → citation
- [ ] Family smoke test: `?access=` → upload PDF → ask (second device optional)
- [ ] README lists **public URL only**
- [ ] Family bookmark saved on phone and laptop

---

## Local development

Full features, no demo mode, no API key:

```bash
./scripts/dev.sh
```

Frontend: http://localhost:5173 · Backend: http://localhost:8000

Data persists in `backend/data/` on your machine between runs.

---

## Alternative setups

Use these only if the recommended hybrid deploy doesn’t fit.

### A. Demo-only cloud (portfolio, no family cloud)

For README/recruiters only; you use local dev or a separate setup for personal use.

| | |
|--|--|
| **Env** | `DEMO_MODE=1`, **no** `API_ACCESS_KEY` |
| **Template** | [`deploy/demo.env.example`](../deploy/demo.env.example) |
| **Compose** | `docker-compose.demo.yml` |
| **Blueprint** | [`render.demo.yaml`](../render.demo.yaml) |
| **Tradeoff** | No cross-device personal library in the cloud |

### B. Personal-only cloud (no public demo)

Private app behind access gate; not suitable for a README live demo.

| | |
|--|--|
| **Env** | `DEMO_MODE=0`, `API_ACCESS_KEY` required for all API calls |
| **Template** | [`deploy/personal.env.example`](../deploy/personal.env.example) |
| **Compose** | `docker-compose.personal.yml` |
| **Blueprint** | [`render.personal.yaml`](../render.personal.yaml) |
| **Tradeoff** | Recruiters need the secret — use hybrid instead |

### C. Two separate cloud deploys (maximum isolation)

Demo instance (public, ephemeral OK) + personal instance (private, volume). Same env split as sections A and B on two hosts.

| Pluses | Minuses |
|--------|---------|
| Hard separation of public and private data | 2× deploys, 2× cold starts, 2× config |
| Demo abuse isolated from your library | More ops for sporadic personal use |

See [`render.demo.yaml`](../render.demo.yaml) and [`render.personal.yaml`](../render.personal.yaml).

### D. Local personal only

`./scripts/dev.sh` or `docker-compose.personal.yml` on your Mac.

| Pluses | Minuses |
|--------|---------|
| Simplest, free, persistent local `data/` | No access from phone unless machine is running |

---

## Environment reference

| Variable | Hybrid (recommended) | Demo-only | Personal-only | Local dev |
|----------|-------------------|-----------|---------------|-----------|
| `DEMO_MODE` | `1` | `1` | `0` | `0` |
| `PRESEED_DEMO_RULEBOOK` | `1` | `1` | `0` | `0` |
| `API_ACCESS_KEY` | **set** | unset | **set** | unset |
| `DATA_DIR` | `/data` + volume | optional | `/data` + volume | `./data` |
| `ENVIRONMENT` | `production` | `production` | `production` | unset |

Full list: [`backend/.env.example`](../backend/.env.example) · [README Configuration](../README.md#configuration)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Recruiters see access gate | Hybrid should not gate anonymous users — ensure `DEMO_MODE=1` |
| Uploads vanished after redeploy | Attach a persistent volume; free ephemeral disk resets |
| Access gate on personal-only deploy | Open `?access=YOUR_KEY` or enter code on gate screen |
| Empty library on demo | Check logs for seed errors; `backend/assets/demo-rulebook.pdf` must be in image |
| 403 `demo_readonly` | Expected without key — use family bookmark |
| 401 with key | Key must match `API_ACCESS_KEY`; try `?access=` again |
| CORS errors | `CORS_ORIGINS` must exactly match browser URL (no trailing slash) |
| Cold start | Normal on free tiers; note in README (~30–60s) |

---

## Cost control

1. **Anthropic console** — monthly spend limit on your API key.
2. **Rate limits** — `RATE_LIMIT_LLM_MAX` caps anonymous demo ask/dispute volume.
3. **FAQ cache** — repeat identical questions skip the LLM.

---

## Related files

| File | Purpose |
|------|---------|
| [`deploy/hybrid.env.example`](../deploy/hybrid.env.example) | **Recommended** env template |
| [`docker-compose.hybrid.yml`](../docker-compose.hybrid.yml) | Local hybrid Docker |
| [`render.yaml`](../render.yaml) | Render blueprint — hybrid |
| [`deploy/demo.env.example`](../deploy/demo.env.example) | Demo-only alternative |
| [`deploy/personal.env.example`](../deploy/personal.env.example) | Personal-only alternative |
| [`render.demo.yaml`](../render.demo.yaml) / [`render.personal.yaml`](../render.personal.yaml) | Two-deploy alternative |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI on push |
