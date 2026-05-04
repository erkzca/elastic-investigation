import { Client } from '@elastic/elasticsearch';

const es = new Client({
  node: 'http://localhost:9200',
  auth: { username: 'elastic', password: '"YOUR_PASSWORD"' }
});

const ARCGIS_BASE = 'https://greenland-ags.gis-hotel.dk/arcgis/rest/services/Temp/grunddata_offentlig/MapServer';
const BATCH_SIZE = 1000;

async function fetchFromArcGIS(layerId: number, offset: number, fields: string) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: fields,
    resultOffset: String(offset),
    resultRecordCount: String(BATCH_SIZE),
    f: 'json',
    returnGeometry: 'false'
  });

  const res = await fetch(`${ARCGIS_BASE}/${layerId}/query?${params}`);
  const data = await res.json();
  return data.features ?? [];
}

// Build a vejkode -> street_name lookup map from the streets layer
async function buildStreetLookup(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset = 0;

  while (true) {
    const features = await fetchFromArcGIS(1, offset, 'Vejkode,Vejnavn');
    if (features.length === 0) break;

    for (const { attributes: a } of features) {
      map.set(a.Vejkode, a.Vejnavn);
    }

    offset += BATCH_SIZE;
  }

  console.log(`Street lookup built: ${map.size} streets`);
  return map;
}

async function importStreets(streetLookup: Map<string, string>) {
  let offset = 0;
  let total = 0;

  while (true) {
    const features = await fetchFromArcGIS(1, offset, 'OBJECTID,Vejkode,Vejnavn');
    if (features.length === 0) break;

    const operations = features.flatMap(({ attributes: a }) => [
      { index: { _index: 'address-search', _id: `street-${a.OBJECTID}` } },
      {
        vejkode:      a.Vejkode,
        street_name:  a.Vejnavn,
        full_address: a.Vejnavn,
        type:         'street'
      }
    ]);

    await es.bulk({ operations });

    total += features.length;
    console.log(`streets: indexed ${total}...`);
    offset += BATCH_SIZE;
  }
}

async function importAccessPoints(streetLookup: Map<string, string>) {
  let offset = 0;
  let total = 0;

  while (true) {
    const features = await fetchFromArcGIS(0, offset, 'OBJECTID,Vejkode,HusNummer,BNummer');
    if (features.length === 0) break;

    const operations = features.flatMap(({ attributes: a }) => {
      // Resolve street name at index time using the lookup map
      const street_name = streetLookup.get(a.Vejkode) ?? '';

      return [
        { index: { _index: 'address-search', _id: String(a.OBJECTID) } },
        {
          vejkode:      a.Vejkode,
          street_name,
          husnummer:    a.HusNummer,
          full_address: `${street_name} ${a.HusNummer}`.trim(),
          b_number:     a.BNummer,
          type:         'access_point'
        }
      ];
    });

    const { errors, items } = await es.bulk({ operations });
    if (errors) console.error(items.filter(i => i.index?.error));

    total += features.length;
    console.log(`access_points: indexed ${total}...`);
    offset += BATCH_SIZE;
  }
}

async function run() {
  const exists = await es.indices.exists({ index: 'address-search' });
  if (!exists) {
    await es.indices.create({ index: 'address-search' });
  }
  await es.indices.putSettings({
    index: 'address-search',
    settings: { refresh_interval: '-1', number_of_replicas: '0' }
  });

  // Build lookup once, then pass it to both importers
  const streetLookup = await buildStreetLookup();

  await importStreets(streetLookup);
  await importAccessPoints(streetLookup);

  await es.indices.putSettings({
    index: 'address-search',
    settings: { refresh_interval: '1s', number_of_replicas: '1' }
  });
  await es.indices.refresh({ index: 'address-search' });

  console.log('Done!');
}

run();