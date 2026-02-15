import * as vscode from "vscode";
import * as cp from "node:child_process";

type TestResult = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
};

function extractJsonFromOutput(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) { return null; }

  const possibleJson = text.slice(start, end + 1).trim();

  if (!possibleJson.startsWith("{") || !possibleJson.endsWith("}")) { return null; }

  return possibleJson;
}

export function runTests(): Promise<TestResult> {
  return new Promise((resolve, reject) => {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspacePath) {
      return reject(new Error("No workspace folder found."));
    }

    const cmd = "npm run test";

    let fullOutput = "";

    const child = cp.exec(cmd, { cwd: workspacePath }, (err) => {
      // even if err exists, we still try to parse JSON
      const jsonString = extractJsonFromOutput(fullOutput);

      if (!jsonString) {
        return reject(
          new Error("Test finished but JSON output was not found.")
        );
      }

      try {
        const parsed = JSON.parse(jsonString) as TestResult;

        // If test command failed and JSON says failed > 0, we still return parsed
        // If test command failed but JSON says failed = 0, still treat as passed
        resolve(parsed);
      } catch {
        return reject(new Error("Test finished but JSON output was invalid."));
      }
    });

    child.stdout?.on("data", (data) => {
      const text = data.toString();
      fullOutput += text;
      console.log(text);
    });

    child.stderr?.on("data", (data) => {
      const text = data.toString();
      fullOutput += text;
      console.error(text);
    });
  });
}