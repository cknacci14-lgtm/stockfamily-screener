# CHARTNALIS â€” Project Status & Handoff

> **Last updated:** 2026-09-29
> **Status:** PRODUCTION LIVE

## URLs

| Environment | URL | Platform |
|-------------|-----|----------|
| **Production** | https://chartnalis.web.id | Cloudflare Pages |
| Preview | https://chartnalist.pages.dev | Cloudflare Pages |
| Legacy (fallback) | https://chartnalis.netlify.app | Netlify (credit habis) |
| GitHub Repo | https://github.com/cknacci14-lgtm/stockfamily-screener | GitHub |

## Architecture

    Frontend:   HTML + Vanilla JS + Tailwind (public/)
    Backend:    Hono Functions (functions/) - bundled by Wrangler
    Database:   Supabase (shared instance)
    Storage:    Supabase buckets (images)
    Monitor:    GitHub Actions (signal engine)
    Notifier:   Telegram bot
    DNS:        Cloudflare (cartman.ns + raegan.ns.cloudflare.com)

## Build & Deploy

- Cloudflare Pages Build command: `bash build.sh`
- Build output directory: `public`
- Root directory: `/`
- Auto-deploy: Push ke `main` trigger build otomatis
- `build.sh`: Skip `npm install` - static assets served as-is, Hono functions bundled runtime

## Completed (History)

### 2026-09-29 - Migration & Rebrand Complete
- [x] DNS NS transfer IDwebhost -> Cloudflare
- [x] Custom domain `chartnalis.web.id` Active + SSL
- [x] CNAME `@ -> chartnalist.pages.dev` (Proxied)
- [x] Build command `bash build.sh` + output `public`
- [x] Rebrand sidebar & titles: `StockFamily` -> `CHARTNALIST` (visible text only)
- [x] Hapus `.netlify/` + `stockfamily-qbs-production-integration/`
- [x] Fix BOM di `build.sh`
- [x] `.gitattributes` - enforce LF untuk `*.sh`
- [x] HTTP -> HTTPS redirect (Cloudflare Always Use HTTPS)
- [x] Verify HTTPS 200 OK + production render

## Todo (Next Session)

- [ ] `www.chartnalis.web.id` subdomain + redirect ke apex
- [ ] SSL/TLS Full (strict) + Minimum TLS 1.2
- [ ] Cloudflare Web Analytics enable
- [ ] Uptime monitoring (UptimeRobot / cron-job.org)
- [ ] Custom 404.html + 500.html on-brand
- [ ] Security headers (`_headers` file: CSP, HSTS, X-Frame-Options)
- [ ] PWA manifest + service worker
- [ ] SEO: sitemap.xml, robots.txt, OG meta
- [ ] Performance: Cloudflare cache rules, image optimization

## Gotchas & Conventions

### JANGAN Diubah (Internal IDs)
- Contract IDs: `STOCKFAMILY_QBS_*`, `STOCKFAMILY_PREQMB_*` di `results/`, `scripts/`, `src/services/`
- localStorage keys: `stockfamily.sidebar.collapsed`, `chartnalist_watchlist_codes`
- CSS selectors: `#stockfamily-global-sidebar`, `.sf-brand`, `.sf-mark`
- File asset: `public/assets/stockfamily-sidebar.js`, `stockfamily-typography.css/js`

### Naming Convention
- Brand display: `CHARTNALIST` (dengan T)
- Domain: `chartnalis.web.id` (tanpa T)
- Repo folder: `stockfamily-screener` (legacy, tidak diubah)

### PowerShell Safety (Windows)
- WAJIB pakai `-creplace` (case-sensitive), BUKAN `-replace` (case-insensitive)
- WAJIB `-Encoding UTF8` di `Set-Content`, atau pakai `[System.IO.File]::WriteAllText($p, $c, [Text.UTF8Encoding]::new($false))`
- Prefer VSCode manual edit untuk file < 10 baris - hindari script batch
- Backup sebelum batch edit: `git checkout -- <file>` untuk revert
- Cek BOM: `Format-Hex <file> | Select-Object -First 1` - byte pertama harus `23` (`#`), bukan `EF`

### Git
- Line endings: LF enforced via `.gitattributes`
- Commit message style: `type: description` (contoh: `fix: strip BOM from build.sh`)

## Secrets & Env Vars

Set di Cloudflare Pages -> Settings -> Environment variables:
- `SUPABASE_URL` - (set di dashboard)
- `SUPABASE_ANON_KEY` - (set di dashboard)
- `TELEGRAM_BOT_TOKEN` - (set di GitHub Actions secrets)
- `TELEGRAM_CHAT_ID` - (set di GitHub Actions secrets)

Jangan commit secrets ke repo. Cek `.env.example` untuk reference.

## Handy Commands

    # Test production
    curl.exe -I https://chartnalis.web.id

    # Test redirect
    curl.exe -I http://chartnalis.web.id

    # Cek DNS
    nslookup chartnalis.web.id 1.1.1.1

    # Flush DNS lokal
    ipconfig /flushdns

    # Cek BOM di file
    Format-Hex build.sh | Select-Object -First 1

    # Cek history commit
    git log --oneline -10

    # Revert file spesifik
    git checkout -- public/index.html

## References

- Cloudflare Dashboard: https://dash.cloudflare.com/72dc2181843265a7dd864febad5a99c4
- Pages Project: `chartnalist`
- Zone: `chartnalis.web.id` (Account: Cknacci14@gmail.com)
---

## UPDATE 2026-10-01 — Auth + Paper Trade Live

### New Components
- Auth system: Supabase Auth (login/register/landing) + role guard
- Hono auth endpoints: /api/auth/config, /api/auth/me (Edge-compatible)
- Paper trade tracker: scripts/qbs-paper-trade-track.js (auto via cron)
- Docs: docs/paper-trade-result-2026-10-01.md

### Production Status (2026-10-01)
- chartnalis.web.id/screener -> 200 (V3, regime=Weak, 0 signals)
- chartnalis.web.id/login -> 200 (Supabase Auth)
- chartnalis.web.id/signals -> 200
- chartnalis.web.id/watchlist -> 200
- /api/auth/config -> 200
- /results/paper-trade-log.json -> 200 (140 entries)

### Paper Trade Validation (OOS Oct-Dec 2025)
- N=140 signals
- Win rate 48.6%, Avg return +1.58%, R:R 1.82:1
- Spec v3 VALIDATED

### Workflow Cron
- Schedule: Mon-Fri 17:00 WIB (10:00 UTC)
- Steps: QBS screener -> paper trade tracker -> auto-commit
- Node: v22 (required for Supabase WebSocket)

### Current State Notes
- 2026-10-01: Market regime = Weak -> 0 signals (expected v3 behavior)
- Weak/Neutral regime => SKIP all (spec v3 policy)

### Monitor Signals Workflow — Known Limitations

- **Schedule:** `*/15 * * * *` (setiap 15 menit)
- **Reality:** GitHub Actions free tier throttle ? delay 3-4 jam antar runs
- **Impact:** SL/TP detection delay ~4 jam worst case
- **Status:** Acceptable untuk swing trading (T+10 exit)
- **Upgrade path:** Kalau butuh real-time ? port ke Cloudflare Workers Cron

Last verified: 2026-10-01
- 14 runs total, semua success
- Scheduled runs: 3-6 jam interval (throttled)
