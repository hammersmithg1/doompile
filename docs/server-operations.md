# Server operations

Set the public HTTPS origins before deploying. The site is available at /doompile. Native clients and the clipper use the origin, without /doompile. Keep staging on a separate origin with independent SQLite, S3 data, downloads and backups.

| Setting | Purpose |
| --- | --- |
| DOOMPILE_PROD_URL | Production origin |
| DOOMPILE_STAGING_URL | Staging origin |
| DOOMPILE_ADMIN_EMAIL | Optional verified account to grant administration |
| DOOMPILE_APPLE_APP_IDS | Comma-separated Apple team and bundle identifiers for Universal Links |
| DOOMPILE_YANDEX_CLIENT_ID / DOOMPILE_YANDEX_CLIENT_SECRET | Yandex sign-in |
| DOOMPILE_GOOGLE_CLIENT_ID / DOOMPILE_GOOGLE_CLIENT_SECRET | Optional Google sign-in |
| DOOMPILE_S3_ACCESS_KEY / DOOMPILE_S3_SECRET_KEY | Object-storage credentials |
| DOOMPILE_DELIVERY_REPOSITORY / DOOMPILE_DELIVERY_REPOSITORY_ID | Trusted GitHub owner/repository and its numeric ID |
| DOOMPILE_DELIVERY_IDENTITY | Private age identity for receiving native archives |

Supply these values through the process environment or a secret provider. On a setec installation, use the delivery server's device scope for its instance settings and runtime credentials. The optional private .agents/local/instance.json accepts the origins, administrator, Apple app IDs and repository identity. Keep credentials in the secret provider. An existing agent_secrets.py wrapper is picked up by infra/ops, or can be selected with DOOMPILE_SECRETS_WRAPPER.

Register each deployment's OAuth callback at its provider. Keep the browser, iOS, macOS and clipper pointed at the intended origin. Configure signed Apple builds with DOOMPILE_PUBLIC_URL. See [authentication](authentication.md) and [Apple signing](apple-signing-setup.md).

Use the pinned Node version, Docker Compose and rsync.

~~~sh
mise exec -- npm ci
./infra/ops check
./infra/ops deploy staging
./infra/ops status staging
./infra/ops promote
./infra/ops status prod
./infra/ops backup prod
./infra/ops rollback prod
~~~

Use ./infra/ops edge to validate and apply the Caddy configuration for the configured origins. App and S3 ports bind to loopback. The app retains its data when containers change. A production deployment backs up and verifies SQLite and S3. Rollback selects the saved app image. Restore data separately from a verified backup while the app is stopped.

Release snapshots and manifests live under releases/. Durable data, downloads, diagnostics, edge state and backups live under runtime/. To build from another checkout, pass its path via --source and set DOOMPILE_PROJECT_ROOT to the deployment root. A release ID can be deployed with ./infra/ops deploy prod --release RELEASE.

## Automatic delivery

Use standard GitHub-hosted runners for validation, builds and signing. The web workflow emits a delivery receipt after all four validation jobs pass. Signed native jobs upload encrypted release files and symbols and emit their own receipts. A server-side timer reads completed GitHub runs for the configured repository and current main commit. It verifies the artifact digest and receipt, deploys the checked source and archives the native release. An unsuccessful native delivery is retried independently of web deployment.

Set DOOMPILE_DEPLOY_ENABLED to true in repository variables to enable web delivery. Configure the native release flags separately. Set DOOMPILE_DELIVERY_RECIPIENT to the public age key matching the receiver identity. Keep the private identity on the receiver, in its secret provider.

Use Python 3.12+, Git, gh and age on the receiver. Grant the receiver GitHub Contents and Actions read access. Install infra/pull-releases, pull_releases.py, instance.py, apple_links.py, preserve_native_artifacts.py and publish_macos_update.py into a private operator directory. The example systemd units use /srv/projects/doompile and .agents/local/ci-delivery. Adjust both paths for your installation. Run the installed command with --root PROJECT_ROOT --dry-run before enabling doompile-release-pull.timer. Stop the timer during a manual rollback if another verified release is pending.

The receiver stores checked binaries and symbols under runtime/diagnostics/native. Mac publication validates the manifest and writes the ZIP before replacing appcast.xml. The release service can fetch through ordinary outbound HTTPS. Keep production hosts unregistered as GitHub Actions runners for a public repository.

## Diagnostics

Use ./infra/ops status, logs and traces for the relevant environment. Bound telemetry queries and redact account credentials and note contents. Verify the running image using /api/health and verify backups using infra/verify-backup.mjs.
