import * as vscode from "vscode";
import * as cp from "node:child_process";

export type TestResult = {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
};

const JSON_START = "__TEST_RESULT_JSON_START__";
const JSON_END = "__TEST_RESULT_JSON_END__";

/**
 * Extracts JSON safely using markers.
 * This is MUCH safer than "first { ... last }".
 */
function extractJsonBetweenMarkers(output: string): string | null {
    const startIdx = output.indexOf(JSON_START);
    const endIdx = output.indexOf(JSON_END);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        return null;
    };

    const json = output
        .slice(startIdx + JSON_START.length, endIdx)
        .trim();

    if (!json.startsWith("{") || !json.endsWith("}")) {
        return null;
    };

    return json;
}

/**
 * Runs npm test and expects the test runner to print:
 *
 * __TEST_RESULT_JSON_START__
 * {...}
 * __TEST_RESULT_JSON_END__
 *
 * If your test runner currently prints raw JSON, you can update it to wrap output.
 */
export async function runTests(): Promise<TestResult> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspacePath) {
        throw new Error("No workspace folder found.");
    }

    return new Promise((resolve, reject) => {
        const child = cp.spawn("npm", ["run", "test"], {
            cwd: workspacePath,
            shell: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
        });

        let fullOutput = "";

        child.stdout?.on("data", (buf) => {
            const text = buf.toString();
            fullOutput += text;
            console.log(text);
        });

        child.stderr?.on("data", (buf) => {
            const text = buf.toString();
            fullOutput += text;
            console.error(text);
        });

        child.on("error", (err) => reject(err));

        child.on("close", () => {
            const jsonString = extractJsonBetweenMarkers(fullOutput);

            if (!jsonString) {
                return reject(
                    new Error(
                        `Tests finished but JSON output was not found.\n\n` +
                        `Expected markers:\n${JSON_START}\n...\n${JSON_END}`
                    )
                );
            }

            try {
                const parsed = JSON.parse(jsonString) as TestResult;

                if (
                    typeof parsed.total !== "number" ||
                    typeof parsed.passed !== "number" ||
                    typeof parsed.failed !== "number"
                ) {
                    return reject(new Error("Test JSON structure was invalid."));
                }

                resolve(parsed);
            } catch {
                reject(new Error("Test finished but JSON output was invalid."));
            }
        });
    });
}
