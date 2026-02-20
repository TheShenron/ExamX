import * as dotenv from "dotenv";
dotenv.config();

import * as vscode from "vscode";
import { initState } from "./state";
import { registerCommands } from "./commands";
import { setContext } from "./extensionContext";
import { initStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext) {

  setContext(context);
  initState();
  initStatusBar();
  registerCommands();
}

export function deactivate() {
  // This function is intentionally empty because the extension does not require
  // any cleanup or resource deallocation when it is deactivated.
}
