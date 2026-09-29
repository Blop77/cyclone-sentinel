/*
 * CycloneSentinel — external data feeds (browser).
 *   · NASA GIBS: VIIRS true-colour and GPM IMERG precipitation tiles/snapshots (no key, CORS-enabled)
 *   · Open-Meteo: real-time 72 h forecast for every town in one request (no key, CC BY 4.0)
 *   · Optional Google Earth Engine exposure layer produced by gee/exposure_pipeline.py
 */
(function (root) {
  "use strict";

  const GIBS = "https://gibs.earthdata.nasa.gov";
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  const halfHour = (d) => {
    const t = new Date(d);
    t.setUTCMinutes(t.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    return t.toISOString().replace(".000Z", "Z");
  };

  /** Leaflet tile layers for a given date (landfall date for replays, yesterday for live). */
  function satelliteLayers(L, when) {
    return {
      trueColor: L.tileLayer(`${GIBS}/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${day(when)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, {
        maxNativeZoom: 9, maxZoom: 12, opacity: 0.9,
        attribution: 'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> VIIRS',
      }),
      imerg: L.tileLayer(`${GIBS}/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/${halfHour(when)}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, {
        maxNativeZoom: 6, maxZoom: 12, opacity: 0.75,
        attribution: 'Rain: NASA GPM IMERG via GIBS',
      }),
    };
  }

  /** Single satellite image (JPEG, base64) for Gemini's multimodal analysis. */
  async function satelliteSnapshot({ lat, lon, when, halfSpan = 4, size = 768 }) {
    const bbox = [lat - halfSpan, lon - halfSpan, lat + halfSpan, lon + halfSpan].map((v) => v.toFixed(3)).join(",");
    const url = `${GIBS}/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/jpeg&TIME=${day(when)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GIBS snapshot HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { base64: btoa(bin), mime: "image/jpeg", url, bbox: { s: lat - halfSpan, w: lon - halfSpan, n: lat + halfSpan, e: lon + halfSpan }, date: day(when) };
  }

  /**
   * Real-time weather for all towns (Open-Meteo, one request).
   * Returns { [town]: { windMax, gustMax, rain72, galeHours, daily } }.
   */
  async function liveWeather(towns) {
    const lat = towns.map((t) => t.lat.toFixed(3)).join(",");
    const lon = towns.map((t) => t.lon.toFixed(3)).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&hourly=wind_speed_10m,wind_gusts_10m,precipitation&forecast_hours=72&timezone=Asia%2FKolkata";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];
    const out = {};
    towns.forEach((t, i) => {
      const h = data[i].hourly;
      const sum = (a) => a.reduce((s, v) => s + (v || 0), 0);
      out[t.name] = {
        windMax: Math.max(...h.wind_speed_10m),
        gustMax: Math.max(...h.wind_gusts_10m),
        rain72: sum(h.precipitation),
        galeHours: h.wind_speed_10m.filter((v) => v >= 62).length,
        issued: h.time[0],
      };
    });
    return { weather: out, source: "Open-Meteo (ECMWF/GFS blend)", url };
  }

  /** Optional GEE-derived exposure attributes (gee/exposure_pipeline.py → data/gee_exposure.json). */
  async function geeExposure() {
    try {
      const res = await fetch("data/gee_exposure.json", { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  root.CIF_FEEDS = { satelliteLayers, satelliteSnapshot, liveWeather, geeExposure, day };
})(typeof globalThis !== "undefined" ? globalThis : this);
