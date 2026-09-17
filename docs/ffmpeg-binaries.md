# FFmpeg binaries and upgrades

Character consolidation uses `adelay:all=1` and `amix:normalize=0`. The previous
2018/2019 snapshots lack these options. The active baseline is now FFmpeg **4.4**,
not npm package version 4.4. This is a targeted compatibility upgrade, not a claim
that original 4.4 is the latest maintained release or that all builds are identical.

## Pinned sources

`src/utils/ffmpegBuilds.ts` is the source of truth for executable SHA-256 hashes,
actual FFmpeg versions, package versions (where applicable), download URLs, and
storage identities. Windows ARM64 resolves to the **Windows x64** entry, including
its hash and folder. There is no Windows ia32 fallback.

| Runtime | Active binary source | Actual FFmpeg | Old package folder | New folder under `globalStorage/ffmpeg/` |
| --- | --- | --- | --- | --- |
| Windows x64 / ARM64 fallback | ffmpeg-static b4.4 / Gyan | 4.4 | 4.1.0 | 4.4-b4.4-win32-x64 |
| macOS Intel | ffmpeg-static b4.4 / Evermeet | 4.4 | 4.1.0 | 4.4-b4.4-darwin-x64 |
| Linux x64 | ffmpeg-static b4.4 / John Van Sickle | 4.4 | 4.1.0 | 4.4-b4.4-linux-x64 |
| Linux ARM64 | ffmpeg-static b4.4 / John Van Sickle | 4.4 | 4.1.4 | 4.4-b4.4-linux-arm64 |
| Linux ARM32 | ffmpeg-static b4.4 / John Van Sickle | 4.4 | 4.1.3 | 4.4-b4.4-linux-arm |
| macOS Apple Silicon | Existing @ffmpeg-installer/darwin-arm64@4.1.5 | 4.4 | 4.1.5 | 4.4-installer-4.1.5-darwin-arm64 |

Replacement assets: https://github.com/eugeneware/ffmpeg-static/releases/tag/b4.4

The five replacement executables were downloaded from that pinned release and
hashed after gzip decompression. Their embedded version/configuration strings
identify 4.4, both filter options, libopus, and GPL version 3 or later. Legacy
hashes were computed from the executable in the exact `@ffmpeg-installer` npm
tarballs that the previous platform map pinned. These are reviewed content pins,
not a claim that the executable hashes have an independent upstream signature.

Apple Silicon deliberately retains its existing bytes/source. Its binary reports
`nonfree and unredistributable`. Do **not** mirror/re-publish it under our npm scope.
No binary or source archive is bundled or republished by this change. Any future
mirroring needs a per-build license review and complete corresponding source,
dependency sources, and build materials as required by the applicable licenses.
The other packages' GPL label alone does not complete that redistribution work.

## Storage and migration

- New folders identify FFmpeg version, supplier release and executable platform.
  Never infer actual FFmpeg version from an old npm-version folder.
- Scan the flat legacy executable, known old folders, and version-shaped folders.
  Hash before executing. Match only builds for the effective OS/architecture.
- Known obsolete binaries are deleted before installing or reusing the current
  build, even if placed in its folder. Removal failure aborts installation.
  Stale identity markers, recognized npm package metadata/readmes/licenses, and
  empty legacy folders are removed; unrelated files stay.
- Known current bytes move into their active folder without a download. This
  includes Apple Silicon's package 4.1.5, whose actual FFmpeg version is 4.4.
- Unknown/corrupt files are preserved under `quarantine/` with their original
  location recorded. Unrelated files and directories are left alone.
- `build.json` records the identity; `sha256.txt` is diagnostic only. Neither
  overrides the trusted hashes compiled into the extension.
- Download into a private staging directory, handle bounded HTTPS redirects and
  errors, hash the executable, check its version/filter options/encoders, then
  rename it into place. Failed staging directories are removed. Obsolete builds are not retained.
- Concurrent requests in one extension host share the install. Subsequent lookups
  use a verified cache with file identity/change detection. Tool reset, file
  deletion or modification invalidates that cache. Tools Status uses the same
  verification rules and does not download anything.
- If downloading fails after cleanup, no old executable remains as a fallback.
  Return unavailable so existing callers can use their
  limited audio fallback or report the unavailable export. Never silently use an
  old/bundled/system executable for a feature that needs newer filter options.

## Verification and future updates

Run `node scripts/test-ffmpeg.cjs` for offline migration/download tests.
Run `node scripts/test-ffmpeg.cjs --smoke` to download and execute the pinned build
for the current host. Optionally set `FFMPEG_TEST_BINARY` to an already downloaded
executable; its real hash is still checked and legacy migration is exercised.
The smoke test uses the same filter-graph builder as character export and checks
clip timing, output duration, amplitude and WAV/FLAC/Opus encoding/decoding.

Before changing a pin, inspect the exact platform artifact, hash its executable,
verify license/provenance, and run the smoke test on that OS/architecture. Add
the retired identity to `previous`, use a **new** storage identity, and preserve
the migration hashes. If only a URL changes to a mirror, the bytes/hash must stay
identical. Never update a hash merely to accept an unexpected upstream change.

Local execution on Apple Silicon does not validate Windows, Intel macOS or Linux
execution. The dedicated workflow exercises native downloads on its runner matrix;
Linux ARM32 and Windows ARM64 emulation still need a matching machine before
release. Existing codec/OS compatibility must be checked for any future upgrade.
