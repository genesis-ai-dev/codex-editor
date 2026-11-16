# Coordinated project pin recovery

## Release contract

Ship the binary and both companion extensions together. Both extension manifests declare
`codexProjectPinPolicyVersion: 2`; this is a protocol capability, not a release version.
The binary advertises protocol version 1 through `codex.conductor.getPinPolicyStatus`.
On older binaries, the extensions preserve legacy pin behavior. Updating only extensions
cannot prevent an older binary from choosing a cached pinned profile before they run.

`product.json` selects the policy through `codexProjectPinPolicy`:

- `ignore`: native cold-open and reload paths replace conductor profiles
  with Default before the extension host loads. Editor removes only
  `meta.pinnedExtensions`; Frontier requests the Editor writer before staging/merging.
  Local, remote, admin and previously cached pins cannot select a pinned profile.
- `enforce` (the binary default): merge successfully verified remote decisions with
  local decisions independently for each extension, using their timestamps. Offline/authentication-unavailable discovery keeps the last accepted
  snapshot for the repository/branch, or local pins if none exists. No network error
  is converted into an unpin. Coordinated Frontier performs discovery before profile recovery. If discovery cannot
  finish within its deadline, recovery retains accepted/local pins and logs the fallback;
  a late verified result is still reconciled. An old Frontier cannot provide remote-unpin
  discovery, so the complete rollout still requires all three builds.

Changing the policy resets cached authority. Disabling ignore does not restore pins
already removed and committed; restore those intentionally through the normal workflow.
Each `meta.pinnedExtensions` entry carries a millisecond Unix `timestamp`. A pin also
contains `version` and `url`; an unpin contains only `timestamp`. Keep removal entries
so an older pin cannot return. There are no authors or change IDs.

The newer timestamp wins independently per extension; a timestamped decision beats
an unstamped entry or an absent entry. When neither side is stamped, the verified
remote wins (including legacy `{}`). Equal timestamps use the remote entry without
creating another edit. Readers accept legacy unstamped pins; writers migrate selected
legacy entries to timestamp `0` (unknown historical time), never to the time of sync.
New explicit edits use the clock, advancing past that extension's previous timestamp.
Fetching, merging and reloading preserve timestamps. Clock skew across disconnected
machines remains a limitation of timestamp ordering.

Git commit, origin, branch and request ordering still validate the source and reject
stale network replies. They do not override the per-extension timestamp comparison.
The stored decision map includes removals; profile identity, installation, pin icons,
and version gates use only active version/URL entries. Timestamp-only changes do not
reset recovery or schedule another reload. These semantics require all three new
builds; legacy binaries do not understand timestamp-only removal entries.

## Ownership and ordering

1. Native startup resolves the initial profile. In ignore mode, stale conductor profile
   associations cannot load pinned extensions first.
2. Editor registers its narrow metadata commands before awaiting recovery. Its queue
   orders extension operations and rejects dirty metadata buffers. Accepted remote-pin
   writes execute in the native shared process, serialized with snapshot acceptance across
   windows. Frontier can request the same native writer if Editor is not activated yet;
   this fallback also checks dirty buffers. There are no delayed extension-host pin writes.
3. In enforce mode, Frontier fetches the actual checked-out branch before the mismatch
   gate. Source discovery starts before authentication validation and Git download. Credential
   lookup and fetching are bounded separately. Invalid remote metadata pauses recovery;
   missing remote branches, local/non-Git projects, authentication absence and unavailable
   discovery retain applicable local/accepted policy. Non-project folders bypass discovery.
   Deadline fallback never synthesizes an empty remote snapshot.
4. The binary accepts only the latest request for the matching source, then the shared-process writer saves
   the per-extension merged decision map before Frontier asks for reconciliation. Discovery is shared
   across concurrent startup/sync requests and does not recursively wait on recovery.
5. The binary prepares and verifies the selected profile and running core extensions.
   Only the binary switches/reloads. Ignore mode checks capability as well as version,
   so replacing a package with the same release version does not fool the readiness check.
6. A persisted `preparing`/`switching` state that remains unsatisfied after restart blocks
   instead of retrying indefinitely. A changed decision invalidates old installations.
   Shared-process request ordering and transition leases coordinate windows for a workspace.
   A source change immediately fences in-flight work. Invalidation does not let another
   installer overlap an old installer that is still unwinding. Disconnect releases leases
   and rejects queued calls from the old renderer. Healthy running packages can recover
   from an earlier block without reinstalling or automatically reloading.

Project Update and metadata conflict resolution compare each extension's original
local and verified remote decisions, preserving the newer decision and its timestamp.
Unrelated metadata uses the existing merge rules. The cloned revision's provenance is
staged before opening, preventing old destination caches from replacing the decisions
saved in the updated project. Clone/fetch failure never supplies an empty snapshot.

Explicit administrator edits are stamped inside the shared-process writer queue after
re-reading metadata. Editing one extension does not replace another extension's decision.
Pending edits participate in timestamp comparison rather than bypassing the entire
remote map. Clear pending intent when the remote has published or superseded each edit.
Frontier persists merged decisions even when intent is pending, including after Git
fast-forwards and push retries. Pin Manager and CLI preserve indentation and line endings
and replace only the pin field. The CLI retains its existing Git conflict handling.

## Recovery and QA

Use **Codex: Retry Project Extension Recovery** after fixing missing packages or
connectivity. Retry is explicit; startup never schedules an endless reload timer.
Renderer disconnect automatically clears its transition ownership. A failed startup discovery can
be retried after fixing the input; successful discovery clears its transient failure. Extensions do not provide competing reload loops.

Automated tests exercise offline persistence, authoritative remote removal, malformed
responses, source/request changes, stale installs, interrupted transitions, same-version
legacy packages, multi-window arbitration and metadata byte preservation. Run
`node --test tests/pinPolicy.test.cjs` in each repository (using existing dependencies).
The binary test runner uses TypeScript from its existing `vscode/node_modules` checkout.

Before release, test actual packaged applications on supported platforms:

- Cold-open, Recent Projects, restored window, reload window, and extension-host restart
  with an existing pinned profile; ignore mode must start Default and persist `{}`.
- Upgrade both packages while a project is open, including same-version VSIX replacement;
  verify the running packages, no stale pin icon, and at most one automatic transition.
- Enforce mode: remote removal/partial deletion, offline with cached pins or cached `{}`,
  missing offline VSIX, expired authentication, malformed metadata, branch/origin change.
- Project Update and Swap with stale destination cache and local pins; preserve unrelated
  metadata and unpublished content. Cancel/fail a clone without altering policy.
- Concurrent sync/open, two windows, dirty metadata, interrupted installation, declined
  reload, and explicit retry. Failed recovery must remain actionable without a reload loop.
- Legacy binary plus new extensions must retain legacy behavior; it is not a coordinated
  unpin rollout. Old pinned Frontier packages cannot provide coordinated remote discovery.

These tests do not replace packaged Electron/profile testing. Filesystem writes from
external tools and other processes are outside the Editor's in-process metadata queue.
