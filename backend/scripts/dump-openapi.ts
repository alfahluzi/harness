// Boots the OpenAPIHono app in-process and writes the spec to disk.
// Does not start a network listener.
//
// Usage: bun run scripts/dump-openapi.ts [output-path]
// Default output: ./openapi.json

import app from "../src/server";

const outPath = process.argv[2] ?? "openapi.json";

const res = await app.fetch(new Request("http://x/doc"));
if (!res.ok) {
	console.error(`doc endpoint returned ${res.status}`);
	process.exit(1);
}

const spec = await res.json();
const json = JSON.stringify(spec, null, 2);

await Bun.write(outPath, json);

const routeCount = Object.keys((spec as { paths?: object }).paths ?? {}).length;
console.log(`wrote ${outPath} (${routeCount} routes)`);
