import * as path from "path";
import glob from "glob";
import Mocha = require("mocha");

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
    });

    const testsRoot = path.resolve(__dirname, "..");
    return new Promise((resolve, reject) => {
        // @ts-expect-error - glob is not typed or something is wrong with the types package
        glob("**/**.test.js", { cwd: testsRoot }, (err: Error | null, files: string[]) => {
            if (err) {
                reject(err);
            } else {
                files.forEach((file: string) => {
                    mocha.addFile(path.resolve(testsRoot, file));
                });

                try {
                    // Run the mocha test
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            reject(new Error(`${failures} tests failed.`));
                        } else {
                            resolve();
                        }
                    });
                } catch (err) {
                    console.error(err);
                    reject(err);
                }
            }
        });
    });
}
