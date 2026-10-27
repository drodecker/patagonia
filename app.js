/* Patagonia itinerary viewer — Mapbox GL or Google Maps via MAP_PROVIDER */
(function () {
  const MODE_ICON = {
    air: "✈️",
    "road-van": "🚐",
    taxi: "🚕",
    walk: "🚶",
    ferry: "⛴️",
    charter: "🛩️",
    stay: "🛏️",
  };
  const MODE_COLOR = {
    air: "#5dade2",
    "road-van": "#58d68d",
    taxi: "#48c9b0",
    walk: "#f5b041",
    ferry: "#a569bd",
    charter: "#ec7063",
    stay: "#85929e",
  };

  const state = {
    legs: [],
    activeSeq: null,
    filter: "all",
    map: null,
    provider: null,
    markers: new Map(),
    lines: [],
    google: { map: null, markers: [], polylines: [], info: null },
    mapbox: { map: null, markers: [] },
  };

  function $(sel) { return document.querySelector(sel); }
  function cfg() { return window.PATAGONIA_CONFIG || {}; }

  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${m}/${d}`;
  }

  function erBadge(v) {
    const k = (v || "no").toLowerCase();
    const label = k === "yes" ? "ER included" : k === "partial" ? "ER partial" : "On your own";
    return `<span class="badge ${k}">${label}</span>`;
  }

  function isMovement(leg) {
    return leg.mode !== "stay" || leg.from_code !== leg.to_code ||
      (leg.from_lat !== leg.to_lat || leg.from_lng !== leg.to_lng);
  }

  /** Unique map points in sequence order for markers */
  function buildPoints(legs) {
    const pts = [];
    const seen = new Map();
    function add(name, code, lat, lng, seq) {
      if (lat == null || lng == null || Number.isNaN(+lat)) return;
      const key = `${(+lat).toFixed(4)},${(+lng).toFixed(4)}`;
      if (seen.has(key)) {
        seen.get(key).seqs.push(seq);
        return;
      }
      const p = { name, code, lat: +lat, lng: +lng, seqs: [seq], markerNum: pts.length + 1 };
      seen.set(key, p);
      pts.push(p);
    }
    for (const leg of legs) {
      add(leg.from_name, leg.from_code, leg.from_lat, leg.from_lng, leg.seq);
      if (leg.mode !== "stay") {
        add(leg.to_name, leg.to_code, leg.to_lat, leg.to_lng, leg.seq);
      }
    }
    return pts;
  }

  function renderList() {
    const host = $("#leg-list");
    const filter = state.filter;
    const legs = state.legs.filter((l) => {
      if (filter === "all") return true;
      if (filter === "er") return l.earth_river_included === "yes" || l.earth_river_included === "partial";
      if (filter === "own") return l.earth_river_included === "no";
      if (filter === "move") return l.mode !== "stay";
      return true;
    });

    $("#status").textContent = `${legs.length} of ${state.legs.length} legs · home airport TBD (LAX/MIA options) · research only`;

    host.innerHTML = legs.map((leg) => {
      const icon = MODE_ICON[leg.mode] || "•";
      const same = leg.from_code === leg.to_code && leg.mode === "stay";
      const route = same
        ? escapeHtml(leg.from_name)
        : `${escapeHtml(shortName(leg.from_name))} → ${escapeHtml(shortName(leg.to_name))}`;
      const codes = same
        ? escapeHtml(leg.from_code || "")
        : `${escapeHtml(leg.from_code || "")} → ${escapeHtml(leg.to_code || "")}`;
      return `
        <article class="leg" data-seq="${leg.seq}" id="leg-${leg.seq}">
          <div class="leg-summary" role="button" tabindex="0" aria-expanded="false">
            <div class="seq">${leg.seq}</div>
            <div class="date">${fmtDate(leg.date)}<br>${escapeHtml(leg.day || "")}</div>
            <div class="mode-icon" title="${escapeHtml(leg.mode)}">${icon}</div>
            <div class="route">${route}<span class="codes">${codes}</span></div>
            <div class="meta-right">
              ${erBadge(leg.earth_river_included)}
              <span>${escapeHtml(leg.est_duration || "")}</span>
            </div>
          </div>
          <div class="leg-details">
            <dl>
              <dt>Mode</dt><dd>${escapeHtml(leg.mode)} · ${escapeHtml(leg.provider || "")}</dd>
              <dt>Times</dt><dd>${escapeHtml(leg.start_time || "—")} → ${escapeHtml(leg.end_time || "—")}</dd>
              <dt>Distance</dt><dd>${leg.distance_km != null && leg.distance_km !== "" ? escapeHtml(String(leg.distance_km)) + " km" : "—"}</dd>
              <dt>Cost (est.)</dt><dd>${leg.cost_est_usd != null && leg.cost_est_usd !== "" ? "$" + escapeHtml(String(leg.cost_est_usd)) + " USD" : "—"} · ${escapeHtml(leg.confidence || "")}</dd>
              <dt>Booking</dt><dd>${escapeHtml(leg.booking_status || "")}</dd>
              <dt>From</dt><dd>${escapeHtml(leg.from_name)} (${escapeHtml(leg.from_code || "")}) · ${leg.from_lat}, ${leg.from_lng}</dd>
              <dt>To</dt><dd>${escapeHtml(leg.to_name)} (${escapeHtml(leg.to_code || "")}) · ${leg.to_lat}, ${leg.to_lng}</dd>
            </dl>
            <div class="notes">${escapeHtml(leg.notes || "")}</div>
            <div class="source">Source: ${escapeHtml(leg.source || "")}</div>
          </div>
        </article>`;
    }).join("");

    host.querySelectorAll(".leg-summary").forEach((el) => {
      const activate = () => {
        const seq = +el.closest(".leg").dataset.seq;
        selectLeg(seq, { fromList: true });
      };
      el.addEventListener("click", activate);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      });
    });
  }

  function shortName(n) {
    if (!n) return "";
    return n.length > 36 ? n.slice(0, 34) + "…" : n;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function selectLeg(seq, opts = {}) {
    state.activeSeq = seq;
    document.querySelectorAll(".leg").forEach((el) => {
      const on = +el.dataset.seq === seq;
      el.classList.toggle("active", on);
      el.classList.toggle("open", on);
      const sum = el.querySelector(".leg-summary");
      if (sum) sum.setAttribute("aria-expanded", on ? "true" : "false");
    });
    const node = document.getElementById(`leg-${seq}`);
    if (node && opts.fromList !== false) {
      node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    focusMapOnLeg(seq);
  }

  function focusMapOnLeg(seq) {
    const leg = state.legs.find((l) => l.seq === seq);
    if (!leg || !state.provider) return;
    const pts = [
      [+leg.from_lng, +leg.from_lat],
      [+leg.to_lng, +leg.to_lat],
    ].filter((p) => !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
    if (!pts.length) return;

    if (state.provider === "mapbox" && state.mapbox.map) {
      const map = state.mapbox.map;
      if (pts.length === 1 || (pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) {
        map.flyTo({ center: pts[0], zoom: 11, essential: true });
      } else {
        const b = new mapboxgl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => b.extend(p));
        map.fitBounds(b, { padding: 80, maxZoom: 12, duration: 800 });
      }
      // pulse marker styles via popup
      const mid = pts.length > 1
        ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
        : pts[0];
      new mapboxgl.Popup({ offset: 18, closeButton: true })
        .setLngLat(mid)
        .setHTML(`<strong>#${leg.seq}</strong> ${escapeHtml(leg.mode)}<br>${escapeHtml(shortName(leg.from_name))} → ${escapeHtml(shortName(leg.to_name))}`)
        .addTo(map);
    }

    if (state.provider === "google" && state.google.map) {
      const map = state.google.map;
      const bounds = new google.maps.LatLngBounds();
      pts.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      if (pts.length === 1 || (pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) {
        map.panTo({ lat: pts[0][1], lng: pts[0][0] });
        map.setZoom(11);
      } else {
        map.fitBounds(bounds, 80);
      }
      if (state.google.info) state.google.info.close();
      state.google.info = new google.maps.InfoWindow({
        content: `<strong>#${leg.seq}</strong> ${escapeHtml(leg.mode)}<br>${escapeHtml(shortName(leg.from_name))} → ${escapeHtml(shortName(leg.to_name))}`,
        position: { lat: pts[0][1], lng: pts[0][0] },
      });
      state.google.info.open(map);
    }
  }

  function lineStyle(mode) {
    const color = MODE_COLOR[mode] || "#8899aa";
    if (mode === "air" || mode === "charter") return { color, dashed: true, width: 2.5 };
    if (mode === "ferry") return { color, dashed: false, width: 3, ferry: true };
    if (mode === "walk") return { color, dashed: true, width: 3, walk: true };
    if (mode === "stay") return null;
    return { color, dashed: false, width: 3 };
  }

  function showFallback(msg) {
    const el = $("#map-fallback");
    el.classList.add("visible");
    el.querySelector(".msg").innerHTML = msg;
    state.provider = null;
  }

  function hideFallback() {
    $("#map-fallback").classList.remove("visible");
  }

  function initMapbox(token) {
    if (!window.mapboxgl) {
      showFallback("Mapbox GL JS failed to load. The itinerary list still works.");
      return;
    }
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-71.5, -42.5],
      zoom: 4,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    state.mapbox.map = map;
    state.provider = "mapbox";
    hideFallback();

    map.on("load", () => {
      const points = buildPoints(state.legs);
      points.forEach((p) => {
        const el = document.createElement("div");
        el.className = "mb-marker";
        el.style.cssText = "width:26px;height:26px;border-radius:50%;background:#3d9cf0;color:#041018;font:700 11px/26px system-ui;text-align:center;border:2px solid #fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)";
        el.textContent = String(p.markerNum);
        el.title = p.name;
        el.addEventListener("click", () => selectLeg(p.seqs[0]));
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.code)} · legs ${p.seqs.join(", ")}`))
          .addTo(map);
        state.mapbox.markers.push(marker);
      });

      const features = [];
      state.legs.forEach((leg) => {
        if (leg.mode === "stay") return;
        const style = lineStyle(leg.mode);
        if (!style) return;
        features.push({
          type: "Feature",
          properties: {
            seq: leg.seq,
            mode: leg.mode,
            color: style.color,
            dashed: style.dashed,
            ferry: !!style.ferry,
            walk: !!style.walk,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [+leg.from_lng, +leg.from_lat],
              [+leg.to_lng, +leg.to_lat],
            ],
          },
        });
      });

      map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features } });
      map.addLayer({
        id: "routes-solid",
        type: "line",
        source: "routes",
        filter: ["all", ["!=", ["get", "dashed"], true], ["!=", ["get", "ferry"], true]],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "routes-dashed",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "dashed"], true],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "routes-ferry",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "ferry"], true],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-dasharray": [1, 1.5],
          "line-opacity": 0.9,
        },
      });

      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((p) => bounds.extend([p.lng, p.lat]));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 6 });
    });
  }

  function initGoogle(key) {
    // Google Maps JS is loaded via callback when script tag present
    if (!window.google || !google.maps) {
      showFallback("Google Maps JS failed to load. The itinerary list still works.");
      return;
    }
    const map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: -42.5, lng: -71.5 },
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      styles: [
        { elementType: "geometry", stylers: [{ color: "#1d2c3d" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#1d2c3d" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#8a9bb0" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1621" }] },
      ],
    });
    state.google.map = map;
    state.provider = "google";
    hideFallback();

    const points = buildPoints(state.legs);
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map,
        label: { text: String(p.markerNum), color: "#041018", fontWeight: "700" },
        title: p.name,
      });
      marker.addListener("click", () => selectLeg(p.seqs[0]));
      state.google.markers.push(marker);
      bounds.extend(marker.getPosition());
    });

    state.legs.forEach((leg) => {
      if (leg.mode === "stay") return;
      const style = lineStyle(leg.mode);
      if (!style) return;
      const path = [
        { lat: +leg.from_lat, lng: +leg.from_lng },
        { lat: +leg.to_lat, lng: +leg.to_lng },
      ];
      const poly = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: style.color,
        strokeOpacity: style.dashed ? 0 : 0.9,
        strokeWeight: style.width || 3,
        map,
        icons: style.dashed || style.ferry || style.walk
          ? [{
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 0.9,
                scale: 3,
                strokeColor: style.color,
              },
              offset: "0",
              repeat: style.ferry ? "10px" : "14px",
            }]
          : undefined,
      });
      poly.addListener("click", () => selectLeg(leg.seq));
      state.google.polylines.push(poly);
    });

    if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
  }

  // Expose Google callback
  window.__patagoniaInitGoogle = function () {
    const key = cfg().GOOGLE_MAPS_API_KEY;
    if (!key) {
      showFallback("GOOGLE_MAPS_API_KEY is empty. Set it in Docker env. List still works.");
      return;
    }
    const go = function () { initGoogle(key); };
    if (state.legs && state.legs.length) go();
    else waitFor(function () { return state.legs && state.legs.length; }, 10000).then(function (ok) {
      if (ok) go();
      else showFallback("Itinerary data not ready for Google Maps. List may still load.");
    });
  };

  async function loadData() {
    const res = await fetch("itinerary.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load itinerary.json");
    const data = await res.json();
    state.legs = data.legs || [];
    $("#title").textContent = data.title || "Patagonia Itinerary";
    renderList();
  }

  function wireFilters() {
    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
        chip.classList.add("on");
        state.filter = chip.dataset.filter;
        renderList();
        if (state.activeSeq) {
          const still = state.legs.find((l) => l.seq === state.activeSeq);
          // re-open if visible
          const el = document.getElementById(`leg-${state.activeSeq}`);
          if (el) selectLeg(state.activeSeq, { fromList: false });
        }
      });
    });
  }

  function startMap() {
    const c = cfg();
    const provider = (c.MAP_PROVIDER || "mapbox").toLowerCase();
    if (provider === "google") {
      if (!c.GOOGLE_MAPS_API_KEY) {
        showFallback(
          "MAP_PROVIDER=google but <code>GOOGLE_MAPS_API_KEY</code> is not set. " +
          "Pass it via Docker Compose env. The numbered list on the left still works; Download CSV too."
        );
        return;
      }
      // Script tag should already be injecting with callback=__patagoniaInitGoogle
      // If google already present (cached), init now
      if (window.google && google.maps) window.__patagoniaInitGoogle();
      else {
        // wait briefly; if script missing, show fallback
        setTimeout(() => {
          if (!state.provider) {
            showFallback(
              "Waiting for Google Maps… If this persists, check the API key and that Maps JavaScript API is enabled. List still works."
            );
          }
        }, 4000);
      }
      return;
    }

    // mapbox default
    if (!c.MAPBOX_TOKEN) {
      showFallback(
        "No map key configured. Set <code>MAPBOX_TOKEN</code> or switch <code>MAP_PROVIDER=google</code> with <code>GOOGLE_MAPS_API_KEY</code> in Docker. " +
        "The itinerary panels and <strong>Download CSV</strong> work without a map."
      );
      return;
    }
    waitFor(function () { return window.mapboxgl; }, 8000).then(function (ok) {
      if (!ok) {
        showFallback("Mapbox GL JS did not load in time (network/CSP). List still works.");
        return;
      }
      initMapbox(c.MAPBOX_TOKEN);
    });
  }

  function waitFor(pred, timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        if (pred()) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 50);
      })();
    });
  }

  async function main() {
    wireFilters();
    try {
      await loadData();
    } catch (e) {
      $("#status").textContent = "Could not load itinerary.json: " + e.message;
      showFallback("Itinerary data failed to load. Check that itinerary.json is served next to index.html.");
      return;
    }
    startMap();
  }

  document.addEventListener("DOMContentLoaded", main);
})();
