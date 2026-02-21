import * as vscode from "vscode";
import { getTimer } from "./extensionContext";

let timerBar: vscode.StatusBarItem | null = null;
let interval: NodeJS.Timeout | null = null;

export function startTimerBar() {
  stopTimerBar();

  const { startTime, durationSeconds } = getTimer();

  if (!startTime || !durationSeconds) {
    return;
  }

  timerBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    1000
  );

  updateText();
  timerBar.show();

  interval = setInterval(updateText, 1000);
}

export function stopTimerBar() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }

  if (timerBar) {
    timerBar.dispose();
    timerBar = null;
  }
}

function updateText() {
  if (!timerBar) {
    return;
  }

  const { startTime, durationSeconds } = getTimer();
  if (!startTime || !durationSeconds) {
    stopTimerBar();
    return;
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const remaining = durationSeconds - elapsed;

  if (remaining <= 0) {
    stopTimerBar();
    return;
  }

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  let timeString;

  if (hours > 0) {
    timeString = `${hours}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  } else {
    timeString = `${minutes}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  timerBar.text = `$(clock) Exam: ${timeString}`;
  timerBar.tooltip = "Remaining exam time";
}