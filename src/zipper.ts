import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { zip } from "compressing";
import os from "node:os";

export async function zipWorkspace(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!root) {
    throw new Error("No workspace folder found");
  }

  const srcPath = path.join(root, "src");
  if (!fs.existsSync(srcPath)) {
    vscode.window.showErrorMessage(
      "Submission failed: We couldn't find the required folder/file in your workspace."
    );
    return null;
  }

  const zipPath = path.join(os.tmpdir(), "submission.zip");

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  await zip.compressDir(srcPath, zipPath);

  return zipPath;
}
