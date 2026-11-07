# Deployment

Follow [server operations](server-operations.md) for staging, immutable releases, backups and delivery from GitHub. Use [authentication](authentication.md) to register OAuth callbacks and [Apple signing](apple-signing-setup.md) to configure native releases.

The web entry rewrites /doompile to the app. Preserve API and OAuth paths, /notes/<uuid>, and both existing Mac download paths. App and clipper connection settings take an origin such as https://notes.example.org. The web entry is https://notes.example.org/doompile.

For Universal Links, configure DOOMPILE_PUBLIC_URL when building the native apps and DOOMPILE_APPLE_APP_IDS on the web server. Apple must be able to fetch /.well-known/apple-app-site-association over HTTPS. The Xcode generator embeds the origin in the app and adds the Associated Domains entitlement when configured. A note link uses /notes/<uuid>. It opens cached content or requests the note using the current account.

Mac release builds receive their Sparkle feed URL and public key through DOOMPILE_MACOS_UPDATE_FEED_URL and DOOMPILE_MACOS_UPDATE_PUBLIC_KEY. The app verifies the signed feed and archive before extraction. For server delivery, infra/publish_macos_update.py checks the release manifest, writes the immutable ZIP and then atomically replaces the appcast. The existing application serves /doompile/downloads/macos and /downloads/macos.
