import { Client } from "@elastic/elasticsearch";

const es = new Client({
  node: "http://localhost:9200",
  auth: { username: "elastic", password: "YOUR_PASSWORD" },
});

export async function searchAddresses(query: string, size = 10) {
  const result = await es.search({
    index: "address-search",
    size,
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query,
              type: "bool_prefix",
              fields: [
                "full_address^3",
                "full_address._2gram",
                "full_address._3gram",
                "street_name^3",
                "street_name._2gram",
                "street_name._3gram",
              ],
            },
          },
          {
            multi_match: {
              query,
              fields: ["full_address^3", "street_name^3"],
              fuzziness: "AUTO",
              operator: "and",
              boost: 0.5,
            },
          },
        ],
      },
    },
  });

  return result.hits.hits.map((h) => h._source);
}

// Quick test
searchAddresses("Telebakn").then((results) => {
  console.log(JSON.stringify(results, null, 2));
});
