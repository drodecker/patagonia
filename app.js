/* Patagonia itinerary viewer — phase filters, hash deep-links, Mapbox/Google */
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
  const PHASE_FILTERS = new Set(["all", "pre", "earth-river", "post"]);
  const PHASE_LABEL = {
    all: "All",
    pre: "Getting there",
    "earth-river": "Earth River",
    post: "After Earth River",
  };

  const state = {
    legs: [],
    activeSeq: null,
    filter: "all",
    provider: null,
    mapReady: false,
    google: { map: null, markers: [], polylines: [], info: null },
    mapbox: { map: null, markers: [] },
  };

  function $(sel) { return document.querySelector(sel); }
  function cfg() { return window.PATAGONIA_CONFIG || {}; }

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

  function phaseBadge(phase) {
    const labels = { pre: "Pre", "earth-river": "ER trip", post: "Post" };
    return `<span class="badge phase-${phase || ""}">${labels[phase] || phase || ""}</span>`;
  }

  function filteredLegs() {
    if (state.filter === "all") return state.legs.slice();
    return state.legs.filter((l) => l.phase === state.filter);
  }

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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortName(n) {
    if (!n) return "";
    return n.length > 36 ? n.slice(0, 34) + "…" : n;
  }

  function shareUrl() {
    const u = new URL(window.location.href);
    if (state.activeSeq) u.hash = "leg-" + state.activeSeq;
    else u.hash = state.filter === "all" ? "all" : state.filter;
    return u.toString();
  }

  function setHashFromState(replace) {
    let hash;
    if (state.activeSeq) hash = "leg-" + state.activeSeq;
    else hash = state.filter === "all" ? "all" : state.filter;
    const next = "#" + hash;
    if (window.location.hash === next) return;
    if (replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
  }

  function parseHash() {
    const raw = (window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
    if (!raw || raw === "all") return { filter: "all", leg: null };
    if (PHASE_FILTERS.has(raw) && raw !== "all") return { filter: raw, leg: null };
    const m = raw.match(/^leg-(\d+)$/);
    if (m) {
      const seq = +m[1];
      const leg = state.legs.find((l) => l.seq === seq);
      return { filter: leg ? leg.phase : "all", leg: seq };
    }
    return { filter: "all", leg: null };
  }

  function applyHash(opts) {
    opts = opts || {};
    if (!state.legs.length) return;
    const parsed = parseHash();
    state.filter = parsed.filter;
    state.activeSeq = parsed.leg;
    syncChips();
    renderList();
    refreshMap();
    if (parsed.leg) {
      selectLeg(parsed.leg, { fromList: false, skipHash: true, scroll: opts.scroll !== false });
    }
  }

  function syncChips() {
    document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
      const on = chip.dataset.filter === state.filter;
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setFilter(filter, opts) {
    opts = opts || {};
    if (!PHASE_FILTERS.has(filter)) filter = "all";
    state.filter = filter;
    if (!opts.keepLeg) state.activeSeq = null;
    syncChips();
    renderList();
    refreshMap();
    if (!opts.skipHash) setHashFromState(!!opts.replace);
  }

  function renderList() {
    const host = $("#leg-list");
    const legs = filteredLegs();
    const label = PHASE_LABEL[state.filter] || state.filter;
    $("#status").textContent =
      `${legs.length} of ${state.legs.length} legs · ${label} · home airport TBD · research only`;

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
              <dt>Phase</dt><dd>${phaseBadge(leg.phase)} ${escapeHtml(PHASE_LABEL[leg.phase] || leg.phase || "")}</dd>
              <dt>Mode</dt><dd>${escapeHtml(leg.mode)} · ${escapeHtml(leg.provider || "")}</dd>
              <dt>Times</dt><dd>${escapeHtml(leg.start_time || "—")} → ${escapeHtml(leg.end_time || "—")}</dd>
              <dt>Distance</dt><dd>${leg.distance_km != null && leg.distance_km !== "" ? escapeHtml(String(leg.distance_km)) + " km" : "—"}</dd>
              <dt>Cost (est.)</dt><dd>${leg.cost_est_usd != null && leg.cost_est_usd !== "" ? "$" + escapeHtml(String(leg.cost_est_usd)) + " USD" : "—"} · ${escapeHtml(leg.confidence || "")}</dd>
              <dt>Booking</dt><dd>${escapeHtml(leg.booking_status || "")}</dd>
              <dt>From</dt><dd>${escapeHtml(leg.from_name)} (${escapeHtml(leg.from_code || "")})</dd>
              <dt>To</dt><dd>${escapeHtml(leg.to_name)} (${escapeHtml(leg.to_code || "")})</dd>
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

    if (state.activeSeq) {
      const el = document.getElementById("leg-" + state.activeSeq);
      if (el) {
        el.classList.add("active", "open");
        const sum = el.querySelector(".leg-summary");
        if (sum) sum.setAttribute("aria-expanded", "true");
      }
    }
  }

  function selectLeg(seq, opts) {
    opts = opts || {};
    const leg = state.legs.find((l) => l.seq === seq);
    if (!leg) return;
    // If leg is outside current filter, switch filter to its phase
    if (state.filter !== "all" && leg.phase !== state.filter) {
      state.filter = leg.phase;
      syncChips();
      renderList();
      refreshMap();
    }
    state.activeSeq = seq;
    document.querySelectorAll(".leg").forEach((el) => {
      const on = +el.dataset.seq === seq;
      el.classList.toggle("active", on);
      el.classList.toggle("open", on);
      const sum = el.querySelector(".leg-summary");
      if (sum) sum.setAttribute("aria-expanded", on ? "true" : "false");
    });
    const node = document.getElementById("leg-" + seq);
    if (node && opts.scroll !== false) {
      node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (!opts.skipHash) setHashFromState(false);
    focusMapOnLeg(seq);
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

  function clearMapboxOverlays() {
    const map = state.mapbox.map;
    if (!map) return;
    state.mapbox.markers.forEach((m) => m.remove());
    state.mapbox.markers = [];
    ["routes-solid", "routes-dashed", "routes-ferry"].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource("routes")) map.removeSource("routes");
  }

  function clearGoogleOverlays() {
    state.google.markers.forEach((m) => m.setMap(null));
    state.google.polylines.forEach((p) => p.setMap(null));
    state.google.markers = [];
    state.google.polylines = [];
    if (state.google.info) { state.google.info.close(); state.google.info = null; }
  }

  function fitPointsMapbox(points) {
    const map = state.mapbox.map;
    if (!map || !points.length) return;
    if (points.length === 1) {
      map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 8, essential: true });
      return;
    }
    const b = new mapboxgl.LngLatBounds();
    points.forEach((p) => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: 56, maxZoom: state.filter === "all" ? 5.5 : 8, duration: 700 });
  }

  function fitPointsGoogle(points) {
    const map = state.google.map;
    if (!map || !points.length) return;
    if (points.length === 1) {
      map.panTo({ lat: points[0].lat, lng: points[0].lng });
      map.setZoom(8);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 56);
  }

  function paintMapbox(legs) {
    const map = state.mapbox.map;
    if (!map || !map.isStyleLoaded()) return;
    clearMapboxOverlays();
    const points = buildPoints(legs);
    points.forEach((p) => {
      const el = document.createElement("div");
      el.className = "mb-marker";
      el.style.cssText = "width:26px;height:26px;border-radius:50%;background:#3d9cf0;color:#041018;font:700 11px/26px system-ui;text-align:center;border:2px solid #fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)";
      el.textContent = String(p.markerNum);
      el.title = p.name;
      el.addEventListener("click", () => selectLeg(p.seqs[0]));
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(
          `<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.code)} · legs ${p.seqs.join(", ")}`
        ))
        .addTo(map);
      state.mapbox.markers.push(marker);
    });

    const features = [];
    legs.forEach((leg) => {
      if (leg.mode === "stay") return;
      const style = lineStyle(leg.mode);
      if (!style) return;
      features.push({
        type: "Feature",
        properties: {
          seq: leg.seq,
          mode: leg.mode,
          color: style.color,
          dashed: !!style.dashed,
          ferry: !!style.ferry,
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
      paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.85 },
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
    fitPointsMapbox(points);
  }

  function paintGoogle(legs) {
    const map = state.google.map;
    if (!map) return;
    clearGoogleOverlays();
    const points = buildPoints(legs);
    points.forEach((p) => {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map,
        label: { text: String(p.markerNum), color: "#041018", fontWeight: "700" },
        title: p.name,
      });
      marker.addListener("click", () => selectLeg(p.seqs[0]));
      state.google.markers.push(marker);
    });
    legs.forEach((leg) => {
      if (leg.mode === "stay") return;
      const style = lineStyle(leg.mode);
      if (!style) return;
      const poly = new google.maps.Polyline({
        path: [
          { lat: +leg.from_lat, lng: +leg.from_lng },
          { lat: +leg.to_lat, lng: +leg.to_lng },
        ],
        geodesic: true,
        strokeColor: style.color,
        strokeOpacity: style.dashed || style.ferry || style.walk ? 0 : 0.9,
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
    fitPointsGoogle(points);
  }

  function refreshMap() {
    if (!state.mapReady) return;
    const legs = filteredLegs();
    if (state.provider === "mapbox") paintMapbox(legs);
    if (state.provider === "google") paintGoogle(legs);
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
      state.mapReady = true;
      refreshMap();
    });
  }

  function initGoogle() {
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
    state.mapReady = true;
    hideFallback();
    refreshMap();
  }

  window.__patagoniaInitGoogle = function () {
    const key = cfg().GOOGLE_MAPS_API_KEY;
    if (!key) {
      showFallback("GOOGLE_MAPS_API_KEY is empty. Set it in Docker env. List still works.");
      return;
    }
    waitFor(function () { return state.legs && state.legs.length; }, 10000).then(function (ok) {
      if (!ok) {
        showFallback("Itinerary data not ready for Google Maps. List may still load.");
        return;
      }
      initGoogle();
    });
  };

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
      if (window.google && google.maps) window.__patagoniaInitGoogle();
      else {
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
    if (!c.MAPBOX_TOKEN) {
      showFallback(
        "No map key configured. Set <code>MAPBOX_TOKEN</code> or switch <code>MAP_PROVIDER=google</code> with <code>GOOGLE_MAPS_API_KEY</code> in Docker. " +
        "The itinerary panels and <strong>Download CSV</strong> work without a map. Share filters via <code>#post</code> etc."
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

  async function loadData() {
    const res = await fetch("itinerary.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load itinerary.json");
    const data = await res.json();
    state.legs = data.legs || [];
    $("#title").textContent = data.title || "Patagonia Itinerary";
  }

  function wireFilters() {
    document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        setFilter(chip.dataset.filter);
      });
    });
    window.addEventListener("hashchange", () => applyHash({ scroll: true }));
    window.addEventListener("popstate", () => applyHash({ scroll: true }));

    const copyBtn = $("#copy-link");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const url = shareUrl();
        try {
          await navigator.clipboard.writeText(url);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1600);
        } catch (e) {
          window.prompt("Copy this link:", url);
        }
      });
    }
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
    // Initial hash (default #all if empty so share links stay consistent)
    if (!window.location.hash) {
      history.replaceState(null, "", "#all");
    }
    applyHash({ scroll: true });
    startMap();
  }

  document.addEventListener("DOMContentLoaded", main);
})();
