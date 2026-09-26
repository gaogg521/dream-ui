//! Payment gateways.
//!
//! Only [`MockGateway`] exists so far. It closes the
//! order -> pay -> credit loop end to end without a real merchant account, so
//! Phases 1-3 (broker, dream-core, dream-ui) can be built and demoed while the
//! Alipay / WeChat Pay merchant application is still pending (handoff doc
//! Phase 4). The real `AlipayGateway` / `WechatGateway` slot in behind the
//! same [`PaymentGateway`] trait with no change to orders or the ledger.

use async_trait::async_trait;
use axum::http::HeaderMap;
use serde::Deserialize;
use serde_json::json;

use super::{MeteredError, OrderView, PaymentGateway, PaymentIntent, WebhookOutcome};

/// A stand-in gateway. `precreate` hands back a fake pay URL; settlement is
/// driven by POSTing a signed body to the webhook route.
pub struct MockGateway {
    /// Shared secret the mock webhook body must carry. Keeps the settle path
    /// from being "anyone who knows an order id can credit it", so tests
    /// exercise a real verify step.
    shared_secret: String,
}

impl MockGateway {
    pub fn new(shared_secret: String) -> Self {
        Self { shared_secret }
    }

    pub fn from_env() -> Self {
        Self::new(
            std::env::var("MOCK_GATEWAY_SECRET").unwrap_or_else(|_| "mock-secret".to_string()),
        )
    }
}

#[derive(Debug, Deserialize)]
struct MockWebhookBody {
    order_id: String,
    #[serde(default = "default_true")]
    paid: bool,
    secret: String,
    #[serde(default)]
    gateway_txn_id: Option<String>,
}

fn default_true() -> bool {
    true
}

#[async_trait]
impl PaymentGateway for MockGateway {
    fn id(&self) -> &'static str {
        "mock"
    }

    async fn precreate(&self, order: OrderView<'_>) -> Result<PaymentIntent, MeteredError> {
        Ok(PaymentIntent {
            gateway_txn_id: format!("mock-txn-{}", order.id),
            payload: json!({
                "kind": "mock",
                "pay_url": format!("mock://pay/{}", order.id),
                "amount_cents": order.amount_cents,
                "hint": "settle by POSTing {order_id, paid, secret} to \
                         /v1/metered/orders/webhook/mock",
            }),
        })
    }

    async fn verify_webhook(
        &self,
        _headers: &HeaderMap,
        body: &[u8],
    ) -> Result<WebhookOutcome, MeteredError> {
        let parsed: MockWebhookBody = serde_json::from_slice(body)
            .map_err(|e| MeteredError::WebhookRejected(format!("malformed body: {e}")))?;

        if parsed.secret != self.shared_secret {
            return Err(MeteredError::WebhookRejected("bad secret".to_string()));
        }

        Ok(WebhookOutcome {
            order_id: parsed.order_id,
            paid: parsed.paid,
            gateway_txn_id: parsed.gateway_txn_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn webhook_needs_the_shared_secret() {
        let gw = MockGateway::new("s3cret".to_string());
        let headers = HeaderMap::new();

        let ok = gw
            .verify_webhook(
                &headers,
                br#"{"order_id":"o1","paid":true,"secret":"s3cret"}"#,
            )
            .await
            .expect("correct secret verifies");
        assert_eq!(ok.order_id, "o1");
        assert!(ok.paid);

        let bad = gw
            .verify_webhook(
                &headers,
                br#"{"order_id":"o1","paid":true,"secret":"wrong"}"#,
            )
            .await;
        assert!(matches!(bad, Err(MeteredError::WebhookRejected(_))));
    }

    #[tokio::test]
    async fn precreate_carries_the_order_id() {
        let gw = MockGateway::new("x".to_string());
        let intent = gw
            .precreate(OrderView {
                id: "ord-42",
                vendor: "baoyun",
                package_id: "59",
                amount_cents: 5_900,
            })
            .await
            .unwrap();
        assert_eq!(intent.gateway_txn_id, "mock-txn-ord-42");
        assert_eq!(intent.payload["amount_cents"], 5_900);
    }
}
