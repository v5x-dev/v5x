import { Robot } from "../src/client.js";

const pages = 200;
const client = new Robot({
  token: "benchmark-token",
  baseUrl: "https://events.example/api/v2",
  fetch: async (input) => {
    const url = new URL(
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url,
    );
    const page = Number(url.searchParams.get("page"));
    return Response.json({
      data: [
        {
          id: page,
          sku: `RE-${page}`,
          name: `Event ${page}`,
          season: { id: 1, name: "Season" },
          program: { id: 1, name: "V5RC" },
          location: {},
        },
      ],
      meta: { current_page: page, last_page: pages },
    });
  },
});
const startedAt = performance.now();
const events = await client.events.search();
console.log(
  `Events pagination: ${events.length} items in ${(performance.now() - startedAt).toFixed(1)} ms`,
);
