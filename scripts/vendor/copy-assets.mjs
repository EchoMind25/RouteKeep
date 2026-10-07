// Copies browser assets that a package ships but a bundler cannot inline into
// public/vendor, versioned by filename so a deploy never serves a stale copy.
// Runs before `dev` and `build`; the output is gitignored.
//
// MapLibre GL 6 runs its tile worker from a separate module file that it
// locates relative to its own chunk URL; Next serves bundles from hashed
// chunk paths, so the worker is copied here and set with setWorkerUrl()
// (components/map/maplibre.ts). Same origin: no CDN, no third-party request.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "package.json"));
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

const outDir = join(root, "public", "vendor");
mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) if (name.startsWith("maplibre-gl-worker-")) rmSync(join(outDir, name));

const source = readFileSync(join(pkgDir, "dist", "maplibre-gl-worker.mjs"), "utf8");
// The source map is not shipped; drop the pointer so devtools do not request it.
const worker = source.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
writeFileSync(join(outDir, `maplibre-gl-worker-${version}.js`), worker);
console.log(`vendor: maplibre-gl-worker-${version}.js`);
