# Grafana Dashboard Setup

This guide explains how to set up Grafana dashboards for each Hypixel guild bridge, using Prometheus metrics from the bridge app.

## Overview

- **Prometheus** scrapes `/metrics` from your bridge app (Heroku or local).
- **Grafana** queries Prometheus and displays dashboards.
- The included dashboard has a **Bridge** dropdown to filter metrics per guild/bridge.

## Option 1: Grafana Cloud (free)

[Grafana Cloud](https://grafana.com/products/cloud/) free tier includes Prometheus-compatible storage. Use **Grafana Agent** to scrape your bridge and send metrics to Grafana Cloud.

### 1. Create a Grafana Cloud account

1. Go to [grafana.com/products/cloud](https://grafana.com/products/cloud/).
2. Sign up for the free tier.
3. Create a stack and note your:
   - Grafana URL (e.g. `https://xxx.grafana.net`)
   - Prometheus remote write URL (Settings → Details → Metrics → Remote write endpoint)
   - User (usually your stack ID)
   - API token / password for remote write

### 2. Run Grafana Agent

Grafana Agent scrapes your bridge `/metrics` and forwards to Grafana Cloud.

**Using Docker:**

```bash
# Create a config file (replace placeholders)
cat > agent.yaml << 'EOF'
server:
  log_level: info

metrics:
  global:
    scrape_interval: 15s
  configs:
  - name: bridge
    scrape_configs:
      - job_name: hypixel-bridge
        metrics_path: /metrics
        scheme: https
        static_configs:
          - targets: ['YOUR_HEROKU_APP.herokuapp.com']
    remote_write:
      - url: YOUR_GRAFANA_CLOUD_REMOTE_WRITE_URL
        basic_auth:
          username: YOUR_STACK_ID
          password: YOUR_API_TOKEN
EOF

# Run the agent (replace with your actual config values)
docker run -d --name grafana-agent \
  -v $(pwd)/agent.yaml:/etc/agent/agent.yaml \
  grafana/agent:v0.40.0 \
  --config.file=/etc/agent/agent.yaml
```

**Using your VM:**

You can run the agent on the same VM you use for other services. Download from [Grafana Agent releases](https://github.com/grafana/agent/releases) and configure similarly.

### 3. Add Prometheus data source in Grafana Cloud

1. Go to Connections → Data sources → Add data source.
2. Select **Prometheus**.
3. Set URL to your Grafana Cloud Prometheus endpoint (e.g. `https://prometheus-prod-xxx.grafana.net/api/prom`).
4. Add authentication (API key or basic auth) as shown in your stack settings.
5. Save and test.

### 4. Import the dashboard

1. Go to Dashboards → New → Import.
2. Upload `grafana/dashboards/hypixel-bridge-overview.json` from this repo, or paste its contents.
3. Select your Prometheus data source.
4. Click Import.

Use the **Bridge** dropdown to filter metrics by guild. Choose "All" to see every bridge.

---

## Option 2: Self-hosted Prometheus + Grafana

If you run Prometheus and Grafana yourself (Docker, VPS, etc.):

### 1. Configure Prometheus to scrape the bridge

Copy `grafana/prometheus.yml` and replace `YOUR_HEROKU_APP.herokuapp.com` with your bridge URL (Heroku app URL or `localhost:PORT` for local).

Add this file to your Prometheus config, or merge the `scrape_configs` into your existing `prometheus.yml`.

### 2. Add Prometheus as a data source in Grafana

1. In Grafana, go to Connections → Data sources → Add data source.
2. Select **Prometheus**.
3. Set URL to your Prometheus server (e.g. `http://localhost:9090`).
4. Save and test.

### 3. Import the dashboard

1. Dashboards → New → Import.
2. Upload or paste `grafana/dashboards/hypixel-bridge-overview.json`.
3. Select your Prometheus data source.
4. Import.

---

## Option 3: Docker Compose (local stack)

Run Prometheus + Grafana locally with Docker:

```yaml
# docker-compose.grafana.yml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./grafana/prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - ./grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards
```

1. Edit `grafana/prometheus.yml` and set your bridge URL (e.g. your Heroku app).
2. Run: `docker compose -f docker-compose.grafana.yml up -d`
3. Open http://localhost:3000, log in (admin/admin), add Prometheus at `http://prometheus:9090` as a data source.
4. The "Hypixel Guild Bridge - Per Bridge" dashboard appears under Dashboards → Hypixel Bridge.

---

## Metric prefix

The default Prometheus prefix is `hypixel_bridge_` (see `config.yaml` → `prometheus.prefix`). If you changed it, update the queries in the dashboard:

- `hypixel_bridge_guild_members` → `YOUR_PREFIXguild_members`
- `hypixel_bridge_guild_members_online` → `YOUR_PREFIXguild_members_online`
- `hypixel_bridge_chat` → `YOUR_PREFIXchat`
- `hypixel_bridge_command` → `YOUR_PREFIXcommand`
- `hypixel_bridge_event` → `YOUR_PREFIXevent`

---

## Panels by bridge

The dashboard includes:

| Panel | Description |
|-------|-------------|
| Guild members (total) | Total members per guild |
| Guild members (online) | Current online members |
| Chat messages (24h) | Chat volume in the last 24 hours |
| Commands (24h) | Command usage in the last 24 hours |
| Online members over time | Time series of online count |
| Chat rate by bridge & scope | Chat by channel type (public, officer, etc.) |
| Command usage by bridge & command | Commands used per bridge |
| Events by bridge & type | Join, leave, mute, etc. |

Select one or more bridges from the dropdown to focus on specific guilds.
