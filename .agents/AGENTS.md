# Doompile

Work from the project repository. Use the pinned Node version through mise and install dependencies with npm ci. Keep generated exports in sync with npm run shared:generate. The generated design assets are required inputs.

- Run ./infra/ops check before release. It checks web, core, editor, clipper, infrastructure and the production build. Run npm run verify:ui for browser changes. Native workflows test the iOS and macOS targets.
- Keep experiments on staging. Use immutable release snapshots and verify the selected image before promoting it. Retain verified backups and roll back application images separately from databases.
- Read instance settings from environment variables and local operator instructions. Load credentials through the configured secret provider. Keep operator addresses, identities, credentials, runtime data and backups outside tracked files.
- Preserve installed client paths. The web entry at /doompile rewrites to the application. API, OAuth, note links and assets retain their origin paths.
- Keep Next development servers, SQLite, object storage and Caddy administration private. During diagnostics, redact credentials and note contents.
- Hosted Actions jobs verify and build releases. The delivery server pulls receipts for its configured main branch. Preserve native symbols and manifests. Publish the immutable Mac ZIP before the signed appcast and verify release availability.

See docs/server-operations.md and docs/apple-signing-setup.md.
