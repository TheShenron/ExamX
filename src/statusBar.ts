import * as vscode from "vscode";
import { subscribe } from "./state";
import { ExamState, getContext, getExamState } from "./extensionContext";

let loginButton: vscode.StatusBarItem;
let submitButton: vscode.StatusBarItem;
let instructionButton: vscode.StatusBarItem;

export function initStatusBar() {
  const context = getContext();
  loginButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  loginButton.text = "$(sign-in) Login";
  loginButton.tooltip = "Click to login to exam";
  loginButton.command = "exam.login";
  context.subscriptions.push(loginButton);

  submitButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );
  instructionButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  instructionButton.text = "$(account) Join the Network";
  instructionButton.tooltip = "Connect with me on LinkedIn";

  instructionButton.command = "exam.instructions";
  context.subscriptions.push(instructionButton);
  instructionButton.show();

  submitButton.text = "$(check) Submit Exam";
  submitButton.tooltip = "Click to submit the exam";
  submitButton.command = "exam.submit";
  context.subscriptions.push(submitButton);

  // Subscribe to state changes
  subscribe(updateButtons);

  // Initial render
  const state = getExamState();
  updateButtons(state || "loggedOut");
}

function updateButtons(state: ExamState) {
  loginButton.hide();
  submitButton.hide();

  switch (state) {
    case "loggedIn":
    case "examStarted":
      submitButton.show();
      submitButton.command = "exam.submit";
      submitButton.text = "$(check) Submit Exam";
      submitButton.tooltip = "Click to submit the exam";
      break;

    case "submitting":
      submitButton.show();
      submitButton.command = undefined; // disables click
      submitButton.text = "$(sync~spin) Submitting...";
      submitButton.tooltip = "Submitting exam... Please wait";
      break;

    case "loggedOut":
    case "examSubmitted":
      loginButton.show();
      break;
  }
}
