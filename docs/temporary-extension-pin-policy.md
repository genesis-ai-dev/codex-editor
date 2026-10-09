# Temporary extension pin policy

Codex Editor and Frontier Authentication temporarily disable project extension
version pins without changing the Codex application. Existing metadata is normalized
to `meta.pinnedExtensions: {}`. Minimum `requiredExtensions` checks still apply.

The editor waits for pending metadata writes, clears the destination's pins, and
awaits the save before opening it from Startup Flow (including update, restore,
and swap paths). On Codex, it passes the existing `forceProfile: "Default"`
openFolder option to override a saved pinned-profile association. Frontier delegates
opening to the editor and fails closed if that command is unavailable. Missing
metadata is allowed for non-project folders. Invalid metadata, unsaved edits, and
save failures stop opening.

On activation the editor saves empty pins, clears the current workspace's remote
pin cache and admin intent using existing commands, then invokes the existing
Default profile action by stable ID. Storage paths cannot identify the active
profile: the application supplies Default's global storage path to every local
extension host. Recovery instead runs once per workspace and installed extension
version pair, and again when activation removes new metadata or cached pins.
This covers VSIX, update-button and automatic-update restarts through the same path.
Activation returns before the deferred action stops its host. The next host consumes
a pending marker and reloads the window once to clear stale renderer notifications.
If the profile action is a no-op, the original host finishes that reload instead.
The completed marker prevents ordinary reloads from repeating the migration.
Neither extension sends synthetic sync-completion signals during cleanup. Cache
removals can still cause a binary notification before recovery finishes. Failed
cleanup still blocks activation to avoid loading unsafe metadata. An unavailable or
incompatible Default profile only defers migration: the updated extensions keep
loading in the current profile, without an error popup or another restart action.
A deferred migration is retried on the next activation. Its existing profile name
and icon can remain until a safe switch is possible. Frontier remains available.

Frontier ignores incoming pins in remote compatibility checks. Git sync removes
pins before committing local changes, before committing resolved merges, and after
fast-forwards (including push retries). Fast-forward cleanup commits only metadata;
unrelated staged changes block that commit. Editor metadata writes and its metadata
merge resolver also enforce the empty map. Frontier always delegates cleanup to
the editor's serialized writer. An older/missing editor blocks project opening and
sync with an update/reload message; Frontier never writes metadata as a fallback.
Pin cleanup edits only the pin value in the original JSON text, preserving all
other bytes. Merge read/compute/write operations share the editor's metadata queue;
normal merge rules still decide legitimate changes to other fields.
Cleanup commits inspect HEAD, so an already-saved pin removal is still committed.
Already empty pin maps do not cause repeated cleanup writes or commits.

## Paired installation

Install the updated Editor and Frontier builds together into Default. Different
installed copies can share version numbers; another profile can therefore load
an older Frontier implementation and forward remote pins again.
The editor now requires Frontier's `codexProjectPinPolicyVersion: 1` manifest
capability before opening/loading projects under this policy. Version numbers
alone are not accepted as proof of compatible behavior. Before switching, the editor
also checks the packages selected by Default's desktop extension registry, so a
correct sideload in another profile cannot silently switch back to older code.
That current profile may keep loading while Default is incompatible. Explicit
project-list opening still requires a compatible Default because the destination
can otherwise select an older saved profile.
This registry is read only; installations use the application's normal installer. Existing pinned-profile
installations also need the updated pair before their next extension restart.

## Limits

The extensions cannot run before the application's startup code, clear another
workspace's private caches, or cancel an already-running binary pin installation.
Forcing Default on project-list opening avoids the saved association, but an old
remote cache or in-flight binary operation can still race extension activation.
The activation recovery corrects the profile when it runs; this is not a permanent
binary-level prohibition on pins. Direct OS/recent-project opening can initially
load the previously associated profile. An old pinned editor that lacks this
recovery must first be replaced with the updated editor in that profile.
The opening override uses the English Default profile name; activation recovery
uses the language-independent profile ID. Stock VS Code keeps its existing profile.

## Feature flag and rollback

`EXTENSION_PIN_POLICY.ignoreProjectPins` defaults to `true` in
`sharedUtils/extensionPinFeatureFlag.ts` (Editor) and
`src/utils/extensionPinFeatureFlag.ts` (Frontier). This is a release-time flag,
not a workspace setting. Set it to `false` in **both** extensions, rebuild and
release both together, then reload the extension host. Mixed flag states are not
supported.

When disabled, no profile switch or opening override is performed. Cleanup does not read/write metadata, clear Conductor caches,
require the editor cleanup command, or create cleanup commits. Merge policy is
bypassed. Original activation and sync pin gates, remote pin forwarding and
pin-aware minimum-version ratchets are restored. Ordinary metadata write queue
and error-handling fixes remain. Already removed pins are not recreated; restore
those separately from project history if needed.

Each extension's implementation is a single commit for independent Git reverts.
There are no timestamp fields, empty-version tombstones, or schema migrations.

Regression coverage lives in the editor's `metadataManager.test.ts` and Frontier's
`extensionPins.test.ts`, including save-before-open failure handling, preservation
of unrelated fields, cached-state commands, and Git persistence of pin removal.
