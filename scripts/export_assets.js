// Print the asset inventory as JSON (input for gee/exposure_pipeline.py).
//   node scripts/export_assets.js > data/assets.json
const D = require("../js/data.js");
const assets = D.buildAssets().map(({ id, type, name, town, district, state, lat, lon }) => ({ id, type, name, town, district, state, lat: +lat.toFixed(5), lon: +lon.toFixed(5) }));
process.stdout.write(JSON.stringify(assets, null, 1));
