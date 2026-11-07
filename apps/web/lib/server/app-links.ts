/** AASA is intentionally public and contains no user data or authentication secrets. */
export function appSiteAssociation(
  ids = process.env.DOOMPILE_APPLE_APP_IDS || "",
) {
  const appIDs = [
    ...new Set(
      ids
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]+$/.test(id)),
    ),
  ];
  return {
    applinks: {
      apps: [],
      details: appIDs.length
        ? [
            {
              appIDs,
              components: [
                {
                  "/": "/notes/*",
                  comment:
                    "Open a Doompile note; all other routes remain in the browser.",
                },
              ],
            },
          ]
        : [],
    },
  };
}
