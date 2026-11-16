# Native autosave conflict regression

Candidate branch: `fix/native-autosave-conflicts`, based on `bd68887`.

The shared native store wrote the editor's old revision back to SQLite even after
acknowledging its preceding save. The next autosave could therefore conflict with
the same client's own edit. A genuine conflict also left the active editor bound
to the original ID, allowing subsequent typing to create more conflict copies.

The candidate retains the local writer through upload checkpoints and save
acknowledgements. It rebases that writer's queued edits while remote merges and
other processes' acknowledged writes retain revision conflict protection.
Provenance uses a separate SQLite table keyed by the note row version, preserving
the installed four-column notes schema and invalidating provenance after older
extensions write. Stale conflict responses do not fork newer queued revisions.

After a genuine conflict, the active iOS/Mac editor follows the preserved local
copy, retains unsaved typing, reconciles uploaded media URLs and moves its durable
draft. On Mac, the selected feed row follows the copy without recreating the
editor. The copy is queued for delivery immediately. Existing user copies are
untouched. The embedded editor's note-link context follows the copy's ID without
replacing its document.

## Validation

- `mise exec -- npm ci` and `npm run shared:generate` completed.
- `./infra/ops check` passed, including web/core/editor/clipper tests,
  infrastructure tests and the production build.
- Mac project-generation Python tests passed (5 tests).
- Swift 6.2.1 syntax parsing passed for all changed iOS/Mac Swift files.
- 33 shared model/storage XCTest cases passed in an isolated Linux Swift harness.
  The harness copies the actual model, SQLite and Storage implementations;
  only Apple account/telemetry seams and the Darwin import are adapted. Apple
  account-origin and image-type tests are excluded. This does not validate the
  Apple SDK application targets or the native UI. Logs and harness are in
  `.agents/local/autosave-conflict-review/` (ignored).
- As a negative control, removing only the autosave rebase block from the harness
  makes the repeated-autosave regression fail: it resends revision 1 when the
  acknowledged base is 2 and above. The fixed source was restored afterward.
- New Swift regression cases cover repeated stale autosaves, typing during
  acknowledgements, upload checkpoints, remote edits, other processes, stale
  conflict responses, continued typing on one conflict copy, attachment URL
  reconciliation and compatibility with older SQLite writers.
- Native XCTest, application builds and design review remain pending. The Linux
  devbox cannot run the Apple SDK, and the configured setec origin is unreachable,
  preventing credentialed CI dispatch and delivery. No merge or release has been
  performed.

## Required native design review

Review the actual candidate on iPhone and Mac with synthetic notes. Capture an
open editor before and after a conflict, unsaved typing during its response,
continued autosaves, the feed with exactly one local conflict branch and the
preserved remote branch, closing/reopening both notes, and a local attachment
whose upload completes during editing. Verify Mac row selection and navigation
back to the remote branch and copying a link to the continued local branch from
both native and embedded-editor controls. Inspect intermediate frames of the existing feed
transition and verify that editor focus, caret and typed text survive.

Keep the candidate on its branch until native checks and these captures have
been inspected. Then merge and let the normal pipeline deliver production,
TestFlight and Mac updates, verifying actual availability.
