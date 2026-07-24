# Architecture and migration boundary

- Static UI: root `index.html`, `assets/`, `data/`, `manifest.webmanifest`, `sw.js`.
- API and persistence: `worker/src/index.js`, `worker/wrangler.toml` (KV); deploy from `worker/`.

Keep public root paths and the Worker name stable. Reorganize internal code only with compatibility entrypoints and Wrangler dry-run validation. Agent tools should use explicit family-data service functions with authorization checks.
