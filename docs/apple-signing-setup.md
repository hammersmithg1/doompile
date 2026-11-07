# Apple signing and CI

Signing uses an operator's Apple Developer team. Keep its material in the signing runner's device scope, separate from the deployment server's scope. Test builds can run with code signing disabled.

| Input | Purpose |
| --- | --- |
| APPLE_TEAM_ID | Signing team |
| APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_P8_BASE64 | Team API key |
| IOS_DISTRIBUTION_P12_BASE64, IOS_DISTRIBUTION_P12_PASSWORD | iOS certificate and password for manual signing |
| IOS_PROFILE_APP_BASE64, IOS_PROFILE_SHARE_BASE64, IOS_PROFILE_SAFARI_BASE64, IOS_PROFILE_ACTION_BASE64 | Profiles for the four iOS targets |
| MACOS_DEVELOPER_ID_P12_BASE64, MACOS_DEVELOPER_ID_P12_PASSWORD | Optional Developer ID material for notarized downloads |
| DOOMPILE_MACOS_UPDATE_PRIVATE_KEY | Sparkle Ed25519 seed |

Provision the App IDs and App Group for your team. Enable Associated Domains for HTTPS note links. Configure the site's DOOMPILE_APPLE_APP_IDS and the build's DOOMPILE_PUBLIC_URL. Supply the existing feed URL and matching public key through DOOMPILE_MACOS_UPDATE_FEED_URL and DOOMPILE_MACOS_UPDATE_PUBLIC_KEY. Use the same key for future updates to installed copies.

The signing workflows join Tailscale using a workload identity restricted to the repository ID and refs/heads/main. The template at .agents/ci/tailscale.example.json describes the required tag, setec grant and subject claims. Configure the identity at the provider. Set the bootstrap inputs DOOMPILE_TS_AUDIENCE, DOOMPILE_TS_CLIENT_ID and DOOMPILE_CI_SETEC_URL as GitHub secrets so Actions masks their values in logs. Repository variables can specify DOOMPILE_CI_TAILSCALE_TAG and DOOMPILE_CI_SETEC_DEVICE. The runner reads Apple and Sparkle signing material from its setec scope.

Run the signing-access workflow on main to verify identity and the required input names. Enable DOOMPILE_TESTFLIGHT_AUTO_UPLOAD and choose DOOMPILE_IOS_SIGNING_MODE after setup. Configure an internal TestFlight group with automatic distribution. The automatic iOS release waits until App Store Connect confirms availability for internal testing. For Mac, DOOMPILE_MACOS_RELEASE_ENABLED enables personal ad-hoc packaging. Set DOOMPILE_MACOS_UPDATE_PUBLISH_ENABLED to hand the verified bundle to the delivery server. The separate signed_release input uses Developer ID and notarization. Set DOOMPILE_MACOS_BUILD_SERIES above the first component of the last published build. CI uses the series, GitHub run ID and attempt to produce distinct increasing builds without querying the deployment server.

Both native release workflows encrypt release archives and symbols with DOOMPILE_DELIVERY_RECIPIENT. The receiver holds the matching DOOMPILE_DELIVERY_IDENTITY. Developer validation artifacts use unsigned builds. Verify availability in TestFlight or the signed Mac feed after delivery.
