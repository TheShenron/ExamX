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

export function registerCommands() {
  const context = getContext();

  context.subscriptions.push(
    vscode.commands.registerCommand("exam.login", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Exam setup in progress...",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Logging in..." });
            await login(progress);

            progress.report({ message: "Fetching hiring drives..." });
            const { data: hiringDriveData } = await api.get(`/users/me/hiring-drives`);

            const hiringDrive = hiringDriveData?.data || [];
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
              placeHolder: "Select an Hiring Drive to continue",
              canPickMany: false,
            });

            if (!selectedHiringDriveItems) {
              vscode.window.showWarningMessage("No Hiring Drive selected");
              return;
            }

            progress.report({ message: "Fetching exams..." });
            const { data: examsData } = await api.get(
              `/users/me/hiring-drives-exam/${selectedHiringDriveItems.examData.id}`
            );

            const exams = examsData?.data || [];
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
              placeHolder: "Select an exam to continue",
              canPickMany: false,
            });

            if (!selectedExam) {
              vscode.window.showWarningMessage("No exam selected");
              return;
            }

            progress.report({ message: "Preparing exam workspace..." });

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

            progress.report({ message: "Starting exam..." });

            await api.post(`/results/me/start`, {
              examId: selectedExam.examData.id,
              hiringDriveId: selectedHiringDriveItems.examData.id,
            });

            progress.report({ message: "Saving exam state..." });

            await saveExamWorkspacePath(tempFolder);
            await saveTimer(Date.now(), Number(selectedExam.examData.duration) * 60);
            await setState("examStarted");
            await saveExamId(selectedExam.examData.id);
            await saveDriveId(selectedHiringDriveItems.examData.id);

            progress.report({ message: "Extracting exam files..." });
            zip.extractAllTo(tempFolder, true);

            progress.report({ message: "Opening workspace..." });

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
      const url = "https://github.com/TheShenron";
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
    console.error("Failed to cleanup exam workspace", err);
  } finally {
    await clearExamWorkspace();
  }
}

export async function handleSubmit(mode: "manual" | "auto") {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Submitting exam...",
      cancellable: false,
    },
    async (progress) => {
      const context = getContext();
      let zip: string | null = null;

      try {
        progress.report({ message: "Stopping exam session..." });

        stopTimer();
        stopSession();
        stopProctoring();

        progress.report({ message: "Preparing workspace..." });

        zip = await zipWorkspace(context);

        if (!zip) {
          vscode.window.showErrorMessage(
            "Submission failed: 'src' folder not found in workspace."
          );
          return;
        }

        // Single source of truth
        await submitExam(zip, progress);

        await setState("examSubmitted");

        const message =
          mode === "auto"
            ? "Exam auto-submitted successfully."
            : "Exam submitted successfully.";

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
