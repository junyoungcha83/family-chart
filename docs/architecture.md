# Architecture and migration boundary

- Static UI: root `index.html`, `assets/`, `data/`, `manifest.webmanifest`, `sw.js`.
- API and persistence: `api/src/index.js`, `api/wrangler.toml` (KV); deploy from `api/` (`cd api && npm run deploy`). The Worker `name` (`family-chart-api`) and KV binding (`FAMILY`) are unchanged by the directory rename.

Keep public root paths and the Worker name stable. Reorganize internal code only with compatibility entrypoints and Wrangler dry-run validation. Agent tools should use explicit family-data service functions with authorization checks.
