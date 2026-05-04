import { Client } from '@elastic/elasticsearch';

const es = new Client({
  node: 'http://localhost:9200',
  auth: { username: 'elastic', password: '"YOUR_PASSWORD"' }
});

async function setup() {
  const exists = await es.indices.exists({ index: 'address-search' });
  if (exists) {
    await es.indices.delete({ index: 'address-search' });
    console.log('Deleted existing index');
  }

  await es.indices.create({
    index: 'address-search',
    mappings: {
      properties: {
        full_address: { type: 'search_as_you_type' },
        street_name:  { type: 'search_as_you_type' },
        vejkode:      { type: 'keyword' },
        husnummer:    { type: 'keyword' },
        b_number:     { type: 'keyword' },
        type:         { type: 'keyword' }
      }
    }
  });

  console.log('Index created with mapping');
}

setup();