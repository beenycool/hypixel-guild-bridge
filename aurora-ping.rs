use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AuroraPingEntry {
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    pub day: String,
}

#[derive(Debug, Deserialize)]
struct AuroraPingResponse {
    success: bool,
    data: Option<Vec<AuroraPingEntry>>,
}

const AURORA_PING_BASE_URL: &str = "https://bordic.xyz/api/v2/resources/ping";

pub async fn fetch_aurora_ping(uuid: &str, api_key: &str) -> Option<AuroraPingEntry> {
    let url = format!(
        "{}?key={}&uuid={}",
        AURORA_PING_BASE_URL,
        urlencoding::encode(api_key),
        urlencoding::encode(uuid)
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "Hypixel-Guild-Discord-Bridge-Ping/1.0.0")
        .send()
        .await
        .ok()?
        .json::<AuroraPingResponse>()
        .await
        .ok()?;

    if !resp.success {
        return None;
    }

    resp.data?.into_iter().next()
}
