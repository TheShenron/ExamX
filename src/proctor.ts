import * as vscode from "vscode";
import { recordEvent } from "./session";
import crypto from "node:crypto";
import { getContext } from "./extensionContext";

let proctoringDisposable: vscode.Disposable | null = null;
let codeHashes = new Set<string>();

export function startProctoring() {
  const context = getContext();
  // 🔒 Prevent double start
  if (proctoringDisposable) {
    return;
  }

  // ✅ Initialize hashes ONLY after login
  codeHashes.clear();
  vscode.workspace.textDocuments.forEach((doc) => {
    const hash = crypto
      .createHash("sha256")
      .update(doc.getText())
      .digest("hex");
    codeHashes.add(hash);
  });

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document !== event.document) {
        return;
      }

      // Detect paste
      const isPaste = event.contentChanges.some(
        (change) =>
          change.text.length > 1 &&
          editor.selections.length === event.contentChanges.length,
      );

      if (isPaste) {
        recordEvent("PASTE");
      }

      // Detect large inserts / new code
      event.contentChanges.forEach((change) => {
        if (change.text.length > 50) {
          const pasteHash = crypto
            .createHash("sha256")
            .update(change.text)
            .digest("hex");

          const newCode = !codeHashes.has(pasteHash);

          recordEvent("LARGE_INSERT", {
            len: change.text.length,
            newCode,
          });

          if (newCode) {
            codeHashes.add(pasteHash);
          }
        }
      });
    }),

    vscode.window.onDidChangeWindowState((state) => {
      recordEvent(state.focused ? "FOCUS_GAINED" : "FOCUS_LOST");
    }),
  );

  proctoringDisposable = vscode.Disposable.from(...disposables);
  context.subscriptions.push(proctoringDisposable);
}

export function stopProctoring() {
  proctoringDisposable?.dispose();
  proctoringDisposable = null;
  codeHashes.clear();
}
