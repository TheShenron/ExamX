import * as vscode from "vscode";
import { login } from "./auth";
import { stopSession } from "./session";
import { zipWorkspace } from "./zipper";
import { stopTimer } from "./timer";
import { setState } from "./state";
import { stopProctoring } from "./proctor";
import * as fs from "node:fs";
import { clearExamId, clearExamWorkspace, getContext, getExamWorkspace, resetToken, saveDriveId, saveExamId, saveExamWorkspacePath, saveTimer } from "./extensionContext";
import { api } from "./api/client";
import AdmZip from "adm-zip";
import * as path from "node:path";
import * as os from "node:os";
import { submitExam } from "./submission";

interface HiringDriveQuickPickItem extends vscode.QuickPickItem {
  examData: {
    name: string;
    code: string;
    id: string;
  };
}

interface ExamQuickPickItem extends vscode.QuickPickItem {
  examData: {
    name: string;
    duration: number,
    id: string;
    examZipFile: string
  };
}

export function writeExamWorkspaceSettings(tempFolder: string) {
  const vscodeDir = path.join(tempFolder, ".vscode");
  fs.mkdirSync(vscodeDir, { recursive: true });

  const settingsPath = path.join(vscodeDir, "settings.json");

  const settings = {
    // --- Copilot / AI ---
    "github.copilot.enable": false,
    "github.copilot.inlineSuggest.enable": false,
    "editor.inlineSuggest.enabled": false,

    // --- Reduce auto-help / auto-import ---
    "editor.suggestSelection": "first",
    "editor.quickSuggestions": false,
    "editor.parameterHints.enabled": false,
    "editor.suggestOnTriggerCharacters": false,

    // --- Disable auto code actions (can generate code) ---
    "editor.codeActionsOnSave": {},
    "editor.formatOnSave": false,

    // --- Disable extensions recommendations ---
    "extensions.ignoreRecommendations": true,

    // --- Stop auto installing extensions ---
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,

    // --- Optional: disable terminal suggestions ---
    "terminal.integrated.suggest.enabled": false,

    // --- Optional: disable chat extensions if installed ---
    "chat.commandCenter.enabled": false,

    // --- Optional: reduce distractions ---
    "breadcrumbs.enabled": false,
    "workbench.tips.enabled": false
  };


  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}


export function registerCommands() {
  const context = getContext();

  context.subscriptions.push(
    vscode.commands.registerCommand("exam.login", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Preparing Your Exam Session",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Authenticating your session" });
            await login(progress);

            progress.report({ message: "Loading your assigned exam sessions" });
            const { data: hiringDriveData } = await api.get(`/users/me/hiring-drives`);

            const hiringDrive = hiringDriveData?.data || [];

            if (!hiringDrive.length) {
              vscode.window.showWarningMessage(
                "No exam sessions are currently assigned to you"
              );
              return;
            }

            const hiringDriveItems: HiringDriveQuickPickItem[] = hiringDrive.map((item: any) => ({
              label: item.name,
              detail: `Code: ${item.code}`,
              examData: {
                name: item.name,
                code: String(item.code),
                id: item._id,
              },
            }));

            const selectedHiringDriveItems = await vscode.window.showQuickPick(hiringDriveItems, {
              placeHolder: "Select an exam session to continue",
              canPickMany: false,
            });

            if (!selectedHiringDriveItems) {
              vscode.window.showWarningMessage("An exam session must be selected to proceed");
              return;
            }

            progress.report({ message: "Fetching exams..." });
            const { data: examsData } = await api.get(
              `/users/me/hiring-drives-exam/${selectedHiringDriveItems.examData.id}`
            );

            const exams = examsData?.data || [];

            if (!exams.length) {
              vscode.window.showWarningMessage(
                "There are no exams available for the selected session"
              );
              return;
            }

            const examItems: ExamQuickPickItem[] = exams.map((item: any) => ({
              label: item.title,
              detail: `Duration: ${item.duration} minutes (${item.difficulty})`,
              examData: {
                name: item.title,
                duration: String(item.duration),
                examZipFile: item?.examZipFile || "",
                id: item._id,
              },
            }));

            const selectedExam = await vscode.window.showQuickPick(examItems, {
              placeHolder: "Select an exam to begin",
              canPickMany: false,
            });

            if (!selectedExam) {
              vscode.window.showWarningMessage("An exam must be selected to proceed");
              return;
            }

            progress.report({ message: "Setting up your exam workspace" });

            const buf = Buffer.from(selectedExam.examData.examZipFile, "base64");
            const zip = new AdmZip(buf);

            const baseFolder = path.join(os.tmpdir(), "vscode-exam");

            // Clean previous state
            if (fs.existsSync(baseFolder)) {
              fs.rmSync(baseFolder, { recursive: true, force: true });
            }

            fs.mkdirSync(baseFolder, { recursive: true });

            const tempFolder = path.join(baseFolder, `exam-${selectedExam.examData.name}`);
            fs.mkdirSync(tempFolder, { recursive: true });

            progress.report({ message: "SLaunching your exam" });

            await api.post(`/results/me/start`, {
              examId: selectedExam.examData.id,
              hiringDriveId: selectedHiringDriveItems.examData.id,
            });

            progress.report({ message: "Finalizing exam setup" });

            await saveExamWorkspacePath(tempFolder);
            await saveTimer(Date.now(), Number(selectedExam.examData.duration) * 60);
            await setState("examStarted");
            await saveExamId(selectedExam.examData.id);
            await saveDriveId(selectedHiringDriveItems.examData.id);

            progress.report({ message: "Processing exam files" });
            zip.extractAllTo(tempFolder, true);

            progress.report({ message: "Opening your exam workspace" });

            writeExamWorkspaceSettings(tempFolder);
            await vscode.commands.executeCommand(
              "vscode.openFolder",
              vscode.Uri.file(tempFolder),
              false
            );

            vscode.window.showInformationMessage("Exam workspace ready ✅");
          } catch (err: any) {
            console.log(err);
            vscode.window.showErrorMessage(err?.response?.data?.message || "Login failed!");
          }
        }
      );
    }),

    vscode.commands.registerCommand("exam.instructions", () => {
      const url = "https://www.linkedin.com/in/theshenron";
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand("exam.submit", async () => {
      await setState("submitting");
      await handleSubmit("manual");
    }),
  );
}

async function cleanupExamWorkspace() {
  const examPath = getExamWorkspace();
  if (!examPath) {
    return;
  }
  try {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.workspace.fs.delete(vscode.Uri.file(examPath), {
      recursive: true,
      useTrash: false
    });
  } catch (err) {
    console.error("We couldn’t reset the exam workspace", err);
  } finally {
    await clearExamWorkspace();
  }
}

export async function handleSubmit(mode: "manual" | "auto") {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Submitting your exam",
      cancellable: false,
    },
    async (progress) => {
      const context = getContext();
      let zip: string | null = null;

      try {
        progress.report({ message: "Ending your exam session" });

        stopTimer();
        stopSession();
        stopProctoring();

        progress.report({ message: "Setting up the exam environment" });

        zip = await zipWorkspace(context);

        if (!zip) {
          vscode.window.showErrorMessage(
            "Submission failed: We couldn't find the required file/folder in your workspace"
          );
          return;
        }

        // Single source of truth
        await submitExam(zip, progress);

        await setState("examSubmitted");

        const message =
          mode === "auto"
            ? "Time’s up! Your exam has been submitted automatically."
            : "Your exam has been submitted successfully.";

        vscode.window.showInformationMessage(message);
      } catch (err: any) {
        console.error("Error during submission:", err);

        // Mark as submitted? depends on your product rules.
        // Usually: do NOT mark submitted if submitExam() threw.
        // await setState("examSubmitted");

        const msg =
          err?.response?.data?.message ||
          err?.message ||
          "Submission failed due to an unexpected error.";

        vscode.window.showErrorMessage(msg);
      } finally {
        progress.report({ message: "Cleaning up..." });

        // Always delete zip
        if (zip) {
          try {
            fs.unlinkSync(zip);
          } catch (err) {
            console.warn("Failed to delete zip file:", err);
          }
        }

        // Always cleanup workspace + exam state
        try {
          await cleanupExamWorkspace();
          await clearExamId();
        } catch (err) {
          console.warn("Cleanup failed:", err);
        }

        resetToken();

        // NOTE:
        // If you want "loggedOut" always after submission attempt:
        await setState("loggedOut");
      }
    }
  );
}
