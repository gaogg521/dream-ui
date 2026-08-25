//! Thin client for OpenRouter's key-management API, abstracted behind a
//! trait so tests can mock it out without ever touching the network or the
//! real Management Key.
//!
//! Verified contract (openrouter.ai/docs):
//!
//! POST https://openrouter.ai/api/v1/keys
//! Header: Authorization: Bearer <MANAGEMENT_KEY>
//! Body: { "name": "...", "limit": 1, "limit_reset": "daily", "expires_at": "..." }
//! 201 response: { "data": { ..., "hash": "...", "label": "...", "limit": 1,
//!                  "limit_remaining": 1, "limit_reset": "daily", ... },
//!                 "key": "sk-or-v1-...." }
//!
//! The plaintext `key` is only ever present in this create response.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct CreateKeyRequest {
    pub name: String,
    pub limit: f64,
    pub limit_reset: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateKeyData {
    pub hash: String,
    pub label: Option<String>,
    pub limit: Option<f64>,
    pub limit_remaining: Option<f64>,
    pub limit_reset: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateKeyResponse {
    pub data: CreateKeyData,
    pub key: String,
}

#[derive(Debug, thiserror::Error)]
pub enum OpenRouterError {
    #[error("openrouter request failed: {0}")]
    Request(String),
    #[error("openrouter returned error status {status}: {body}")]
    Upstream { status: u16, body: String },
}

#[async_trait]
pub trait OpenRouterClient: Send + Sync {
    async fn create_key(
        &self,
        req: CreateKeyRequest,
    ) -> Result<CreateKeyResponse, OpenRouterError>;
}

pub struct RealOpenRouterClient {
    http: reqwest::Client,
    management_key: String,
    base_url: String,
}

impl RealOpenRouterClient {
    pub fn new(management_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            management_key,
            base_url: crate::config::OPENROUTER_BASE_URL.to_string(),
        }
    }
}

#[async_trait]
impl OpenRouterClient for RealOpenRouterClient {
    async fn create_key(
        &self,
        req: CreateKeyRequest,
    ) -> Result<CreateKeyResponse, OpenRouterError> {
        let url = format!("{}/keys", self.base_url);

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.management_key)
            .json(&req)
            .send()
            .await
            .map_err(|e| OpenRouterError::Request(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(OpenRouterError::Upstream {
                status: status.as_u16(),
                body,
            });
        }

        resp.json::<CreateKeyResponse>()
            .await
            .map_err(|e| OpenRouterError::Request(e.to_string()))
    }
}
