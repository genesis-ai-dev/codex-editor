/**
 * Pinned binary identities, not npm-version comparisons. Hashes are SHA-256 of
 * the executable bytes (after decompression), verified from the original assets.
 * See docs/ffmpeg-binaries.md for provenance and the update procedure.
 */
export interface FfmpegBuild {
    readonly id: string;
    /** Architecture of the executable, including when used via emulation. */
    readonly platform: string;
    readonly ffmpegVersion: string;
    readonly packageVersion?: string;
    readonly storageVersion: string;
    readonly legacyStorageVersions?: readonly string[];
    readonly sha256: string;
    readonly license: string;
    readonly download?: { readonly url: string; readonly format: "gzip" | "tgz" };
}

export interface FfmpegPlatformBuilds {
    readonly current: FfmpegBuild;
    readonly previous: readonly FfmpegBuild[];
}

export const FFMPEG_BUILDS: readonly FfmpegPlatformBuilds[] = [
    {
        "current": {
            "id": "ffmpeg-static-b4.4-win32-x64",
            "platform": "win32-x64",
            "ffmpegVersion": "4.4",
            "storageVersion": "4.4-b4.4-win32-x64",
            "sha256": "8d7e6cf86ba7e0462643d3cc3745455adca6c9af5795574d67d125ae238296b2",
            "license": "GPL-3.0-or-later",
            "download": {
                "url": "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/win32-x64.gz",
                "format": "gzip"
            }
        },
        "previous": [
            {
                "id": "installer-4.1.0-win32-x64",
                "platform": "win32-x64",
                "ffmpegVersion": "N-92722-gf22fcd4483",
                "packageVersion": "4.1.0",
                "storageVersion": "4.1.0",
                "sha256": "c8abc49e7be62dde8e12972af373959e0076a7b8dc8040eb45978e0608f8781e",
                "license": "See original package/build license"
            }
        ]
    },
    {
        "current": {
            "id": "ffmpeg-static-b4.4-darwin-x64",
            "platform": "darwin-x64",
            "ffmpegVersion": "4.4",
            "storageVersion": "4.4-b4.4-darwin-x64",
            "sha256": "d4e40ea2735470a44aca6e350544532d6c1e5ca69178693ecfcee6e4e1f05d9a",
            "license": "GPL-3.0-or-later",
            "download": {
                "url": "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/darwin-x64.gz",
                "format": "gzip"
            }
        },
        "previous": [
            {
                "id": "installer-4.1.0-darwin-x64",
                "platform": "darwin-x64",
                "ffmpegVersion": "N-92718-g092cb17983-tessus",
                "packageVersion": "4.1.0",
                "storageVersion": "4.1.0",
                "sha256": "69bddbabda0d4fbedf98fb01b6f964ee1c8346987ef7f6e70055b95339a78b17",
                "license": "See original package/build license"
            }
        ]
    },
    {
        "current": {
            "id": "ffmpeg-static-b4.4-linux-x64",
            "platform": "linux-x64",
            "ffmpegVersion": "4.4",
            "storageVersion": "4.4-b4.4-linux-x64",
            "sha256": "f406a5eb9cd03ed776fb215096dc52a1a401798b75ab72627ae82f367c9e714e",
            "license": "GPL-3.0-or-later",
            "download": {
                "url": "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-x64.gz",
                "format": "gzip"
            }
        },
        "previous": [
            {
                "id": "installer-4.1.0-linux-x64",
                "platform": "linux-x64",
                "ffmpegVersion": "N-47683-g0e8eb07980-static",
                "packageVersion": "4.1.0",
                "storageVersion": "4.1.0",
                "sha256": "6d0c625dbd3f604ed2618981ba6fee7e29678855ab741d654cfc9effb0226624",
                "license": "See original package/build license"
            }
        ]
    },
    {
        "current": {
            "id": "ffmpeg-static-b4.4-linux-arm64",
            "platform": "linux-arm64",
            "ffmpegVersion": "4.4",
            "storageVersion": "4.4-b4.4-linux-arm64",
            "sha256": "1d339661c6c5b8a4a728f731a66203211832fd7f49bcd4768ea2dd54ad4499f6",
            "license": "GPL-3.0-or-later",
            "download": {
                "url": "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-arm64.gz",
                "format": "gzip"
            }
        },
        "previous": [
            {
                "id": "installer-4.1.4-linux-arm64",
                "platform": "linux-arm64",
                "ffmpegVersion": "N-49006-gd81913e680-static",
                "packageVersion": "4.1.4",
                "storageVersion": "4.1.4",
                "sha256": "115a825e246078acf820ea2afcaf1b3ff87f1b93f7035ecad38d3223cca55297",
                "license": "See original package/build license"
            }
        ]
    },
    {
        "current": {
            "id": "ffmpeg-static-b4.4-linux-arm",
            "platform": "linux-arm",
            "ffmpegVersion": "4.4",
            "storageVersion": "4.4-b4.4-linux-arm",
            "sha256": "d80cdbcc64241600bf4f2656a94ef166d4a94b0e157e8701f17edb28df91c234",
            "license": "GPL-3.0-or-later",
            "download": {
                "url": "https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-arm.gz",
                "format": "gzip"
            }
        },
        "previous": [
            {
                "id": "installer-4.1.3-linux-arm",
                "platform": "linux-arm",
                "ffmpegVersion": "N-49006-gd81913e680-static",
                "packageVersion": "4.1.3",
                "storageVersion": "4.1.3",
                "sha256": "a3ff69b5959ed713e3316dbe2ad5b219e230312d7092339ac0be7e20d35dd2ee",
                "license": "See original package/build license"
            }
        ]
    },
    {
        "current": {
            "id": "installer-4.1.5-darwin-arm64",
            "platform": "darwin-arm64",
            "ffmpegVersion": "4.4",
            "packageVersion": "4.1.5",
            "storageVersion": "4.4-installer-4.1.5-darwin-arm64",
            "sha256": "a2ad6f0fc42a3c8f5183ef1d53e906d6bb35478d14a6b67175c30ce6c17e9214",
            "license": "nonfree (do not redistribute)",
            "legacyStorageVersions": [
                "4.1.5"
            ],
            "download": {
                "url": "https://registry.npmjs.org/@ffmpeg-installer/darwin-arm64/-/darwin-arm64-4.1.5.tgz",
                "format": "tgz"
            }
        },
        "previous": []
    }
];

/** Preserve the existing Windows ARM64 -> x64 emulation fallback. No ia32 fallback. */
export function resolveFfmpegBuilds(platform = process.platform as string, arch = process.arch as string): FfmpegPlatformBuilds | undefined {
    const requested = `${platform}-${arch}`;
    const effective = requested === "win32-arm64" ? "win32-x64" : requested;
    return FFMPEG_BUILDS.find(({ current }) => current.platform === effective);
}

export function ffmpegExecutableName(build: FfmpegBuild): string {
    return build.platform.startsWith("win32-") ? "ffmpeg.exe" : "ffmpeg";
}

/** Never use a local marker or directory name as proof of binary identity. */
export function identifyFfmpegBuild(builds: FfmpegPlatformBuilds, sha256: string): FfmpegBuild | undefined {
    return [builds.current, ...builds.previous].find(build => build.sha256 === sha256);
}
