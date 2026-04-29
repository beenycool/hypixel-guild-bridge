# Grafana Cloud + Heroku (Free, No Card)

Use **Grafana Cloud** (free tier, no credit card) to scrape metrics from your Heroku bridge app. Everything uses only your GitHub Student Heroku credits + Grafana's free tier.

## 1. Sign up for Grafana Cloud

1. Go to [grafana.com/products/cloud](https://grafana.com/products/cloud/)
2. Click **Start for free**
3. Sign up (no credit card required)
4. Create a stack and finish setup

## 2. Add a scrape job (Metrics Endpoint)

1. In Grafana Cloud, open **Connections** (left menu)
2. Search for **Metrics Endpoint** and open it
3. Click **Create scrape job**
4. Fill in:

   | Field          | Value                                             |
   | -------------- | ------------------------------------------------- |
   | Job name       | `hypixel-bridge`                                  |
   | URL            | `https://YOUR_HEROKU_APP.herokuapp.com/metrics`   |
   | Authentication | Bearer token                                      |
   | Token          | (same value as `GRAFANA_METRICS_TOKEN` on Heroku) |

5. Click **Test connection**, then **Save**
6. Click **Install** to add any Grafana Cloud dashboards

## 3. Set the token on Heroku

Generate a secret token and set it on Heroku and in Grafana Cloud:

```bash
# Generate a random token (run locally)
TOKEN=$(openssl rand -hex 32)
echo "Use this token in both steps below: $TOKEN"

# Set on Heroku
heroku config:set GRAFANA_METRICS_TOKEN="$TOKEN" --app YOUR_HEROKU_APP
```

Then paste the **same token** into the Grafana Cloud scrape job (Bearer token field).

## 4. Import the bridge dashboards

1. In Grafana Cloud, go **Dashboards** → **New** → **Import**
2. Upload or paste one JSON at a time from this repo. When Grafana asks for **Prometheus**, choose the variable **`DS_PROMETHEUS`** (or the prompt label **Prometheus**) and map it to your stack’s **Grafana Cloud Prometheus** / Managed Prometheus data source. The JSON files do **not** embed a stack-specific datasource UID, so imports stay portable.
3. Suggested imports:
   - `grafana/dashboards/hypixel-bridge-overview.json` — fleet-style overview
   - `grafana/dashboards/master-overview.json` — all bridges master stats
   - `grafana/dashboards/guild-template.json` — **master guild dashboard** (per-bridge management)

**Guild master dashboard variables**

- **Prometheus** (`DS_PROMETHEUS`) — your metrics data source (same as above).
- **Guild** — `label_values(hypixel_bridge_guild_members, name)`; use **All** or one Minecraft instance name.
- **Discord server** — `label_values(hypixel_bridge_discord_role_members, guild_id)`; filters the **Discord Role Sizes** table when the bot is in multiple Discord guilds.

4. Click **Import** after each file.

Use the **Guild** dropdown on the master guild dashboard to filter by Minecraft instance name, or choose **All**.

## 5. Data source in Grafana Cloud

Grafana Cloud automatically provides a Prometheus data source. Metrics scraped by the Metrics Endpoint go into your stack’s Prometheus instance. On import, map **`DS_PROMETHEUS`** to that data source so every panel resolves correctly.

## 6. Optional: alert rules (unified alerting)

Add a **Contact point** (for example Discord → Incoming Webhook URL), then create alert rules in **Alerting → Alert rules → New alert rule**:

1. **Bot disconnected** — condition for at least 5 minutes: `up{job="hypixel-bridge"} == 0` (use your real scrape **job** label if it differs). Annotation example: “The bridge metrics target is down.”
2. **Guild bleeding members (48h)** — expression:  
   `sum(increase(hypixel_bridge_event{event=~"leave|kick"}[48h])) > sum(increase(hypixel_bridge_event{event="join"}[48h]))`  
   For a **single** guild, add `instance="YOUR_INSTANCE"` (or `name=` on guild counters) to each range vector. Annotation: “More leaves/kicks than joins in the last 48 hours.”
3. **Pending rankups** — condition: `max(hypixel_bridge_guild_pending_rankup_reviews) > 5` (or filter with `{name="YOUR_INSTANCE"}`). Annotation: “Several rankup reviews are pending; use `/rankup-pending` in Discord.”

Wire each rule to your Discord contact point under **Notifications**.

---

## Summary

- **Heroku**: no extra dynos, only `GRAFANA_METRICS_TOKEN`
- **Grafana Cloud**: free tier, no credit card
- **Cost**: $0 (Heroku from credits, Grafana Cloud free)
