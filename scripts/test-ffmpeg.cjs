// Run the filesystem/download tests without launching VS Code or downloading binaries.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Mocha = require("mocha");
// Only the host-facing manager tests need these two VS Code boundaries.
const Module = require("node:module");
const originalLoad = Module._load;
const vscode = { __esModule: true, window: { withProgress: () => {} }, ProgressLocation: { Notification: 15 } };
const preferences = { __esModule: true, getAudioToolMode: () => "auto" };
Module._load = function (request, parent, isMain) {
    if (request === "vscode") { return vscode; }
    if (request.endsWith("/toolPreferences")) { return preferences; }
    return originalLoad.call(this, request, parent, isMain);
};
if (process.argv.includes("--smoke")) { process.env.CODEX_FFMPEG_SMOKE = "1"; }

require.extensions[".ts"] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(result.outputText, filename);
};
const mocha = new Mocha({ ui: "tdd", timeout: 10000 });
mocha.addFile(path.resolve(__dirname, "../src/test/suite/audio/ffmpegStorage.test.ts"));
mocha.addFile(path.resolve(__dirname, "../src/test/suite/audio/ffmpegDownload.test.ts"));
mocha.addFile(path.resolve(__dirname, "../src/test/suite/audio/ffmpegManager.test.ts"));
mocha.addFile(path.resolve(__dirname, "../src/test/suite/audio/ffmpegSmoke.test.ts"));
mocha.run(failures => { process.exitCode = failures ? 1 : 0; });
