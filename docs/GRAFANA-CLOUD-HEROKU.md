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

## 4. Import the bridge dashboard

1. In Grafana Cloud, go to **Dashboards** → **New** → **Import**
2. Upload or paste the contents of `grafana/dashboards/hypixel-bridge-overview.json` from this repo
3. Optionally import `grafana/dashboards/hypixel-bridge-guild-detail.json` for per-guild drilldowns
4. Select your **Grafana Cloud Prometheus** data source
5. Click **Import**

Use the **Bridge** dropdown to filter by guild, or choose **All**.

## 5. Data source in Grafana Cloud

Grafana Cloud automatically provides a Prometheus data source. Metrics scraped by the Metrics Endpoint go into your stack’s Prometheus instance. When importing the dashboard, pick that Prometheus data source.

---

## Summary

- **Heroku**: no extra dynos, only `GRAFANA_METRICS_TOKEN`
- **Grafana Cloud**: free tier, no credit card
- **Cost**: $0 (Heroku from credits, Grafana Cloud free)
