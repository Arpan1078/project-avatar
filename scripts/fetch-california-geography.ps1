# Public bounded geographic downloads for the Dixie map. Run from repository root.
$ErrorActionPreference = 'Stop'
$base = 'reference-data/california-map-cache'
New-Item -ItemType Directory -Force -Path $base | Out-Null
$jobs = @(
  @{name='roads-state';url='https://cartowfs.nationalmap.gov/arcgis/rest/services/transportation/MapServer/5';fields='objectid,name,state_route,mtfcc_code';where='1=1'},
  @{name='roads-local';url='https://cartowfs.nationalmap.gov/arcgis/rest/services/transportation/MapServer/7';fields='objectid,name,state_route,mtfcc_code';where='1=1'},
  @{name='water';url='https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12';fields='OBJECTID,GNIS_NAME,AREASQKM,FTYPE';where='1=1'},
  @{name='creeks';url='https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6';fields='OBJECTID,gnis_name,ftype';where='gnis_name IS NOT NULL'},
  @{name='towns';url='https://cartowfs.nationalmap.gov/arcgis/rest/services/geonames/MapServer/0';fields='OBJECTID,gaz_name,gaz_featureclass,state_alpha,county_name';where="gaz_featureclass='Populated Place'"},
  @{name='structures';url='https://cartowfs.nationalmap.gov/arcgis/rest/services/structures/MapServer/0';fields='OBJECTID,NAME,FTYPE,FCODE,ADDRESS,CITY,STATE,ZIPCODE,SOURCE_ORIGINATOR';where='1=1'},
  @{name='buildings';url='https://services6.arcgis.com/Do88DoK2xjTUCXd1/ArcGIS/rest/services/OSM_NA_Buildings/FeatureServer/0';fields='OBJECTID,osm_id,name,building,osm_timestamp';where='1=1'}
)
foreach ($job in $jobs) {
  $features = @(); $offset = 0; $pages = @()
  do {
    $params = [ordered]@{f='json';where=$job.where;geometry='-121.58,39.70,-121.20,40.04';geometryType='esriGeometryEnvelope';inSR='4326';outSR='4326';spatialRel='esriSpatialRelIntersects';outFields=$job.fields;returnGeometry='true';geometryPrecision='6';maxAllowableOffset='0.00005';resultRecordCount='1000';resultOffset=[string]$offset;orderByFields=$(if ($job.name -like 'roads-*') {'objectid'} else {'OBJECTID'})}
    $query = ($params.GetEnumerator() | ForEach-Object { [uri]::EscapeDataString($_.Key) + '=' + [uri]::EscapeDataString([string]$_.Value) }) -join '&'
    $url = $job.url + '/query?' + $query
    $response = Invoke-RestMethod -Uri $url -TimeoutSec 40
    if ($response.error) { throw ($response.error | ConvertTo-Json -Compress -Depth 4) }
    if (-not $response.features) { $batch = @() } else { $batch = @($response.features) }
    $features += $batch; $pages += $url; $offset += $batch.Count
    if ($response.exceededTransferLimit -and $batch.Count -eq 0) { throw 'Pagination made no progress' }
    if ($offset -gt 15000) { throw 'Bounded download unexpectedly large; narrow extent first' }
  } while ($response.exceededTransferLimit)
  $result = [ordered]@{source=$job.url;retrievedOn='2026-11-07';bbox=@(-121.58,39.70,-121.20,40.04);queryUrls=$pages;geometryType=$response.geometryType;spatialReference=$response.spatialReference;features=$features}
  [IO.File]::WriteAllText((Join-Path (Get-Location) ($base + '/' + $job.name + '.json')), ($result | ConvertTo-Json -Depth 40), (New-Object Text.UTF8Encoding($false)))
  Write-Output ($job.name + ': ' + $features.Count + ' features')
}
