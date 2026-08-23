import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  base: "./",
  plugins: [solid({ ssr: false })],
  optimizeDeps: {
    // The lib ships prebuilt worker chunks next to lib.es.js; pre-bundling
    // would move the entry into .vite/deps and break the relative worker URLs.
    exclude: ["@big-mesh-studios/bms-voxelscape"],
    // rmsl keeps its Fn-scope stack in module-global state. Without this,
    // lib.es.js (excluded above) resolves "@random-mesh/rmsl" to raw source
    // while everyone else gets the prebundled copy — two instances, two
    // scope stacks, and "toVar must be called inside an Fn scope" errors.
    include: ["@random-mesh/rmsl"],
  },
});
