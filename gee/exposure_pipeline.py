"""
Google Earth Engine exposure pipeline for CycloneSentinel.

For every infrastructure asset it samples, server-side in Earth Engine:
  * elevation            Copernicus GLO-30 DEM            (COPERNICUS/DEM/GLO30)
  * surface-water        JRC Global Surface Water v1.4    (JRC/GSW1_4/GlobalSurfaceWater) — max occurrence within 500 m
  * population exposure  WorldPop 100 m, 2020             (WorldPop/GP/100m/pop) — people within 1 km
  * observed rainfall    NASA GPM IMERG V07 half-hourly   (NASA/GPM_L3/IMERG_V07) — accumulation over a window

and writes data/gee_exposure.json, which the web app loads automatically to
replace its town-level elevation estimates (see js/app.js → boot()).

Setup (one time):
    pip install earthengine-api
    earthengine authenticate
    # a Google Cloud project registered for Earth Engine (noncommercial use is free)

Run:
    node scripts/export_assets.js > data/assets.json
    python gee/exposure_pipeline.py --project YOUR_GCP_PROJECT \
        --rain-start 2019-05-02 --rain-end 2019-05-04        # e.g. Cyclone Fani
"""
import argparse
import datetime as dt
import json
import pathlib

import ee

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Google Cloud project registered for Earth Engine")
    ap.add_argument("--assets", default=str(ROOT / "data" / "assets.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "gee_exposure.json"))
    ap.add_argument("--rain-start", help="IMERG accumulation start (YYYY-MM-DD); default: 3 days ago")
    ap.add_argument("--rain-end", help="IMERG accumulation end (YYYY-MM-DD); default: today")
    args = ap.parse_args()

    ee.Initialize(project=args.project)
    assets = json.loads(pathlib.Path(args.assets).read_text(encoding="utf-8"))

    end = args.rain_end or dt.date.today().isoformat()
    start = args.rain_start or (dt.date.fromisoformat(end) - dt.timedelta(days=3)).isoformat()

    dem = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM").mosaic().rename("elev_m")
    water = (ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0)
             .focalMax(500, "circle", "meters").rename("water_occurrence"))
    pop = (ee.ImageCollection("WorldPop/GP/100m/pop").filter(ee.Filter.eq("year", 2020)).mosaic()
           .reduceNeighborhood(ee.Reducer.sum(), ee.Kernel.circle(1000, "meters")).rename("pop_1km"))
    # IMERG precipitation is mm/hr per half hour → mm = sum × 0.5
    rain = (ee.ImageCollection("NASA/GPM_L3/IMERG_V07").filterDate(start, end).select("precipitation")
            .sum().multiply(0.5).rename("imerg_mm"))
    stack = dem.addBands(water).addBands(pop).addBands(rain)

    features = [ee.Feature(ee.Geometry.Point([a["lon"], a["lat"]]), {"id": a["id"]}) for a in assets]
    out = {}
    for i in range(0, len(features), 250):  # stay well under interactive request limits
        fc = ee.FeatureCollection(features[i:i + 250])
        sampled = stack.reduceRegions(collection=fc, reducer=ee.Reducer.first(), scale=90).getInfo()
        for f in sampled["features"]:
            p = f["properties"]
            out[p["id"]] = {k: (round(p[k], 2) if isinstance(p.get(k), (int, float)) else p.get(k))
                            for k in ("elev_m", "water_occurrence", "pop_1km", "imerg_mm")}

    doc = {
        "source": "Google Earth Engine: Copernicus GLO-30 DEM, JRC GSW v1.4, WorldPop 2020, GPM IMERG V07",
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "rain_window": [start, end],
        "assets": out,
    }
    pathlib.Path(args.out).write_text(json.dumps(doc, indent=1), encoding="utf-8")
    print(f"Wrote {len(out)} assets to {args.out}")


if __name__ == "__main__":
    main()
