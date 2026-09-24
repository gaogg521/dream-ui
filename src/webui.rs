//! The "paste your key, see your usage" page itself — a single
//! self-contained static HTML file, served same-origin with the API it
//! calls (`POST v1/keys/usage`, relative to this page's own path) so it
//! needs no CORS layer and no separate hosting. Requested by the user
//! directly after the equivalent in-app modal (`dream-ui`'s
//! `KeyUsageQueryModal`) proved fragile to drive/verify inside Electron —
//! a plain page is both simpler and independently linkable/shareable, the
//! same shape as the reference site (token.gpt-agent.cc) that motivated the
//! feature.

use axum::response::Html;

const USAGE_PAGE: &str = include_str!("../webui/usage.html");

pub async fn usage_page() -> Html<&'static str> {
    Html(USAGE_PAGE)
}

#[cfg(test)]
mod tests {
    use super::USAGE_PAGE;

    /// The page's own JS hardcodes `vendor: 'baoyun'` (the only vendor
    /// `isToppableVendor`/`TOPUP_CAPABLE_VENDORS` names on the dream-ui side)
    /// and fetches a path *relative* to its own URL, not an absolute
    /// `/v1/...` one — this page is served under nginx's `/trial-broker/`
    /// prefix (see `docs/baoyun-metered-proxy-handoff.zh-CN.md`), and an
    /// absolute path would skip that prefix and 404. Both are easy to get
    /// wrong silently since nothing else exercises this file; assert them
    /// directly rather than relying on someone noticing in production.
    #[test]
    fn hardcodes_the_baoyun_vendor_and_a_relative_fetch_path() {
        assert!(USAGE_PAGE.contains("vendor: VENDOR"));
        assert!(USAGE_PAGE.contains("var VENDOR = 'baoyun';"));
        assert!(USAGE_PAGE.contains("fetch('v1/keys/usage'"));
        assert!(!USAGE_PAGE.contains("fetch('/v1/keys/usage'"));
    }

    /// The desktop app hands the key over in the URL *fragment* so it never
    /// reaches the server, and the page must then wipe it so it does not sit
    /// in the address bar or this history entry — the whole reason a
    /// fragment was chosen over a query string. Both halves are easy to drop
    /// in a redesign of this file, and nothing else would notice.
    #[test]
    fn the_key_handoff_reads_the_fragment_and_clears_it() {
        assert!(USAGE_PAGE.contains("window.location.hash"));
        assert!(USAGE_PAGE.contains("history.replaceState"));
        // Opening the page a second time only swaps the fragment on the tab
        // already open — without this the repeat click does nothing at all.
        assert!(USAGE_PAGE.contains("addEventListener('hashchange'"));
        // A query-string handoff would be logged by nginx and the broker.
        assert!(!USAGE_PAGE.contains("location.search).get('key')"));
    }
}
