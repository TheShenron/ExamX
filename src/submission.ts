import * as vscode from "vscode";
import { session } from "./session";
import { getGitLogs } from "./gitLogger";
import { getDriveId, getExamId } from "./extensionContext";
import { api } from "./api/client";
import { runTests, TestResult } from "./testRunner";
import fs from 'node:fs';
import FormData = require("form-data");


export type SubmissionResult = {
    resultId: string;
    testResult: TestResult | null;
    isPassed: boolean;
    score: number;
};

function computeScore(testResult: TestResult | null) {
    if (!testResult) {
        return { isPassed: false, score: 0 };
    };

    const isPassed = testResult.failed === 0;

    const score =
        testResult.total > 0
            ? Math.round((testResult.passed / testResult.total) * 100)
            : 0;

    return { isPassed, score };
}

/**
 * Always pushes git logs into session.events
 */
async function pushGitLogsEvent() {
    const gitLogs = await getGitLogs();
    session.events.push({
        type: "gitLogs",
        timestamp: Date.now(),
        meta: { gitLogs },
    });
}

/**
 * This is the ONLY function that:
 * - runs tests
 * - submits results
 * - uploads proctoring events
 *
 * handleSubmit() should NEVER call API directly.
 */
export async function submitExam(
    zipPath: string,
    progress?: vscode.Progress<{ message?: string }>
): Promise<SubmissionResult> {
    const examId = getExamId();
    const driveId = getDriveId();

    if (!examId || !driveId) {
        throw new Error("Missing examId or hiringDriveId.");
    }

    let testResult: TestResult | null = null;

    // ---- 1) Run tests (but do NOT abort submission if tests runner crashes)
    progress?.report({ message: "Validating your solution" });

    try {
        testResult = await runTests();
    } catch (err) {
        console.warn("Tests failed to run or parse. Submitting as failed.", err);
        testResult = null;
    }

    const { isPassed, score } = computeScore(testResult);

    // ---- 2) Collect git logs
    progress?.report({ message: "Collecting git logs..." });
    await pushGitLogsEvent();

    // ---- 3) Submit result
    progress?.report({ message: "Retrieving commit history" });

    const zipBuffer = fs.readFileSync(zipPath);

    const form = new FormData();

    form.append("examId", examId);
    form.append("hiringDriveId", driveId);
    form.append("isPassed", String(isPassed));
    form.append("score", String(score));

    form.append("resultZipFile", zipBuffer, {
        filename: "submission.zip",
        contentType: "application/zip",
    });

    const { data: submitExamResp } = await api.post(`/results/me/submit`, form, {
        headers: { "Content-Type": "multipart/form-data" },
    });

    const resultId = submitExamResp?.data?._id;

    if (!resultId) {
        throw new Error("Submit API succeeded but no resultId was returned.");
    }

    // ---- 4) Upload proctoring events (best effort)
    progress?.report({ message: "Finalizing exam session data" });

    try {
        await api.post(`/results/${resultId}/proctoring`, {
            events: session.events,
        });
    } catch (err) {
        // In prod: do NOT fail the whole submission if proctoring upload fails.
        console.error("Proctoring upload failed (best effort):", err);
    }

    progress?.report({ message: "Finalizing your submission" });

    return {
        resultId,
        testResult,
        isPassed,
        score,
    };
}
