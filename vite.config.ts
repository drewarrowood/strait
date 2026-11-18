import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained index.html so the built game opens from disk
// or from any static host, with no server and no asset requests.
// base "./" keeps every URL relative (or inlined). That is what makes
// https://drewarrowood.github.io/strait/ work: a root-absolute /assets
// path would 404 under the /strait/ project site. The Pages workflow
// rejects a build that emits one.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  server: { host: "127.0.0.1", port: 43117, strictPort: true },
  preview: { host: "127.0.0.1", port: 43117, strictPort: true },
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});
