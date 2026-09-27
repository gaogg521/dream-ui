//! The balance this broker shows the user is not the vendor's real spend
//! cap. The vendor side is denominated in real, marked-up CNY (see
//! `crate::topup::granted_for_payment`) — a ¥11 payment only ever buys ¥10
//! of real vendor spending power at a 10% markup. The user must never be
//! able to see that ratio: they pay ¥11, they must see their balance grow
//! by exactly ¥11.
//!
//! The free grant and every real top-up are tracked as two **separate
//! pools** — `grant_*` and `paid_*` — and consumption spends the grant pool
//! first, at 1:1, before the markup ratio ever touches anything:
//!
//! - The grant pool never carries any markup, ever, no matter how much has
//!   been paid on top of it. Free is free.
//! - The paid pool is "prepaid at a discount": a real payment credits it at
//!   face value (what the user paid), but the vendor's real remain only
//!   grows by the discounted amount. Consumption from this pool is scaled
//!   up by the markup so the two stay in lockstep — the paid pool's visible
//!   balance and the vendor's real remain for that pool reach zero at
//!   exactly the same moment. No leftover "looks like there's still money
//!   but every call fails" gap, at any size of top-up.
//!
//! `paid_real_remain_cny` is a shadow ledger — the paid pool's real remain
//! on the vendor's side, tracked here but never shown to the user — and
//! `last_synced_vendor_remain` is the anchor `reconcile_usage` measures the
//! vendor's total real remain (grant + paid) against.

/// The six columns in `issuances` this module owns.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VisibleBalanceState {
    /// Total free grant this install has ever been given (a fixed policy
    /// value at issuance time — never grows).
    pub grant_limit_cny: f64,
    /// What's left of the free grant, shown to the user as-is.
    pub grant_balance_cny: f64,
    /// Everything this install has ever paid, at face value (never marked
    /// up) — grows by the real amount paid on every settled top-up.
    pub paid_limit_cny: f64,
    /// What's left of the paid pool, shown to the user as-is.
    pub paid_balance_cny: f64,
    /// Shadow ledger: the paid pool's real remain on the vendor's side.
    /// Never shown to the user — only used to keep `paid_balance_cny` in
    /// lockstep with what the vendor is actually still willing to serve.
    pub paid_real_remain_cny: f64,
    /// The vendor's total real remain (grant + paid) as of the last time
    /// this ledger was written.
    pub last_synced_vendor_remain: f64,
}

/// Rounds to the nearest cent — every write to this ledger goes through
/// this so accumulated floating-point drift across many small reconciles
/// never becomes user-visible.
fn round_cents(amount: f64) -> f64 {
    (amount * 100.0).round() / 100.0
}

/// Call on every read of the vendor's live usage (`TokenVendor::read_usage`).
/// Folds in whatever changed on the vendor's side since the last observation
/// as ordinary usage, spending the grant pool first (1:1) and only drawing
/// on the paid pool (scaled by `markup`) once the grant is exhausted.
///
/// `current: None` — an issuance predating this ledger, or one that has
/// never been reconciled — puts everything currently on the vendor's side
/// into the grant pool and leaves the paid pool at zero: there is no way to
/// know how a historical payment split between the two (see the module
/// doc), so this can only guarantee correctness from this point forward,
/// not reconstruct history.
///
/// Returns `None` when `vendor_remaining_usd` is `None` (a vendor with no
/// cap concept at all) — the caller should fall back to the vendor's raw
/// fields directly rather than force this ledger onto a vendor it does not
/// apply to.
///
/// Consumption from the paid pool is scaled by that pool's *own current*
/// visible/real ratio (`paid_balance_cny / paid_real_remain_cny`), not the
/// global `markup` config directly. In the common case — a paid pool funded
/// purely by real (marked-up) top-ups — that ratio simply equals the
/// markup, so this behaves identically. It only diverges when an ops
/// adjustment (`service::apply_top_up`, never marked up) has also credited
/// this pool: using a fixed global markup there would scale down the
/// ops-credited money on the way out too, quietly shorting it. Deriving the
/// ratio from the pool's own state instead keeps it exact for whatever mix
/// actually funded it.
pub fn reconcile_usage(
    current: Option<VisibleBalanceState>,
    vendor_limit_usd: Option<f64>,
    vendor_remaining_usd: Option<f64>,
) -> Option<VisibleBalanceState> {
    let remaining = vendor_remaining_usd?;
    let Some(state) = current else {
        return Some(VisibleBalanceState {
            grant_limit_cny: vendor_limit_usd.unwrap_or(remaining),
            grant_balance_cny: remaining,
            paid_limit_cny: 0.0,
            paid_balance_cny: 0.0,
            paid_real_remain_cny: 0.0,
            last_synced_vendor_remain: remaining,
        });
    };

    let delta = remaining - state.last_synced_vendor_remain;
    if delta >= 0.0 {
        // A non-negative change here should only ever come from a top-up,
        // which is handled by `apply_paid_credit` instead — this branch
        // means something moved the vendor's real remain outside that path
        // (e.g. an old operational tool calling the vendor directly).
        // Conservatively fold it into the paid pool's shadow ledger only,
        // without granting any new *visible* balance (there is no way to
        // know how much the user should be shown for it) — this keeps the
        // anchor correct so the next reconcile doesn't misread this gap as
        // negative usage.
        return Some(VisibleBalanceState {
            paid_real_remain_cny: round_cents(state.paid_real_remain_cny + delta),
            last_synced_vendor_remain: remaining,
            ..state
        });
    }

    let mut consumed = -delta; // real CNY spent since the last reconcile
    let from_grant = consumed.min(state.grant_balance_cny.max(0.0));
    let grant_balance_cny = round_cents(state.grant_balance_cny - from_grant);
    consumed -= from_grant;

    let (paid_balance_cny, paid_real_remain_cny) = if consumed > 0.0 {
        // Grant exhausted — the rest comes out of the paid pool, scaled by
        // that pool's own current ratio so it empties in lockstep with the
        // vendor's real remain for this pool, not before or after (see the
        // function doc for why this isn't just the global markup).
        let from_paid_real = consumed.min(state.paid_real_remain_cny.max(0.0));
        let pool_ratio = if state.paid_real_remain_cny > 0.0 {
            state.paid_balance_cny / state.paid_real_remain_cny
        } else {
            // Nothing left to scale — from_paid_real is 0 in this case, so
            // the ratio is never actually applied to anything.
            1.0
        };
        let from_paid_visible = round_cents(from_paid_real * pool_ratio);
        (
            round_cents((state.paid_balance_cny - from_paid_visible).max(0.0)),
            round_cents(state.paid_real_remain_cny - from_paid_real),
        )
    } else {
        (state.paid_balance_cny, state.paid_real_remain_cny)
    };

    Some(VisibleBalanceState {
        grant_balance_cny,
        paid_balance_cny,
        paid_real_remain_cny,
        last_synced_vendor_remain: remaining,
        ..state
    })
}

/// Starting ledger for a freshly minted key (first-ever claim, or a
/// recovery reissue after the old key was confirmed gone). `grant_cny` and
/// `paid_total_cny` are both face-value, never marked up. `markup` converts
/// `paid_total_cny` into the paid pool's real shadow remain
/// (`crate::topup::granted_for_payment`). `vendor_remain_at_issue` is the
/// new key's real starting remain on the vendor's side; a fresh key has
/// `used = 0`, so this is simply the `limit_usd` handed to
/// `TokenVendor::issue_key` — no extra vendor call needed.
pub fn init_visible_balance(
    grant_cny: f64,
    paid_total_cny: f64,
    markup: f64,
    vendor_remain_at_issue: f64,
) -> VisibleBalanceState {
    VisibleBalanceState {
        grant_limit_cny: grant_cny,
        grant_balance_cny: grant_cny,
        paid_limit_cny: paid_total_cny,
        paid_balance_cny: paid_total_cny,
        paid_real_remain_cny: crate::topup::granted_for_payment(markup, paid_total_cny),
        last_synced_vendor_remain: vendor_remain_at_issue,
    }
}

/// Folds a top-up (a real payment, or an ops adjustment) into the paid pool
/// only — the grant pool is never touched by money changing hands.
/// `user_facing_amount` is what the user actually paid (or the ops delta as
/// given), always at face value. `vendor_granted_amount` is what actually
/// landed on the vendor's real remain — for a real payment this is
/// `granted_for_payment(markup, amount)`; for an ops top-up
/// (`service::apply_top_up`) the two are equal, since that path has never
/// been marked up. Callers must reconcile (`reconcile_usage`) immediately
/// before this, using the vendor's remain from just *before* the top-up, so
/// any usage between the last reconcile and this credit is folded in first.
/// `new_vendor_remain` is the vendor's real remain *after* the top-up
/// landed — reuse the `KeyUsage` the top-up call already returned rather
/// than making another round trip.
pub fn apply_paid_credit(
    current: VisibleBalanceState,
    user_facing_amount: f64,
    vendor_granted_amount: f64,
    new_vendor_remain: f64,
) -> VisibleBalanceState {
    VisibleBalanceState {
        paid_limit_cny: round_cents(current.paid_limit_cny + user_facing_amount),
        paid_balance_cny: round_cents(current.paid_balance_cny + user_facing_amount),
        paid_real_remain_cny: round_cents(current.paid_real_remain_cny + vendor_granted_amount),
        last_synced_vendor_remain: new_vendor_remain,
        ..current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKUP: f64 = 1.10;

    #[test]
    fn reconcile_initializes_everything_into_the_grant_pool_when_never_tracked() {
        let state = reconcile_usage(None, Some(10.0), Some(6.74)).unwrap();
        assert_eq!(
            state,
            VisibleBalanceState {
                grant_limit_cny: 10.0,
                grant_balance_cny: 6.74,
                paid_limit_cny: 0.0,
                paid_balance_cny: 0.0,
                paid_real_remain_cny: 0.0,
                last_synced_vendor_remain: 6.74,
            }
        );
    }

    #[test]
    fn reconcile_returns_none_for_a_vendor_with_no_cap_concept() {
        let state = VisibleBalanceState {
            grant_limit_cny: 5.0,
            grant_balance_cny: 5.0,
            paid_limit_cny: 0.0,
            paid_balance_cny: 0.0,
            paid_real_remain_cny: 0.0,
            last_synced_vendor_remain: 5.0,
        };
        assert_eq!(reconcile_usage(Some(state), None, None), None);
        assert_eq!(reconcile_usage(None, Some(5.0), None), None);
    }

    #[test]
    fn pure_grant_usage_is_one_to_one_even_with_a_markup_configured() {
        let state = VisibleBalanceState {
            grant_limit_cny: 5.0,
            grant_balance_cny: 5.0,
            paid_limit_cny: 0.0,
            paid_balance_cny: 0.0,
            paid_real_remain_cny: 0.0,
            last_synced_vendor_remain: 5.0,
        };
        // ¥1.30 of real usage, entirely within the grant.
        let after = reconcile_usage(Some(state), None, Some(3.70)).unwrap();
        assert_eq!(after.grant_balance_cny, 3.70);
        assert_eq!(after.paid_balance_cny, 0.0);
        assert_eq!(after.paid_real_remain_cny, 0.0);
    }

    #[test]
    fn usage_that_exhausts_the_grant_spills_into_the_paid_pool_scaled_by_markup() {
        // ¥2 grant remaining, ¥10 paid (real ¥9.09 after 1.10x markup) —
        // granted_for_payment(1.10, 10.0) = 9.09.
        let paid_real = crate::topup::granted_for_payment(MARKUP, 10.0);
        assert_eq!(paid_real, 9.09);
        let state = VisibleBalanceState {
            grant_limit_cny: 5.0,
            grant_balance_cny: 2.0,
            paid_limit_cny: 10.0,
            paid_balance_cny: 10.0,
            paid_real_remain_cny: paid_real,
            last_synced_vendor_remain: 2.0 + paid_real, // 11.09
        };
        // ¥3 of real usage: ¥2 empties the grant, ¥1 comes out of paid-real.
        let after = reconcile_usage(Some(state), None, Some(11.09 - 3.0)).unwrap();
        assert_eq!(after.grant_balance_cny, 0.0);
        // 1.0 real spent from the paid pool * 1.10 markup = 1.10 visible.
        assert_eq!(after.paid_balance_cny, 8.90);
        assert_eq!(after.paid_real_remain_cny, 8.09);
    }

    #[test]
    fn a_credit_only_ever_touches_the_paid_pool() {
        let state = VisibleBalanceState {
            grant_limit_cny: 5.0,
            grant_balance_cny: 3.0,
            paid_limit_cny: 0.0,
            paid_balance_cny: 0.0,
            paid_real_remain_cny: 0.0,
            last_synced_vendor_remain: 3.0,
        };
        // User pays ¥1 at a 10% markup: only ~¥0.91 lands on the vendor's
        // real remain, but the visible paid balance grows by the full ¥1.
        let granted = crate::topup::granted_for_payment(MARKUP, 1.0);
        let after = apply_paid_credit(state, 1.0, granted, 3.0 + granted);
        assert_eq!(after.grant_limit_cny, 5.0);
        assert_eq!(after.grant_balance_cny, 3.0); // untouched
        assert_eq!(after.paid_limit_cny, 1.0);
        assert_eq!(after.paid_balance_cny, 1.0);
        assert_eq!(after.paid_real_remain_cny, granted);
    }

    #[test]
    fn an_ops_adjustment_is_face_value_on_both_sides_since_it_was_never_marked_up() {
        let state = VisibleBalanceState {
            grant_limit_cny: 5.0,
            grant_balance_cny: 5.0,
            paid_limit_cny: 0.0,
            paid_balance_cny: 0.0,
            paid_real_remain_cny: 0.0,
            last_synced_vendor_remain: 5.0,
        };
        // apply_top_up passes its delta straight through, unmarked-up on
        // both the visible and real sides — see service::apply_top_up.
        let after = apply_paid_credit(state, 10.0, 10.0, 15.0);
        assert_eq!(after.paid_limit_cny, 10.0);
        assert_eq!(after.paid_balance_cny, 10.0);
        assert_eq!(after.paid_real_remain_cny, 10.0);
    }

    /// The property the whole design leans on: a paid pool's visible
    /// balance and its real vendor remain reach zero at *exactly* the same
    /// moment, regardless of top-up size. Simulates spending the entire
    /// paid pool down to zero across several reconciles and checks both
    /// sides land on zero together.
    #[test]
    fn the_paid_pool_empties_in_lockstep_with_the_vendors_real_remain_no_matter_the_size() {
        for paid_amount in [1.0, 10.0, 1000.0] {
            let paid_real = crate::topup::granted_for_payment(MARKUP, paid_amount);
            let mut state = VisibleBalanceState {
                grant_limit_cny: 0.0,
                grant_balance_cny: 0.0, // no grant — isolates the paid pool
                paid_limit_cny: paid_amount,
                paid_balance_cny: paid_amount,
                paid_real_remain_cny: paid_real,
                last_synced_vendor_remain: paid_real,
            };
            // Spend it down in three uneven real-cost chunks.
            let mut vendor_remain = paid_real;
            for fraction in [0.2, 0.5, 1.0] {
                vendor_remain = round_cents(paid_real * (1.0 - fraction));
                state = reconcile_usage(Some(state), None, Some(vendor_remain)).unwrap();
            }
            assert_eq!(vendor_remain, 0.0, "test setup should reach real zero");
            assert_eq!(
                state.paid_balance_cny, 0.0,
                "visible paid balance should reach zero in the same step as the real remain, \
                 for a ¥{paid_amount} top-up"
            );
        }
    }

    #[test]
    fn init_visible_balance_never_marks_up_the_face_values() {
        let state = init_visible_balance(
            5.0,
            11.5,
            1.15,
            5.0 + crate::topup::granted_for_payment(1.15, 11.5),
        );
        assert_eq!(state.grant_limit_cny, 5.0);
        assert_eq!(state.grant_balance_cny, 5.0);
        assert_eq!(state.paid_limit_cny, 11.5);
        assert_eq!(state.paid_balance_cny, 11.5);
        assert_eq!(state.paid_real_remain_cny, 10.0); // granted_for_payment(1.15, 11.5)
    }

    /// The bug this pool-ratio design specifically guards against: an ops
    /// adjustment (`service::apply_top_up`) is never marked up, so if the
    /// paid pool's consumption were scaled by the *global* markup instead of
    /// its own current ratio, the ops-credited money would be quietly
    /// shorted on the way out. Mixing a real (marked-up) top-up with an
    /// ops-credited one in the same paid pool must still empty both sides
    /// in lockstep.
    #[test]
    fn an_ops_credit_mixed_into_the_paid_pool_still_empties_in_lockstep() {
        // ¥10 real top-up at 1.10x markup: real ¥9.09.
        let paid_real_from_payment = crate::topup::granted_for_payment(MARKUP, 10.0);
        let state = VisibleBalanceState {
            grant_limit_cny: 0.0,
            grant_balance_cny: 0.0,
            paid_limit_cny: 10.0,
            paid_balance_cny: 10.0,
            paid_real_remain_cny: paid_real_from_payment,
            last_synced_vendor_remain: paid_real_from_payment,
        };
        // Ops adjusts +¥5, unmarked-up on both sides.
        let mut vendor_remain = paid_real_from_payment + 5.0;
        let state = apply_paid_credit(state, 5.0, 5.0, vendor_remain);
        assert_eq!(state.paid_limit_cny, 15.0);
        assert_eq!(state.paid_balance_cny, 15.0);
        let paid_real_total = paid_real_from_payment + 5.0;
        assert_eq!(state.paid_real_remain_cny, paid_real_total);

        // Spend it all down in uneven chunks.
        let mut state = state;
        for fraction in [0.3, 0.7, 1.0] {
            vendor_remain = round_cents(paid_real_total * (1.0 - fraction));
            state = reconcile_usage(Some(state), None, Some(vendor_remain)).unwrap();
        }
        assert_eq!(vendor_remain, 0.0);
        assert_eq!(
            state.paid_balance_cny, 0.0,
            "the mixed pool (real top-up + unmarked-up ops credit) must still reach zero \
             in the same step as the vendor's real remain — not before (which would short \
             the ops-credited money) or after (which would leak a tail)"
        );
    }
}
