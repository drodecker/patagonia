# Patagonia trip itinerary site

Static two-pane viewer for the Feb 2027 Earth River Futaleufú multi-lodge trip **with Argentina exit** (Ben’s plan): Yelcho → Paso Futaleufú → Esquel (EQS) → Buenos Aires → Colonia day trip → home from EZE.

- **Left:** expandable line-item panels (mode, ER included?, times, costs, notes).
- **Right:** numbered map markers + route lines (Mapbox GL JS **or** Google Maps JS).
- **Data:** `itinerary.csv` and `itinerary.json` (same legs). Download CSV from the header.

Research / planning only — nothing booked.

## Domain

Intended host: **patagonia.rodecker.com**. This compose file only publishes the container on a host port (default `8080`). Terminate TLS and reverse-proxy that hostname to the container yourself (Caddy, Traefik, nginx, Cloudflare Tunnel, etc.).

## Quick local preview (no Docker)

```bash
cd site
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

Without API keys the list and CSV download work; the map shows a graceful fallback message.

## Docker

```bash
cd site
export MAP_PROVIDER=mapbox
export MAPBOX_TOKEN=pk.your_token_here
# OR:
# export MAP_PROVIDER=google
# export GOOGLE_MAPS_API_KEY=AIza...

docker compose up -d --build
# http://localhost:8080
```

Keys are injected at **container start** by `docker-entrypoint.sh` via `envsubst` into `config.js`. They are **not** committed in the repo.

| Env var | Purpose |
|---|---|
| `MAP_PROVIDER` | `mapbox` (default) or `google` |
| `MAPBOX_TOKEN` | Mapbox access token |
| `GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key |

## Data columns

`seq, date, day, start_time, end_time, from_name, from_code, from_lat, from_lng, to_name, to_code, to_lat, to_lng, mode, provider, earth_river_included, est_duration, distance_km, booking_status, cost_est_usd, confidence, notes, source`

Modes: `air` | `road-van` | `taxi` | `walk` | `ferry` | `charter` | `stay`

## Regenerating data

Edit / regenerate with the Python generator used to build this folder (or edit CSV and convert). Keep CSV and JSON in sync.

## Open questions (see notes on legs 17–21)

- Border pedestrian crossing vs vehicles-only listing
- Earth River ~$150 credit and remis arrangement in writing
- Luggage left with Maria in PMC when skipping return
- Home airport (LAX/MIA/…) and exact Feb 2027 Aerolíneas EQS–AEP flight number
