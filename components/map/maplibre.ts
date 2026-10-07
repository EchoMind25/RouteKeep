import { getVersion, setWorkerUrl } from "maplibre-gl";

// Import this module before any map renders. See scripts/vendor/copy-assets.mjs.
setWorkerUrl(`/vendor/maplibre-gl-worker-${getVersion()}.js`);
