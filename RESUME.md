# RESUME - CHARTNALIS

**State:** LIVE di https://chartnalis.web.id (Cloudflare Pages)

**Repo:** C:\Users\user\stockfamily-screener

## Last Done (2026-10-01)

- V3 screener production + auto-refresh cron (Sen-Jum 17:00 WIB)
- Auth system live (login/register/landing + role guard admin)
- Paper trade tracker auto (140 signals OOS validated: +1.58% avg, R:R 1.82:1)
- Monitor signals workflow + DRY_RUN safety verified
- GOTO SL auto-resolved (CLOSED)
- Mojibake 100% cleanup + full rebrand CHARTNALIST
- Node 22 upgrade (both workflows)

## Architecture

- Frontend: public/*.html (V3 screens, auth pages)
- Backend: functions/api/[[path]].js (Hono, Edge)
- DB: Supabase (shared)
- Cron: GitHub Actions (QBS screener + Monitor signals)
- Deploy: Cloudflare Pages (auto from main)

## Next Priorities

1. Monitor paper trade log weekly
2. Optional: Port monitor to Cloudflare Workers Cron (fix throttling)
3. Optional: Paper trade dashboard UI

## Quick Test

    curl.exe -s -o NUL -w "screener: %{http_code}\n" "https://chartnalis.web.id/screener"
    curl.exe -s -o NUL -w "signals:  %{http_code}\n" "https://chartnalis.web.id/signals"
    curl.exe -s -o NUL -w "auth:     %{http_code}\n" "https://chartnalis.web.id/api/auth/config"

## Docs

- docs/qbs-v3-spec.md - Strategy spec
- docs/paper-trade-result-2026-10-01.md - OOS validation
- PROJECT_STATUS.md - Full status

## Known Limitations

- Monitor signals: GitHub Actions throttle -> 3-4h delay (acceptable for swing)
- Cron QBS: reliable 17:00 WIB Sen-Jum