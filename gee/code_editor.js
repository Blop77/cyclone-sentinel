// CycloneSentinel — exposure layers for the Google Earth Engine Code Editor.
// Paste into https://code.earthengine.google.com and press Run.
// Shows the layers the pipeline samples for each asset, plus low-lying (< 5 m)
// populated land that storm surge and rainfall ponding reach first.

var region = ee.Geometry.Rectangle([80.5, 15.5, 90.5, 23.5]); // Bay of Bengal coast: AP, Odisha, West Bengal
Map.centerObject(region, 7);

var dem = ee.ImageCollection('COPERNICUS/DEM/GLO30').select('DEM').mosaic().clip(region);
var water = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').clip(region);
var pop = ee.ImageCollection('WorldPop/GP/100m/pop').filter(ee.Filter.eq('year', 2020)).mosaic().clip(region);

// Cyclone Fani (2019): observed 48 h rainfall from GPM IMERG (mm).
var rain = ee.ImageCollection('NASA/GPM_L3/IMERG_V07')
  .filterDate('2019-05-02', '2019-05-04').select('precipitation').sum().multiply(0.5).clip(region);

var lowLying = dem.lt(5).and(pop.gt(5)).selfMask();

Map.addLayer(dem, {min: 0, max: 60, palette: ['#08306b', '#4292c6', '#c6dbef', '#ffffff']}, 'Elevation (Copernicus GLO-30)', false);
Map.addLayer(water, {min: 0, max: 100, palette: ['#c6dbef', '#08519c']}, 'Surface-water occurrence (JRC)', false);
Map.addLayer(pop, {min: 0, max: 50, palette: ['#fff5eb', '#fd8d3c', '#7f2704']}, 'Population (WorldPop 2020)', false);
Map.addLayer(rain, {min: 0, max: 400, palette: ['#ffffff', '#6baed6', '#08306b']}, 'Fani rainfall, 2–4 May 2019 (IMERG)');
Map.addLayer(lowLying, {palette: ['#d03b3b']}, 'Populated land below 5 m (surge/ponding exposure)');

// Population living below 5 m in the region.
var exposed = pop.updateMask(dem.lt(5)).reduceRegion({reducer: ee.Reducer.sum(), geometry: region, scale: 100, maxPixels: 1e10});
print('People living below 5 m elevation (WorldPop 2020):', exposed);
