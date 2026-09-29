/*
 * CycloneSentinel — reference data.
 *
 * Cyclone tracks are approximate 6–24 hourly fixes digitised from public IMD
 * best-track summaries for demonstration. Swap in IBTrACS / IMD best-track CSVs
 * for production use.
 *
 * The infrastructure inventory is ILLUSTRATIVE: assets are generated
 * deterministically around real coastal towns (real names, approximate
 * coordinates, populations, distance-to-coast and elevation) so the model has a
 * realistic spatial distribution. They are not surveyed facility locations.
 */
(function (root) {
  "use strict";

  // Track fix: [ISO time (UTC), lat, lon, max sustained wind km/h]
  const CYCLONES = [
    {
      id: "fani-2019",
      name: "Fani (2019)",
      category: "Extremely Severe Cyclonic Storm",
      landfall: "Puri, Odisha — 3 May 2019",
      landfallTime: "2019-05-03T03:00:00Z",
      track: [
        ["2019-04-29T00:00:00Z", 8.5, 88.0, 90],
        ["2019-04-30T00:00:00Z", 11.5, 86.5, 130],
        ["2019-05-01T00:00:00Z", 14.0, 85.0, 180],
        ["2019-05-02T00:00:00Z", 16.8, 84.8, 215],
        ["2019-05-02T12:00:00Z", 18.4, 85.1, 205],
        ["2019-05-03T03:00:00Z", 19.8, 85.8, 185],
        ["2019-05-03T12:00:00Z", 21.2, 86.7, 120],
        ["2019-05-04T00:00:00Z", 22.8, 88.5, 75],
        ["2019-05-04T12:00:00Z", 24.5, 90.0, 45],
      ],
    },
    {
      id: "amphan-2020",
      name: "Amphan (2020)",
      category: "Super Cyclonic Storm",
      landfall: "Sagar Island / Sundarbans, West Bengal — 20 May 2020",
      landfallTime: "2020-05-20T11:00:00Z",
      track: [
        ["2020-05-17T00:00:00Z", 12.0, 86.3, 110],
        ["2020-05-18T00:00:00Z", 14.5, 86.4, 240],
        ["2020-05-19T00:00:00Z", 17.2, 86.7, 220],
        ["2020-05-20T00:00:00Z", 19.8, 87.6, 190],
        ["2020-05-20T11:00:00Z", 21.65, 88.3, 160],
        ["2020-05-20T18:00:00Z", 22.8, 88.9, 110],
        ["2020-05-21T06:00:00Z", 24.5, 89.5, 60],
      ],
    },
    {
      id: "phailin-2013",
      name: "Phailin (2013)",
      category: "Very Severe Cyclonic Storm",
      landfall: "Gopalpur, Odisha — 12 Oct 2013",
      landfallTime: "2013-10-12T17:00:00Z",
      track: [
        ["2013-10-09T00:00:00Z", 12.0, 95.5, 55],
        ["2013-10-10T00:00:00Z", 14.0, 91.5, 120],
        ["2013-10-11T00:00:00Z", 16.0, 88.5, 200],
        ["2013-10-12T00:00:00Z", 18.0, 86.5, 215],
        ["2013-10-12T17:00:00Z", 19.3, 84.9, 205],
        ["2013-10-13T00:00:00Z", 20.0, 84.3, 150],
        ["2013-10-13T12:00:00Z", 21.5, 83.5, 80],
        ["2013-10-14T00:00:00Z", 23.0, 83.0, 45],
      ],
    },
    {
      id: "hudhud-2014",
      name: "Hudhud (2014)",
      category: "Extremely Severe Cyclonic Storm",
      landfall: "Visakhapatnam, Andhra Pradesh — 12 Oct 2014",
      landfallTime: "2014-10-12T06:00:00Z",
      track: [
        ["2014-10-08T00:00:00Z", 12.5, 92.5, 65],
        ["2014-10-09T00:00:00Z", 13.8, 90.2, 110],
        ["2014-10-10T00:00:00Z", 15.0, 88.0, 150],
        ["2014-10-11T00:00:00Z", 16.3, 85.8, 180],
        ["2014-10-12T06:00:00Z", 17.7, 83.3, 180],
        ["2014-10-12T18:00:00Z", 18.6, 82.6, 90],
        ["2014-10-13T06:00:00Z", 19.5, 82.4, 50],
      ],
    },
  ];

  // name, state, lat, lon, population, distance to coast (km), mean elevation (m), port?
  const TOWNS = [
    ["Visakhapatnam", "Andhra Pradesh", 17.69, 83.22, 2035000, 2, 12, true],
    ["Kakinada", "Andhra Pradesh", 16.99, 82.25, 384000, 2, 4, true],
    ["Bheemunipatnam", "Andhra Pradesh", 17.89, 83.45, 55000, 1, 6, false],
    ["Vizianagaram", "Andhra Pradesh", 18.11, 83.40, 228000, 20, 55, false],
    ["Srikakulam", "Andhra Pradesh", 18.30, 83.90, 147000, 12, 16, false],
    ["Kalingapatnam", "Andhra Pradesh", 18.34, 84.12, 12000, 1, 3, false],
    ["Gopalpur", "Odisha", 19.26, 84.91, 7000, 0.5, 4, true],
    ["Berhampur", "Odisha", 19.31, 84.79, 356000, 13, 24, false],
    ["Rambha", "Odisha", 19.52, 85.10, 15000, 12, 5, false],
    ["Balugaon", "Odisha", 19.74, 85.22, 20000, 20, 4, false],
    ["Satapada", "Odisha", 19.67, 85.45, 9000, 3, 2, false],
    ["Puri", "Odisha", 19.81, 85.83, 201000, 1, 5, false],
    ["Konark", "Odisha", 19.89, 86.09, 17000, 3, 5, false],
    ["Astaranga", "Odisha", 20.00, 86.37, 14000, 4, 3, false],
    ["Bhubaneswar", "Odisha", 20.30, 85.82, 885000, 55, 45, false],
    ["Cuttack", "Odisha", 20.46, 85.88, 610000, 70, 36, false],
    ["Jagatsinghpur", "Odisha", 20.26, 86.17, 35000, 25, 8, false],
    ["Paradip", "Odisha", 20.32, 86.61, 73000, 1, 3, true],
    ["Kendrapara", "Odisha", 20.50, 86.42, 47000, 35, 9, false],
    ["Chandbali", "Odisha", 20.78, 86.74, 20000, 20, 4, false],
    ["Dhamra", "Odisha", 20.79, 86.96, 11000, 2, 3, true],
    ["Bhadrak", "Odisha", 21.06, 86.50, 111000, 45, 15, false],
    ["Balasore", "Odisha", 21.49, 86.93, 145000, 15, 16, false],
    ["Chandipur", "Odisha", 21.44, 87.02, 9000, 1, 4, false],
    ["Digha", "West Bengal", 21.63, 87.51, 15000, 0.5, 5, false],
    ["Contai", "West Bengal", 21.78, 87.75, 92000, 12, 6, false],
    ["Tamluk", "West Bengal", 22.30, 87.92, 65000, 45, 7, false],
    ["Haldia", "West Bengal", 22.06, 88.07, 200000, 8, 5, true],
    ["Sagar Island", "West Bengal", 21.65, 88.08, 212000, 3, 3, false],
    ["Kakdwip", "West Bengal", 21.87, 88.18, 60000, 20, 4, false],
    ["Namkhana", "West Bengal", 21.77, 88.23, 45000, 8, 3, false],
    ["Diamond Harbour", "West Bengal", 22.19, 88.19, 41000, 40, 5, false],
    ["Gosaba", "West Bengal", 22.16, 88.80, 60000, 20, 3, false],
    ["Kolkata", "West Bengal", 22.57, 88.36, 4500000, 110, 9, true],
  ].map(([name, state, lat, lon, pop, coastKm, elev, port]) => ({ name, state, lat, lon, pop, coastKm, elev, port }));

  /*
   * Fragility parameters (lognormal CDF): median capacity and dispersion (beta)
   * for wind (km/h) and flood depth (m). Values are indicative, adapted from
   * HAZUS-MH hurricane/flood guidance and post-event reports for Indian
   * construction; tune them with local damage data.
   *   value     — replacement value, INR crore
   *   power     — depends on grid power (cascade)
   *   backup    — fraction of a grid outage absorbed by on-site backup
   *   weight    — criticality weight used to rank response actions
   */
  const ASSET_TYPES = {
    housing:      { label: "Kutcha housing cluster", short: "Housing",      windMedian: 125, windBeta: 0.35, floodMedian: 0.6, floodBeta: 0.5, value: 12,  power: false, backup: 0,   weight: 1.0 },
    hospital:     { label: "Hospital",               short: "Hospitals",    windMedian: 235, windBeta: 0.25, floodMedian: 1.2, floodBeta: 0.4, value: 60,  power: true,  backup: 0.6, weight: 1.6 },
    substation:   { label: "Substation & feeders",   short: "Substations",  windMedian: 160, windBeta: 0.30, floodMedian: 0.6, floodBeta: 0.4, value: 40,  power: false, backup: 0,   weight: 1.4 },
    transmission: { label: "Transmission line span", short: "Power lines",  windMedian: 145, windBeta: 0.30, floodMedian: 3.0, floodBeta: 0.5, value: 8,   power: false, backup: 0,   weight: 1.1 },
    telecom:      { label: "Telecom tower",          short: "Telecom",      windMedian: 165, windBeta: 0.30, floodMedian: 1.5, floodBeta: 0.4, value: 1.5, power: true,  backup: 0.5, weight: 1.2 },
    water:        { label: "Water treatment plant",  short: "Water",        windMedian: 240, windBeta: 0.25, floodMedian: 1.0, floodBeta: 0.4, value: 25,  power: true,  backup: 0.3, weight: 1.3 },
    bridge:       { label: "Road bridge",            short: "Bridges",      windMedian: 320, windBeta: 0.30, floodMedian: 2.0, floodBeta: 0.4, value: 30,  power: false, backup: 0,   weight: 1.1 },
    port:         { label: "Port terminal",          short: "Ports",        windMedian: 215, windBeta: 0.30, floodMedian: 2.5, floodBeta: 0.4, value: 300, power: false, backup: 0,   weight: 1.3 },
    shelter:      { label: "Cyclone shelter",        short: "Shelters",     windMedian: 290, windBeta: 0.25, floodMedian: 2.5, floodBeta: 0.4, value: 2,   power: false, backup: 0,   weight: 1.5 },
    // Arterial road: "damage" = impassable (tree/pole fall in wind, or > ~0.3 m of water over the carriageway).
    road:         { label: "Arterial road",          short: "Roads",        windMedian: 175, windBeta: 0.35, floodMedian: 0.3, floodBeta: 0.5, value: 5,   power: false, backup: 0,   weight: 1.2 },
  };

  // Disaster-management routing for advisories.
  const DISTRICTS = {
    Visakhapatnam: "Visakhapatnam", Bheemunipatnam: "Visakhapatnam", Kakinada: "Kakinada", Vizianagaram: "Vizianagaram",
    Srikakulam: "Srikakulam", Kalingapatnam: "Srikakulam", Gopalpur: "Ganjam", Berhampur: "Ganjam", Rambha: "Ganjam",
    Balugaon: "Khordha", Satapada: "Puri", Puri: "Puri", Konark: "Puri", Astaranga: "Puri", Bhubaneswar: "Khordha",
    Cuttack: "Cuttack", Jagatsinghpur: "Jagatsinghpur", Paradip: "Jagatsinghpur", Kendrapara: "Kendrapara",
    Chandbali: "Bhadrak", Dhamra: "Bhadrak", Bhadrak: "Bhadrak", Balasore: "Balasore", Chandipur: "Balasore",
    Digha: "Purba Medinipur", Contai: "Purba Medinipur", Tamluk: "Purba Medinipur", Haldia: "Purba Medinipur",
    "Sagar Island": "South 24 Parganas", Kakdwip: "South 24 Parganas", Namkhana: "South 24 Parganas",
    "Diamond Harbour": "South 24 Parganas", Gosaba: "South 24 Parganas", Kolkata: "Kolkata",
  };
  const STATE_AUTHORITY = {
    Odisha: "Odisha State Disaster Management Authority (OSDMA)",
    "Andhra Pradesh": "Andhra Pradesh State Disaster Management Authority (APSDMA)",
    "West Bengal": "West Bengal Dept. of Disaster Management & Civil Defence",
  };
  TOWNS.forEach((t) => (t.district = DISTRICTS[t.name]));

  // Seeded PRNG so the inventory is identical on every load.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildAssets() {
    const rand = mulberry32(20260929);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const assets = [];
    const clampCount = (n, max) => Math.max(0, Math.min(max, Math.round(n)));

    for (const town of TOWNS) {
      const k = town.pop / 100000;
      const counts = {
        housing: clampCount(2 + k * 0.8, 7),
        hospital: clampCount(1 + k / 3, 5),
        substation: clampCount(1 + k / 2.5, 5),
        transmission: clampCount(1 + k / 4, 4),
        telecom: clampCount(2 + k / 1.5, 6),
        water: town.pop > 50000 ? clampCount(1 + k / 8, 3) : 0,
        bridge: clampCount(1 + k / 6, 3),
        port: town.port ? 1 : 0,
        shelter: town.coastKm <= 20 ? clampCount(1 + k / 3, 4) : 0,
      };
      const spread = 0.025 + Math.min(0.08, Math.sqrt(town.pop) / 25000);

      for (const [type, n] of Object.entries(counts)) {
        for (let i = 0; i < n; i++) {
          const lowLying = type === "housing" || type === "port";
          const coastKm = Math.max(0.2, town.coastKm + gauss() * Math.min(4, 0.25 * town.coastKm + 1) - (type === "port" ? town.coastKm : 0));
          const elev = Math.max(0.8, town.elev + gauss() * 1.5 - (lowLying ? 1.5 : 0) + (type === "shelter" ? 2 : 0));
          const people = type === "housing"
            ? Math.round((town.pop * 0.35) / counts.housing)
            : type === "hospital" ? Math.round(town.pop / counts.hospital)
            : type === "shelter" ? 1500
            : 0;
          assets.push({
            id: `${town.name.replace(/\s+/g, "-").toLowerCase()}-${type}-${i + 1}`,
            type,
            town: town.name,
            state: town.state,
            name: `${town.name} ${ASSET_TYPES[type].label}${n > 1 ? " " + (i + 1) : ""}`,
            lat: town.lat + gauss() * spread,
            lon: town.lon + gauss() * spread,
            coastKm: +coastKm.toFixed(1),
            elev: +elev.toFixed(1),
            people,
          });
        }
      }
    }

    const d2 = (a, b) => (a.lat - b.lat) ** 2 + ((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) ** 2;
    const nearest = (a, list) => list.reduce((best, s) => (d2(a, s) < d2(a, best) ? s : best), list[0]);

    // Arterial roads: each town links to its nearest neighbour and to its nearest
    // larger inland town (the evacuation / supply route). Hazard is evaluated at
    // the low point of the segment, which floods first.
    const rr = mulberry32(7331);
    const seen = new Set();
    for (const town of TOWNS) {
      const others = TOWNS.filter((t) => t !== town);
      const near = nearest(town, others);
      const inlandCands = others.filter((t) => t.coastKm > town.coastKm + 5 && t.pop > town.pop && d2(town, t) < 1.1 ** 2); // within ~120 km
      const inland = inlandCands.length ? nearest(town, inlandCands) : null;
      for (const other of [near, inland]) {
        if (!other) continue;
        const key = [town.name, other.name].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const f = 0.3 + 0.2 * rr();
        assets.push({
          id: `road-${key.replace(/[|\s]+/g, "-").toLowerCase()}`,
          type: "road",
          town: town.name,
          state: town.state,
          name: `${town.name}–${other.name} arterial road`,
          lat: town.lat + f * (other.lat - town.lat),
          lon: town.lon + f * (other.lon - town.lon),
          path: [[town.lat, town.lon], [other.lat, other.lon]],
          towns: [town.name, other.name],
          coastKm: +Math.max(0.5, town.coastKm + f * (other.coastKm - town.coastKm)).toFixed(1),
          elev: +Math.max(0.8, Math.min(town.elev, other.elev) - 1 - rr()).toFixed(1),
          people: 0,
        });
      }
    }

    // Dependencies: grid-dependent assets are fed by their nearest substation;
    // hospitals, shelters and water plants are reached via their town's nearest arterial road.
    const subs = assets.filter((a) => a.type === "substation");
    const lines = assets.filter((a) => a.type === "transmission");
    const roads = assets.filter((a) => a.type === "road");
    for (const a of assets) {
      if (ASSET_TYPES[a.type].power) a.feeder = nearest(a, subs).id;
      if (a.type === "substation") a.line = nearest(a, lines).id;
      if (["hospital", "shelter", "water"].includes(a.type)) {
        const own = roads.filter((r) => r.towns.includes(a.town));
        a.access = nearest(a, own.length ? own : roads).id;
      }
      a.district = DISTRICTS[a.town];
    }
    return assets;
  }

  const API = { CYCLONES, TOWNS, ASSET_TYPES, DISTRICTS, STATE_AUTHORITY, buildAssets, mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CIF_DATA = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
