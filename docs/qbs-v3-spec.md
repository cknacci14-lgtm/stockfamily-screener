# QBS Strategy v3 — Production Spec

> **Locked:** 2026-09-30
> **Status:** PRODUCTION + Paper Trade 4-8 minggu

## Policy (LOCKED)

    REGIME   : Supportive only
    LABEL    : A, B -> FULL | C -> SKIP
    ENTRY    : Open T+1
    EXIT     : Close T+10 (hard time-stop)
    SIZE     : 3-5% portfolio / posisi (mulai kecil di paper)

## Formula Filter (9 Gate)

    1. FNet3d > 0                     (unit: saham)
    2. CPos3d_max >= 0.65             (max CPos 3 hari)
    3. Fib ratio 0.50-0.81            (swing 20d, retrace from High)
    4. Koreksi -3% s/d -14%           (vs High 10d)
    5. Bid Dominant                   (bid_vol > offer_vol; auto-pass if both 0)
    6. Nilai >= Rp 1 Miliar
    7. Volume > 100,000
    8. RVOL 5d < 1.3
    9. Close > 100

## Label (Sequential)

    A: CPos >= 0.55 AND FNet1d >= 0
    B: CPos >= 0.40 OR  FNet1d > -0.5 * FNet3d
    C: otherwise

## Regime

    Supportive: pct_up >= 45% AND mean_fnet >= 0
    Semua lain: SKIP

## Backtest Results

| Period          | N   | T+5    | T+10   | T+20   |
|-----------------|-----|--------|--------|--------|
| 2025 Sep-Des    | 140 | -0.05% | +0.96% | +0.70% |
| 2026 Q1         | 41  | +2.75% | +3.01% | -7.09% |
| 2026 Apr-Sep    | 78  | +1.31% | +0.97% | +0.82% |
| 2026 Jul-Sep    | 38  | +1.98% | +3.27% | +4.08% |
| **Avg**         | --- | **+1.50%** | **+2.05%** | **-0.37%** |

## Validated By

- Tier 1 cut: Weak / Neutral- / Supportive-C
- Tier 2 cut: Neutral+
- Time-stop: T+10 (T+20 fade, worst Q1 -7.09%)
- Sanity check: 2025 OOS pass marginal

## Caveat & Monitoring

- Edge regime-dependent: kuat di bull, tipis di chop
- Supportive hanya ~15-20% hari
- Win rate ~45-55% - edge dari avg win > avg loss + hold discipline
- JANGAN hold ke T+20 tanpa alasan chart kuat
- Review trigger: T+10 avg < +0.5% setelah >= 30 signal live

## Module

- `src/lib/qbs-v3.js` - pure functions (filter, label, regime, action)
- `scripts/qbs-backtest-v2.js` - backtest runner
- `scripts/qbs-validate.js` - validator self-test