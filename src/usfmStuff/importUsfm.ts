// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Perf, PerfMetadataDocument, PerfVerse, chopUpPerfIntoChaptersAndVerses, extractTextFromPerfVerse, usfmToPerf } from './utils';
import {CodexContentSerializer} from "../serializer";
import {generateFiles} from "../utils/fileUtils";
import { CellTypes } from '../utils/codexNotebookUtils';

type UsfmImportParameters = {
    usfmFiles: vscode.Uri[];
}

async function getImportParameters() : Promise<UsfmImportParameters> {
    //https://vshaxe.github.io/vscode-extern/vscode/OpenDialogOptions.html
    const usfmFiles = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: true,
        openLabel: "Choose USFM file(s) to import",
        filters: {
            'USFM': ['usfm','USFM','usf','USF']
        }
      });
    //Throw an exception if the user canceled.
    if (!usfmFiles) throw new Error('User canceled import.');

    
    return { usfmFiles };
}

async function readUsfmData( usfmFiles: vscode.Uri[] ) {
    //read them all in parallel
    const filenameToUsfmData: { [filename: string]: string} = Object.fromEntries(
        await Promise.all( 
            usfmFiles.map(
                async usfmFile => [
                   usfmFile.fsPath, 
                   (await vscode.workspace.fs.readFile(usfmFile)).toString()
                ]
            )
        )
    );

    //now convert them all into perf.
    const filenameToPerf = Object.fromEntries(
        await Promise.all(
            Object.entries(filenameToUsfmData).map(
                async ([filename, usfmData]) => [
                    filename,
                    usfmToPerf(usfmData)
                ]
            )
        )
    );
    return filenameToPerf;
}

// export async function createProjectNotebooks({
//   shouldOverWrite = false,
//   books = undefined,
//   foldersWithUsfmToConvert = undefined,
// }: {
//   shouldOverWrite?: boolean;
//   books?: string[] | undefined;
//   foldersWithUsfmToConvert?: vscode.Uri[] | undefined;
// } = {}) {
//   const notebookCreationPromises = [];
//   let projectFileContent: ParsedUSFM[] | undefined = undefined;
//   if (foldersWithUsfmToConvert) {
//     projectFileContent = await importProjectAndConvertToJson(
//       foldersWithUsfmToConvert
//     );
//   }

//   const allBooks = books ? books : getAllBookRefs();
//   // Loop over all books and createCodexNotebook for each
//   for (const book of allBooks) {
//     /**
//      * One notebook for each book of the Bible. Each notebook has a code cell for each chapter.
//      * Each chapter cell has a preceding markdown cell with the chapter number, and a following
//      * markdown cell that says '### Notes for Chapter {chapter number}'
//      */
//     const cells: vscode.NotebookCellData[] = [];
//     const chapterHeadingText = `# Chapter`;

//     // Iterate over all chapters in the current book
//     for (const chapter of getAllBookChapterRefs(book)) {
//       // Generate a markdown cell with the chapter number
//       const cell = new vscode.NotebookCellData(
//         vscode.NotebookCellKind.Markup,
//         `${chapterHeadingText} ${chapter}`,
//         "markdown"
//       );
//       cell.metadata = {
//         type: CellTypes.CHAPTER_HEADING,
//         data: {
//           chapter: chapter,
//         },
//       };
//       cells.push(cell);
//       const importedBook = projectFileContent?.find(
//         (projectFile) => projectFile?.book?.bookCode === book
//       );

//       const verseRefText = importedBook?.chapters.find(
//         (projectBookChapter) => projectBookChapter?.chapterNumber === chapter
//       )?.contents;
//       // Generate a code cell for the chapter
//       const numberOfVrefsForChapter =
//         vrefData[book].chapterVerseCountPairings[chapter];
//       const vrefsString = getAllVrefs(
//         book,
//         chapter,
//         numberOfVrefsForChapter,
//         verseRefText
//       );

//       cells.push(
//         new vscode.NotebookCellData(
//           vscode.NotebookCellKind.Code,
//           vrefsString,
//           "scripture"
//         )
//       );

//       // Generate a markdown cell for notes for the chapter
//       cells.push(
//         new vscode.NotebookCellData(
//           vscode.NotebookCellKind.Markup,
//           `### Notes for Chapter ${chapter}`,
//           "markdown"
//         )
//       );
//     }
//     // Create a notebook for the current book
//     const serializer = new CodexContentSerializer();
//     const notebookData = new vscode.NotebookData(cells);

//     // const project = await getProjectMetadata();
//     const notebookCreationPromise = serializer
//       .serializeNotebook(
//         notebookData,
//         new vscode.CancellationTokenSource().token
//       )
//       .then((notebookFile) => {
//         // Save the notebook using generateFiles
//         const filePath = `files/target/${book}.codex`;
//         return generateFile({
//           filepath: filePath,
//           fileContent: notebookFile,
//           shouldOverWrite,
//         });
//       });
//     notebookCreationPromises.push(notebookCreationPromise);
//   }
//   await Promise.all(notebookCreationPromises);
// }

interface IntermediateFormat {
    [filename: string]: {
        document: PerfMetadataDocument,
        chapterToVerse: {[chapter: number]: {[verse: number]: PerfVerse }}
    }
}

function perfsToIntermediateFormat( filenameToPerf: { [filename: string]: Perf } ) : IntermediateFormat { 
    const filenameToChapterToVerse = chopUpPerfIntoChaptersAndVerses(filenameToPerf);

    const result = Object.fromEntries( 
        Object.entries(filenameToChapterToVerse).map(([filename, chapterToVerse]) => {
            return [
                filename,
                {
                    document: filenameToPerf[filename]?.metadata?.document || {},
                    chapterToVerse
                }
            ];
        })
    );
    return result;
}

//The point of this hack is to get the strings to look the same as the other importer even if it doesn't make sense.
//I am trying to round trip so I want things to be the same so I can catch important stuff.  We can remove the hacks
//later.
function importHacks( verseContent : string ) : string{
    //search for all ‘ which are following a letter and put a space between them.
    let result = verseContent.replace(/([a-z])(‘)/ig, "$1 $2");

    //also the reverse where the ‘ is followed by a letter.
    result = result.replace(/(‘)([a-z])/ig, "$1 $2");

    //add a space after a comma. (Perhaps this isn't a hack.  Why are we having to do this?)
    result = result.replace(/(,)([a-z])/ig, "$1 $2");

    return result;

}


async function generateNotebooks( intermediateFormat: IntermediateFormat ){


    const filenameToCells: { [filename: string]: vscode.NotebookCellData[] } = {};

    let currentFilename = "";
    let currentChapter = -1;
    let currentVerse = -1;
    let currentChapterCell : vscode.NotebookCellData | undefined = undefined;

    //now generate the notebooks.
    Object.entries(intermediateFormat).forEach(([filename, metadataAndChaptersToVerses]) => {
    
        //https://stackoverflow.com/questions/175739/built-in-way-in-javascript-to-check-if-a-string-is-a-valid-number
        const strippedFilename = (filename.split("/").pop()?.split( "." )[0] || "").split('').filter( (char) => char !== "-" && isNaN(char as unknown as number) ).join('');

        const bookAbbreviation = metadataAndChaptersToVerses.document.bookCode || metadataAndChaptersToVerses.document.toc3 ||
            metadataAndChaptersToVerses.document.h || metadataAndChaptersToVerses.document.toc2 || strippedFilename;

        //h followed by toc2 followed by bookCode followed by toc3 followed by the filename with nothing except for letters
        const bookName = metadataAndChaptersToVerses.document.h || metadataAndChaptersToVerses.document.toc2 ||
            metadataAndChaptersToVerses.document.bookCode || metadataAndChaptersToVerses.document.toc3 || strippedFilename;

        Object.entries(metadataAndChaptersToVerses.chapterToVerse).forEach(([chapterNumber, verseToPerf]) => {

            Object.entries(verseToPerf).forEach(([verseNumber, perfVerse]) => {
                //remove path and add .codex
                const notebookFilename = `files/target/${filename.split("/").pop()?.split( "." )[0] || ""}.codex`;

                //If the chapter or filename has changed then add the notes to the previous chapter if it exists.
                if( (currentChapter != -1 && (currentChapter !== parseInt(chapterNumber)) || (currentFilename && currentFilename !== notebookFilename)) ){
                    filenameToCells[currentFilename].push(
                        new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Markup,
                            `### Notes for Chapter ${currentChapter}`,
                            "markdown"
                        )
                    );
                }


                //if we are in a new filename, start a new cell group.
                if( !(notebookFilename in filenameToCells) ) filenameToCells[notebookFilename] = [];
                const cells = filenameToCells[notebookFilename];

                //If we are in a new chapter, create the chapter header.
                if( currentChapter != parseInt(chapterNumber) ){
                    const newCell = new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Markup,
                        `# Chapter ${chapterNumber}`,
                        "markdown"
                    );
                    newCell.metadata = {
                        type: CellTypes.CHAPTER_HEADING,
                        data: {
                            chapter: chapterNumber
                        }
                    };
                    cells.push(newCell);

                    currentChapterCell = undefined;
                }

                //if we don't have a current cell create one.
                if( currentChapterCell === undefined ){
                    currentChapterCell = new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Code,
                        "",
                        "scripture"
                    );
                    cells.push( currentChapterCell );
                }else{
                    //otherwise add a newline.
                    currentChapterCell!.value += `\n`;
                }
                

                currentFilename = notebookFilename;
                currentChapter = parseInt(chapterNumber);
                currentVerse = parseInt(verseNumber);

                const refString = `${bookAbbreviation} ${currentChapter}:${currentVerse}`;
                const verseContent = importHacks(extractTextFromPerfVerse(perfVerse).trim());

                    
                currentChapterCell!.value += `${refString} ${verseContent}`;
            });
        });
                
    });

    //close out the last one.
    if( currentFilename && currentChapter != -1  ){
        filenameToCells[currentFilename].push(
            new vscode.NotebookCellData(
                vscode.NotebookCellKind.Markup,
                `### Notes for Chapter ${currentChapter}`,
                "markdown"
            )
        );
    }

    //now create the notebooks all in parallel.
    const serializer = new CodexContentSerializer();
    await Promise.all(
        Object.entries(filenameToCells).map(
            async ([filePath, cells]) => {
                const notebookData = new vscode.NotebookData(cells);

                return serializer.serializeNotebook(
                    notebookData,
                    new vscode.CancellationTokenSource().token
                ).then((notebookFile) => {
                    // Save the notebook using generateFiles
                    return generateFiles({
                        filepath: filePath,
                        fileContent: notebookFile,
                        shouldOverWrite: true,
                    });
                });
            }
        )
    );


}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function registerUsfmImporter(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('The importUsfm plugin is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand('codex-editor-extension.importUsfm', async () => {
        // The code you place here will be executed every time your command is executed
        const importParameters = await getImportParameters();

        const filenameToPerf = await readUsfmData(importParameters.usfmFiles);

        const intermediateFormat = perfsToIntermediateFormat(filenameToPerf);

        await generateNotebooks(intermediateFormat);

        // Display a message box to the user
        vscode.window.showInformationMessage('Hello Usfm!');
    });

    context.subscriptions.push(disposable);
}
