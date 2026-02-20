import * as vscode from "vscode";
import { api } from "./api/client";
import { setToken } from "./extensionContext";

export async function login(progress?: vscode.Progress<{ message?: string }>) {
  const email = await vscode.window.showInputBox({
    prompt: "Email",
    ignoreFocusOut: true,
  });

  if (!email) {
    throw new Error("Please enter a valid email address");
  }

  const testCode = await vscode.window.showInputBox({
    prompt: "Enter your exam access code",
    password: true,
    ignoreFocusOut: true,
  });

  if (!testCode) {
    throw new Error("Please enter a valid exam code");
  }

  progress?.report({ message: "Authenticating your session" });

  const { data: loginData } = await api.post("/users/login", {
    email,
    password: testCode,
  });

  progress?.report({ message: "Finalizing your session" });
  await setToken(loginData.data.token);
}
