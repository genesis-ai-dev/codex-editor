import { DownloadedResource } from "../obs/resources/types";

import * as vscode from "vscode";
import { OBSRef } from "../../../types";
import {
    directoryExists,
    fileExists,
} from "../obs/CreateProject/utilities/obs";
import {
    parseObsTsv,
    tsvToStoryParagraphRef,
} from "../obsTranslationNotes/tsv";

type ObsTranslationQuestion = {
    Question: string;
    Response: string;
    Reference: string;
    ID: string;
    Tags: string;
    Quote: string;
};

export const getObsStoryParagraphTranslationQuestions = async (
    resource: DownloadedResource,
    ref: OBSRef,
) => {
    if (!vscode.workspace.workspaceFolders?.[0]) {
        console.error("No workspace is open. Please open a workspace.");
        return;
    }
    const resourceDirUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0].uri as vscode.Uri,
        resource.localPath,
    );

    const tqTsvUri = vscode.Uri.joinPath(resourceDirUri, `tq_OBS.tsv`);

    if (await fileExists(tqTsvUri)) {
        const tqTsvContent = await vscode.workspace.fs.readFile(tqTsvUri);

        const tsvContentString = tqTsvContent.toString();

        const tsvData = parseObsTsv<ObsTranslationQuestion>(tsvContentString);

        const storyParagraph = tsvToStoryParagraphRef(tsvData);

        const questions =
            storyParagraph[Number(ref.storyId).toString()]?.[ref.paragraph];

        return questions ?? [];
    }

    const contentDirUri = vscode.Uri.joinPath(resourceDirUri, "content");

    if (await directoryExists(contentDirUri)) {
        const storyNoteUri = vscode.Uri.joinPath(
            contentDirUri,
            Number(ref.storyId).toString().padStart(2, "0"),
            `${Number(ref.paragraph).toString().padStart(2, "0")}.md`,
        );

        const storyParagraphQuestionsExists = await fileExists(storyNoteUri);

        if (storyParagraphQuestionsExists) {
            const questionContent =
                await vscode.workspace.fs.readFile(storyNoteUri);

            const questionsMd = parseMarkdown(questionContent.toString());
            return questionsMd.map((qa) => ({
                Question: qa.question,
                Response: qa.response,
                Reference: `${ref.storyId}:${ref.paragraph}`,
                ID: "",
                Tags: "",
                Quote: "",
            }));
        }
    }

    vscode.window.showErrorMessage(
        `No translation Questions found on Resource`,
    );

    return [];
};

type QA = {
    question: string;
    response: string;
};

function parseMarkdown(markdownContent: string): QA[] {
    // Regular expression to match headers and capture the text following them
    const regex = /#\s+(.*?)(?=#\s+|$)/gs;
    const questions = markdownContent.match(regex);

    // Function to extract the response text for each question
    const extractResponse = (question: string, content: string): string => {
        const questionIndex = content.indexOf(question);
        if (questionIndex === -1) return "";
        const responseStart = content.indexOf("\n", questionIndex) + 1;
        const nextQuestionIndex = content.indexOf("#", responseStart);
        const responseEnd =
            nextQuestionIndex === -1 ? content.length : nextQuestionIndex;
        return content.slice(responseStart, responseEnd).trim();
    };

    // Map each question to an object containing the question and its response
    const qaPairs: QA[] =
        questions?.map((question) => ({
            question,
            response: extractResponse(question, markdownContent),
        })) || [];

    return qaPairs;
}
