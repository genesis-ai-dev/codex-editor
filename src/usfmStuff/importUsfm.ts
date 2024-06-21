// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Perf, PerfContent, PerfMetadataDocument, PerfReferenceSet, PerfVerse, TBlockContentIndex, chopUpPerfIntoChaptersAndVerses, extractAlignmentsFromPerfVerse, getAttributedVerseCharactersFromPerf, getIndexedReferencesFromPerf, getReferencesFromPerf, perfToUsfm, pullVerseFromPerf, reindexPerfVerse, replaceAlignmentsInPerfInPlace, stringToPerfVerse, stripAttributedString, usfmToPerf } from './utils';
import {CodexContentSerializer} from "../serializer";
import {generateFiles} from "../utils/fileUtils";
import { CellTypes } from '../utils/codexNotebookUtils';
import path from 'path';
import { DiffState, TAttributedString, traceDiffs } from './customizedJLDiff';

type UsfmImportParameters = {
    usfmFiles: vscode.Uri[];
}
type UsfmExportParameters = {
    usfmSaveUri: vscode.Uri;
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

async function getExportParameters( codex_filename: string ) : Promise<UsfmExportParameters> {
    //show a save as dialog pre-populated with the usfm version of the currently open document.

    const usfm_filename = path.parse(codex_filename).name + ".usfm";

    //get the root directory of the current open project.
    const root_dir = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root_dir) {
        //throw exception
        throw new Error("No workspace folders found.");
    }

    const usfmUri = vscode.Uri.file(path.join(root_dir, usfm_filename));

    //https://vshaxe.github.io/vscode-extern/vscode/SaveDialogOptions.html
    const usfmSaveUri = await vscode.window.showSaveDialog({
        defaultUri: usfmUri,
        filters: {
            'USFM': ['usfm','USFM','usf','USF']
        },
        saveLabel: "Export USFM",
        title: "Export USFM"
    });
    //Throw an exception if the user canceled
    if (!usfmSaveUri) throw new Error('User canceled export.');
    return { usfmSaveUri };
}

async function collectScriptureDataFromNotebook( notebook: vscode.NotebookDocument ) : Promise<{ [ref: string]: string; }> {

    //regular expression which will match a number a colon and a number.
    const referenceFinder = /(?<chapter>\d+):(?<verse>\d+)/;


    const result: {[ref: string]: string} = {};

    for (let i = 0; i < notebook.cellCount; i++) {
        const cell = notebook.cellAt(i);
        if (cell.kind === vscode.NotebookCellKind.Code) {
            //only consider code cells.  The headers and the notes
            //are markdown.
            const content = cell.document.getText();

            //iterate line by line.
            const lines = content.split("\n");
            for (const line of lines) {
                const match = referenceFinder.exec(line);
                if (match) {
                    const ref = `${match.groups!.chapter}:${match.groups!.verse}`;
                    const matchIndex = match.index;
                    const matchLength = match[0].length;
                    let firstNonMatchedIndex = matchIndex + matchLength;
                    //inc if that is a space.
                    if (firstNonMatchedIndex < line.length && line[firstNonMatchedIndex] == " ") {
                        firstNonMatchedIndex++;
                    }
                    //The verse is everything after the capture.
                    const verse = line.substring(firstNonMatchedIndex);
                    result[ref] = verse;
                }
            }
        }
    }

    return result;
}

function getUnupdatedPerfFromNotebookOrMakeIt( notebook: vscode.NotebookDocument ) : Perf {
    //the perf is stashed in the markdown for Chapter 1.
    //So just scan through all the cells and return the first perf
    //in the metadata which is found.
    //If there is none we will create one and return it.

    for (let i = 0; i < notebook.cellCount; i++) {
        const cell = notebook.cellAt(i);
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            if( cell?.metadata?.perf ){
                return cell.metadata.perf as Perf;
            }
        }
    }

    //if we get this far we need to construct a perf.
    //So invent a minimal usfm and convert it to perf.
    const minimal_usfm = `
    \\p
    \\c 1
    \\v 1 
    `.trim();
    const minimal_perf = usfmToPerf(minimal_usfm);
    return minimal_perf;
}

async function updatePerfOnNotebook(notebook: vscode.NotebookDocument, perf: Perf) {
    let cellEdit: vscode.NotebookEdit | null = null;

    // Iterate over each cell to find the ones with existing metadata
    for (let i = 0; i < notebook.cellCount && cellEdit === null; i++) {
        const cell = notebook.cellAt(i);
        if (cell.kind === vscode.NotebookCellKind.Markup) {
            if (cell.metadata?.perf) {
                // Create a new metadata object with the updated perf
                const newMetadata = {
                    ...cell.metadata,
                    perf: perf
                };

                // Create a notebook edit to update the cell's metadata
                cellEdit = vscode.NotebookEdit.updateCellMetadata(i, newMetadata);
            }
        }
    }

    // If we still didn't find the cell with existing metadata, go ahead and search through
    // all the cells and find the first one which is referencing a chapter which should be Chapter 1.
    for( let i = 0; i < notebook.cellCount && cellEdit === null; i++ ){
        const cell = notebook.cellAt(i);
        if( cell.kind === vscode.NotebookCellKind.Markup ){
            //Test if the cell's contents starts with "# Chapter"
            if( cell.document.getText().startsWith("# Chapter") ){ 
                cellEdit = vscode.NotebookEdit.updateCellMetadata(i, { 
                    ...cell.metadata,
                    perf: perf 
                });
            }
        }
    }

    // Apply the edit to the notebook
    if( cellEdit !== null ){
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [cellEdit]);
        await vscode.workspace.applyEdit(edit);
    }
}
//The point of this hack is to get the strings to look the same as the other importer even if it doesn't make sense.
//I am trying to round trip so I want things to be the same so I can catch important stuff.  We can remove the hacks
//later.
function importHacks( verseContent : string ) : string{

    let result : string = verseContent;

    result = result.trim();

    // // Put space between this kind of quote mark and letter.
    // result = result.replace(/(‘)([a-z0-9])/ig, "$1 $2");

    // // //add a space after a comma. (Perhaps this isn't a hack.  Why are we having to do this?)
    // // result = result.replace(/(,)([a-z])/ig, "$1 $2");

    // //remove the space between a { and a letter.
    // result = result.replace(/({) ([a-z])/ig, "$1$2");

    // //surround a quote mark with spaces.
    // //I don't think this is good, but it is what is currently going on.
    // result = result.replace(/(’)([a-z])/ig, "$1 $2");
    // result = result.replace(/([a-z])(’)/ig, "$1 $2");

    // //now put a space after all the commas.  This makes 5,000 into 5, 000 but we are
    // //just trying to match what is there and we can remove these hacks after.
    // result = result.replace(/(,)([a-z0-9])/ig, "$1 $2");

    // //Remove this space. K.
    // result = result.replace(/(—) ([^ ])/ig, "$1$2");
    
    // //Add this space.  K.
    // result = result.replace(/([a-z])(…)/ig, "$1 $2");

    // //Add a space before {
    // result = result.replace(/([a-z])({)/ig, "$1 $2");

    // //add spaces before th between it and the number.  So 11 th instead of 11th.
    // result = result.replace(/([0-9])(th|st|nd|rd)/ig, "$1 $2");
    
    return result;

}

interface PerfEditAction{
    type: "createChapter" | "insertVerse" | "edit"; //No delete for now, we will just edit to a blank verse.
    chapterNumber: number;
    verseNumber?: number;
    newVerseText?: string;
    index: TBlockContentIndex;
}
function combineIndexWithContentIntoActions( 
    notebook_content: { [ref: string]: string; }, 
    perf_index: PerfReferenceSet, 
    removeMissing: boolean,
    perf: Perf ) : PerfEditAction[] {

    //figure out what verses are edits, which ones are inserts and which ones are deletes
    
    //first go through and handle all the notebook_contents.

    //Then we go through and all the verses which didn't receive a match we create a remove for them.  We don't do this if removeMissing is false incase this is just a patch update for a single verse.

    //We possibly have to create new chapters.  Keep track if the chapters have already been created so they don't get created twice.

    //set of chapters which already have actions to create them.
    const created_chapters : { [chapter: number]: PerfEditAction } = {};
    const actions : PerfEditAction[] = [];

    //Iterate through notebook_content:
    Object.entries( notebook_content ).forEach( ([ref, verseText]) => {

        const [chapterNumber, verseNumber ] : number[] = ref.split(":").map( x => parseInt(x) );

        if( !perf_index.verses[ref] ){
            let insertionLocation : TBlockContentIndex | undefined = undefined;
            let createChapter = false;
            //No match, so create an insert action.
            //if there is no chapter we also have to make a chapter creation action.
            //test if chapter is in perf_index.chapters
            if( !perf_index.chapters[chapterNumber] ){
                if( !created_chapters[chapterNumber] ){
                    //we have to create a chapter.  But before we can do that we need to know
                    //the first block of the next chapter if it exists or the end.
                    const greaterChapters = Object.keys( perf_index.chapters ).map( x => parseInt(x)).filter( x => x > chapterNumber ).sort( (a,b) => a-b );

                    insertionLocation = greaterChapters.length ? perf_index.chapters[greaterChapters[0]] : {b: perf_index.last.b, c:perf_index.last.c + 1};


                    createChapter = true;
                }else{

                    //If the chapter doesn't exist, but it is already going to be created  insert at the same location.  The sort later on makes the verse 
                    //insertions happen before the chapter insertions so that makes the chapters end up in front of the verses because of inserting at the same index.
                    insertionLocation = created_chapters[chapterNumber].index;
                }
            }else{
                //if the verse doesn't exist but the chapter,
                //check to see if the next verse exists.  If it does insert just before it,
                //otherwise insert just before the next chapter.
                const greaterVersesInChapter = Object.keys( perf_index.verses ).filter( ref => ref.startsWith( `${chapterNumber}:` ) ).map( x => parseInt(x.split(":")[1])).filter( x => x > verseNumber ).sort( (a,b) => a-b );
                if( greaterVersesInChapter.length ){
                    insertionLocation = perf_index.verses[`${chapterNumber}:${greaterVersesInChapter[0]}`];
                }else{
                    //if there isn't a greater verse, see if there is a greater chapter:
                    const greaterChapters = Object.keys( perf_index.chapters ).map( x => parseInt(x)).filter( x => x > chapterNumber ).sort( (a,b) => a-b );
                    if( greaterChapters.length ){
                        insertionLocation = perf_index.chapters[greaterChapters[0]];
                    }else{
                        //if there isn't a greater chapter either, then insert at the end.
                        insertionLocation = perf_index.last;
                    }
                }
            }

            //we should never insert before a chapter mark because anything that is in the same block as a chapter gets added to that chapter.
            //The code which does the chapter insert will create a new block for it when it happens, but we need to not add it in before
            //another chapter.  I will test for a c==0 and if b>0 we will set our insertion point to be the length of the previous block.
            //This could fail if something else ends up being at the front of the chapter which we don't know about but makes the chapter mark
            //we are inserting in front of not be at c==0.
            if( insertionLocation.c == 0 && insertionLocation.b > 0 ){  //bookmark1
                insertionLocation.b--;
                insertionLocation.c = perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks?.[insertionLocation.b]?.content?.length ?? 0;
            }

            //In this case the chapter doesn't exist, but we either created the action to create
            //it or we found we already created the action to create it, and we also want to
            //add the verse to the same location in the perf.
            const action = {
                type: "insertVerse" as const,
                chapterNumber,
                verseNumber,
                newVerseText: verseText,
                index: insertionLocation,
            };
            actions.push( action );

            if( createChapter ){
                //create a chapter.
                const action = {
                    type: "createChapter" as const,
                    chapterNumber,
                    index: insertionLocation };

                actions.push( action );
                created_chapters[chapterNumber] = action;
            }
        }else{
            //in this case the verse already exists in the perf so we will just need to edit it.
            const action = {
                type: "edit" as const,
                chapterNumber,
                verseNumber,
                newVerseText: verseText,
                index: perf_index.verses[ref]
            };
            actions.push( action );
        }

    });
    
    //now we need to create drop edit actions for all the things which didn't receive a match.  (Right now we will just make them edits to a blank verse)
    if( removeMissing ){
        Object.entries(perf_index.verses).filter( ([ref, index]) => !notebook_content[ref] ).forEach( ([ref, index]) => {

            const [chapterNumber, verseNumber ] : number[] = ref.split(":").map( x => parseInt(x) );
            const action = {
                type: "edit" as const,
                chapterNumber,
                verseNumber,
                newVerseText: "",
                index
            };
            actions.push( action );
        });
    }

    //now we need to sort the actions so that they can be executed in order.
    //I have b-a because I want this in descending order so that the list is processed from the end to the beginning.
    actions.sort( (a,b) => {
        //if the location of operation is different, then obviously that order needs to be respected.
        if( a.index.b != b.index.b ) return b.index.b - a.index.b;
        if( a.index.c != b.index.c ) return b.index.c - a.index.c;

        //We now need to sort by chapter, because if we have a mix of createChapter and insertVerse
        //we need them interleaved by chapter so that the verses end up in the correct chapter even though
        //they all have the same insertion point.
        if( a.chapterNumber != b.chapterNumber ){
            //still have reversed sorting because repeated insertion at the same index will produce a
            //a reversed result from action order.
            return b.chapterNumber - a.chapterNumber;
        }

        //Now within the given chapter, need to have the createChapter end up before the insertVerse
        //so in action order it needs to come after so we have the operationOrder in the order we want
        //it to end up in PERF, and then the action order reverses it with b-a.
        //The edit comes last because it must be the first action, because when it is not creating something
        //the index for it is actually what is there and not after something takes its place.
        //This would happen if you add a verse right before a verse you edited.
        const operationOrder = ["createChapter", "insertVerse", "edit",];
        const aTypeOrder = operationOrder.indexOf(a.type);
        const bTypeOrder = operationOrder.indexOf(b.type);
        if( aTypeOrder != bTypeOrder ) return bTypeOrder - aTypeOrder;

        //finally we need to sort by verse number.  This is for multiple verse insertions so that they
        //end up in the right order.
        if( a.verseNumber !== undefined && b.verseNumber !== undefined ){
            //again reverse sort on verseNumber because the action order is opposite of the resulting
            //perf order.
            if( a.verseNumber != b.verseNumber ) return b.verseNumber - a.verseNumber;
        }

        //If we get here the moon must be imploding... or they added two verses with the same reference.
        return 0;
    });

    return actions;
}

function createChapter( perf: Perf, chapterNumber: number, insertionIndex: TBlockContentIndex ){
    const newChapterMark = {
        type: "mark",
        subtype: "chapter",
        atts: {
            number: chapterNumber.toString(),
        }
    };

    //snip off everything from the specified index on to be in the new block.
    const snippedContent = perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks?.[insertionIndex.b]?.content?.splice( insertionIndex.c ) ?? [];

    const newBlock = {
        type: 'paragraph', subtype: 'usfm:p',
        content: [ newChapterMark, ...snippedContent ]
    };
    
    //now splice into the perf at the insertion index.
    perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks?.splice( insertionIndex.b+1, 0, newBlock );
}

function insertVerse( perf: Perf, chapterNumber: number, verseNumber: number, verseText: string, insertionIndex: TBlockContentIndex ){
    const newSection = stringToPerfVerse( verseText );

    //add the chapter mark to the front.
    newSection.unshift( {
        type: "mark",
        subtype: "verses",
        atts: {
            number: verseNumber.toString(),
        }
    } );

    //now splice into the perf at the insertion index.
    perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks?.[insertionIndex.b]?.content?.splice( insertionIndex.c, 0, ...newSection );
}

function editVerse( perf: Perf, chapterNumber: number, verseNumber: number, newVerseText: string, insertionIndex: TBlockContentIndex ){
    //first see if the verse actually needs to be edited.
    const testExport = importHacks( getAttributedVerseCharactersFromPerf( perf, {chapter:chapterNumber, verse:verseNumber}, false, insertionIndex) as string);

    //A string comparison is cheaper then a diff, so
    //we do this first off so that we don't do diffs on all the
    //unmodified content.
    if( testExport === newVerseText ) return;

    //grab the alignment from the perf so we can fix the alignments back up after the edit.
    const savedAlignments = extractAlignmentsFromPerfVerse( pullVerseFromPerf( `${chapterNumber}:${verseNumber}`, perf, insertionIndex ) ?? [] );


    //Now get the target as an attributed string where we can find where each character came from.
    const attributedTarget = getAttributedVerseCharactersFromPerf( perf, {chapter:chapterNumber, verse:verseNumber}, true, insertionIndex) as TAttributedString;


    //Do the same for the incoming new content except that we have to wrap it in a fake perf to make the attributes have context.
    const newPerfVerse = stringToPerfVerse( newVerseText );


    //These functions are defined here because they are just specific to this function, if that is bad form they should be able to be moved
    //outward.
    function getPerfChar( _perf: Perf, _blockIndex: number, _contentIndex: number, _charIndex: number ){
        const content = _perf?.sequences?.[_perf?.main_sequence_id ?? ""]?.blocks?.[_blockIndex]?.content?.[_contentIndex];
        if( typeof( content ) == "string" ){
            return content[_charIndex];
        }else if( typeof( content ) == "object" ){
            return content.content?.join("")[_charIndex];
        }
        return "";
    }
    function dropPerfChar( _perf: Perf, _blockIndex: number, _contentIndex: number, _charIndex: number ){
        let dropped_char : string | undefined = undefined;
        const contentArray = _perf?.sequences?.[_perf?.main_sequence_id ?? ""]?.blocks?.[_blockIndex]?.content;
        if( contentArray != undefined ){
            const content = contentArray[_contentIndex];
            if( typeof( content ) == "string" ){
                dropped_char = content[_charIndex];
                contentArray[_contentIndex] = content.substring(0, _charIndex) + content.substring(_charIndex + 1);
            }else if( typeof( content ) == "object" ){
                let usedCharIndex = _charIndex;
                for(let i = 0; i < content.content!.length; ++i ){
                    const oneContent = content.content![i];
                    if( usedCharIndex < oneContent.length ){
                        dropped_char = oneContent[usedCharIndex];
                        content.content![i] = oneContent.substring(0, usedCharIndex) + oneContent.substring(usedCharIndex + 1);
                        break;
                    }
                    usedCharIndex -= oneContent.length;   
                }
            }
        }
        return dropped_char;
    }
    function insertIntoPerfPiece( _perf: Perf, _blockIndex: number, _contentIndex: number, _charIndex: number, _char: string ){
        const contentArray = _perf?.sequences?.[_perf?.main_sequence_id ?? ""]?.blocks?.[_blockIndex]?.content;
        if( contentArray !== undefined ){
            if( _charIndex < 0 ){
                //if our _charIndex is -1 for this insertion, then that means, insert before this word boundary.
                //If _charIndex is a word, then we need to insert a string at the current index.
                //If the current index is already a string, then this has already happened.
                if( typeof(contentArray[_contentIndex]) == "string" ){
                    contentArray[_contentIndex] = _char + contentArray[_contentIndex];
                }else{
                    contentArray.splice( _contentIndex, 0, _char );
                }
            }else{
                const content : string | PerfContent | undefined = contentArray?.[_contentIndex];
                if( content === undefined ){
                    throw new Error("Internal error.  Attempting to insert a character into a perf that does not exist.");
                }else if( typeof( content ) == "string" ){
                    contentArray![_contentIndex] = content.slice(0, _charIndex) + _char + content.slice(_charIndex);
                }else if( typeof( content ) == "object" ){
                    
                    const contentLength = content.content!.join("").length;
                    if( _charIndex > contentLength ){
                        //If _charIndex is > then the length of this word, then it means to add it outside of the word boundary.
                        //So if the next index is a string then add the content as a prefix to that string, otherwise
                        //we need to insert a string at the following index.
                        if( _contentIndex+1 < contentArray.length && typeof(contentArray[_contentIndex+1]) == "string" ){
                            contentArray[_contentIndex+1] = _char + contentArray[_contentIndex+1];
                        }else{
                            contentArray.splice( _contentIndex+1, 0, _char );
                        }
                        
                    }else{

                        let usedCharIndex = _charIndex;
                        for( let i = 0; i < content.content!.length; ++i ){
                            const oneContent = content.content![i];
                            if( usedCharIndex <= oneContent.length ){
                                content.content![i] = oneContent.slice(0, usedCharIndex) + _char + oneContent.slice(usedCharIndex);
                                break;
                            }
                            usedCharIndex -= oneContent.length;
                        }
                    }
                }
            }
        }
    }
    function getPerfPiece( _perf: Perf, _blockIndex: number, _contentIndex: number ){
        const content = _perf?.sequences?.[_perf?.main_sequence_id ?? ""]?.blocks?.[_blockIndex]?.content?.[_contentIndex];
        if( typeof( content ) == "string" ){
            return content;
        }else if( typeof( content ) == "object" ){
            return content.content?.join("");
        }
        return "";
    }
    function dropPerfPiece( _perf: Perf, _blockIndex: number, _contentIndex: number ){
        const contentArray = _perf?.sequences?.[_perf?.main_sequence_id ?? ""]?.blocks?.[_blockIndex]?.content;
        contentArray?.splice( _contentIndex, 1 );
    }

    function splitPerfPiece( _perf: Perf, _blockIndex: number, _contentIndex: number, _charIndex: number, _makeWord: boolean ){
        const contentArray = _perf?.sequences?.[_perf?.main_sequence_id ?? ""]?.blocks?.[_blockIndex]?.content;
        if( contentArray != undefined ){
            const content : string | PerfContent | undefined = contentArray?.[_contentIndex];


            let existingContentString : string = "";

            //pull the content.
            if( content === undefined ){
                throw new Error("Internal error.  Attempting to split a perf that does not exist.");
            }else if( typeof( content ) == "string" ){
                existingContentString = content;
            }else{
                existingContentString = content.content!.join("");
            }

            //if the _charIndex is -1, then this is when we are dealing with content before the 
            //first word.
            //if we are creating a word, then upgrade the current string to a word and leave it.
            //Any more characters added at -1 will end up before it as a new string.
            //if we are not making a word, then we need to insert a zero length string
            //before this string so that new chars get added to that.  If that is a word
            //it will get upgraded later.
            if( _charIndex == -1 ){
                if( typeof( content ) == "string" ){
                    if( _makeWord ){
                        const newWord = {
                            type: "wrapper",
                            subtype: 'usfm:w',
                            content: [ existingContentString ],
                        };
                        //replace with content upgraded to word.
                        contentArray[_contentIndex] = newWord;
                    }else{
                        //otherwise insert a zero length string.
                        contentArray?.splice(_contentIndex, 0, "");
                    }
                }



            //if the split point is the length of the current content,
            //then we don't need to do anything.  This is because the
            //first word or intraword we create will not have a word after
            //it that needs to be created.
            }else if( _charIndex < existingContentString.length ){

                //split it.
                const part1 = existingContentString.slice(0, _charIndex);
                const part2 = existingContentString.slice(_charIndex);


                //put part1 back in.
                if( typeof( content ) == "string" ){
                    contentArray![_contentIndex] = part1;
                }else{
                    content!.content = [ part1 ];
                }

                //now insert part2.
                if( _makeWord ){
                    const newWord = {
                        type: "wrapper",
                        subtype: 'usfm:w',
                        content: [ part2 ],
                    };
                    contentArray?.splice(_contentIndex+1, 0, newWord);
                }else{
                    contentArray?.splice(_contentIndex+1, 0, part2);
                }
            }
        }
                
    }

    //if the existing perf verse is empty, then just concat it in.
    if( attributedTarget.length == 0 ){
        const splicePoint = {b:insertionIndex.b,c:insertionIndex.c+1}; //+1 to get after the verse marker.
        perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks?.[splicePoint.b]?.content?.splice( splicePoint.c, 0, ...newPerfVerse );
    }else{

        const newFakePerf = {
            main_sequence_id: "new_verse",
            sequences: {"new_verse": {
                blocks: [{
                    content:newPerfVerse,
                    type: 'paragraph',
                }]
            }}
        };
        const attributedSource = getAttributedVerseCharactersFromPerf( newFakePerf, {chapter:chapterNumber, verse:verseNumber}, true, {b:0, c:0}) as TAttributedString;

        //now run a diff between the two of them.
        const editDiffs = traceDiffs( attributedTarget, attributedSource );

        //need to go through the diff and make the insertions be referencing the locations in the target perf and not the source perf.
        //we do this by running through it in the reverse direction and keeping the last seen index in the target perf and setting that as the insertion
        //location for all the characters which are inserts.
        const lastAttributedTarget = attributedTarget[attributedTarget.length-1];
        let insertBlockIndex       = lastAttributedTarget.blockIndex;
        let insertContentIndex     = lastAttributedTarget.contentIndex;
        let insertCharacterIndex   = lastAttributedTarget.charIndex + 1; //add one so that it would insert after the last char if we have inserts before getting there.
        for( let i = editDiffs.length-1; i >= 0; i-- ){
            const editDiff = editDiffs[i];
            if( editDiff.state == DiffState.STATE_PASSING_2ND ){
                //This is an insert which means it is referencing the fake perf, and we need to copy the index stuff into it.
                editDiff.content.blockIndex   = insertBlockIndex;
                editDiff.content.contentIndex = insertContentIndex;
                editDiff.content.charIndex    = insertCharacterIndex;
            }else{
                //This is a match or a delete which both reference the correct perf so we can update our indexes.
                insertBlockIndex     = editDiff.content.blockIndex;
                insertContentIndex   = editDiff.content.contentIndex;
                insertCharacterIndex = editDiff.content.charIndex;
            }
        }

        //TODO: Need to go through the diff and remove word boundary modifications in sections that were not edited.
        //This perhaps should be added once there is a way to manually change the word boundaries so that there is boundary information that should be preserved.
        //when it is done the word boundary modification removals need to be done in corresponding pairs.

    

        //now apply the edits to the perf
        //iterate through the edit diffs in reverse so that the indexes are still correct when we get to them.
        for( let i = editDiffs.length-1; i >= 0; i-- ){
            const editDiff = editDiffs[i];
            const targetChar = editDiff.content;
            if( !targetChar.isMeta ){
                if( editDiff.state == DiffState.STATE_PASSING_1ST ){
                    //passing first means deleting the target character.  So it needs to be spliced out.
                    const droppedChar = dropPerfChar( perf, targetChar.blockIndex, targetChar.contentIndex, targetChar.charIndex );
                    if( droppedChar != targetChar.char ){
                        throw new Error("Internal error.  Attempting to remove a character that is not in the perf.");
                    }
                }else if( editDiff.state == DiffState.STATE_PASSING_2ND ){
                    //passing second means adding the target character.  So it needs to be added.
                    insertIntoPerfPiece( perf, targetChar.blockIndex, targetChar.contentIndex, targetChar.charIndex, targetChar.char );
                }else if( editDiff.state == DiffState.STATE_MATCH ){
                    //just double check that this char is correct.
                    const currentChar = getPerfChar( perf, targetChar.blockIndex, targetChar.contentIndex, targetChar.charIndex );
                    if( currentChar != targetChar.char ){
                        throw new Error("Internal error.  Character match is wrong.");
                    }
                }
            }else{ //if is meta (word boundary changes)
                //meta edits are the addition and removal of word boundaries and are a bit more interesting.
                if( editDiff.state == DiffState.STATE_PASSING_1ST ){

                    if( editDiff.content.char == "<" ){
                        //This means that we are removing the current end of word boundary.  So the content of the current word or string
                        //needs to be added to the end of the string or word that comes at a lower perf index.
                        if( editDiff.content.charIndex !== -1 ){
                            throw new Error( "Internal error.  Trying to remove a word boundary that is not at the start of a word." );
                        }
                        if( i > 0 ){
                            //first insert it into the previous area
                            insertIntoPerfPiece( perf, editDiffs[i-1].content.blockIndex, editDiffs[i-1].content.contentIndex, editDiffs[i-1].content.charIndex+1, getPerfPiece( perf, editDiff.content.blockIndex, editDiff.content.contentIndex )! );
                            //and then remove as its own entity.
                            dropPerfPiece( perf, editDiff.content.blockIndex, editDiff.content.contentIndex );
                        }
                    }else if( editDiff.content.char == ">" ){
                        //This means the removal of the end of a word boundary.  But the indexing for this is at the tail end of the word that
                        //the boundary is being removed on.
                        //So we take all of the next perf index and add it to the current item.  This item type is defined by the start boundary
                        //of it, which we will leave alone unless the diff gets there and changes it.
                        if( editDiff.content.charIndex != getPerfPiece( perf, editDiff.content.blockIndex, editDiff.content.contentIndex )?.length ){
                            throw new Error( "Internal error.  Trying to remove a word boundary that is not at the end of a word." );
                        }
                        if( i < editDiffs.length-1 ){
                            //first insert it into the next area
                            insertIntoPerfPiece( perf, editDiff.content.blockIndex, editDiff.content.contentIndex, editDiff.content.charIndex, getPerfPiece( perf, editDiffs[i+1].content.blockIndex, editDiffs[i+1].content.contentIndex )! );
                            //and then remove as its own entity.
                            dropPerfPiece( perf, editDiffs[i+1].content.blockIndex, editDiffs[i+1].content.contentIndex );
                        }
                    }
                }else if( editDiff.state == DiffState.STATE_PASSING_2ND ){
                    //This means that we are inserting a boundary.  So we trim off the rest of the current word or string
                    //and add it as a new content location after this.  Depending on if this is a begin or end boundary
                    //changes if we create a word or string after this.
                    //for insertions we get our index information from the reverse drag of references, so it is always within context of the last thing.
                    //Not like in the removals where sometimes the location is before the boundary and sometimes after the boundary.
                    if( editDiff.content.char == "<" ){
                        //we are inserting the start of word boundary.  So chop off the rest of the content and insert as a word.
                        splitPerfPiece( perf, editDiff.content.blockIndex, editDiff.content.contentIndex, editDiff.content.charIndex, true );
                    }else if( editDiff.content.char == ">" ){
                        //we are inserting the end of word boundary.  So we chip of the rest of the current and insert it as intraword.
                        splitPerfPiece( perf, editDiff.content.blockIndex, editDiff.content.contentIndex, editDiff.content.charIndex, false );
                    }
                }// if we match a start of word boundary or end of word boundary big whoop.
            }
        }
    }

    //now that we are done editing the verse we need to reindex it.
    const perfVerse = pullVerseFromPerf( `${chapterNumber}:${verseNumber}`, perf, insertionIndex );
    if( perfVerse === undefined ){
        throw new Error( "Internal error.  Edited verse missing from perf." );
    }
    reindexPerfVerse( perfVerse!, false );

    //now time to fix the alignments.
    replaceAlignmentsInPerfInPlace( perf, chapterNumber, verseNumber, insertionIndex, savedAlignments );

    //const testExport2 = getAttributedVerseCharactersFromPerf( perf, {chapter:chapterNumber, verse:verseNumber}, false, insertionIndex) as string;

    //console.log( `Edited verse now looks like: "${testExport2}"` );

    //pop it up in vscode
    //vscode.window.showInformationMessage( `Edited verse ${chapterNumber}:${verseNumber} now looks like "${testExport2}"!` );
}

function executeNotebookEditActions( unupdated_perf : Perf, notebook_edit_actions: PerfEditAction[], perf_index: PerfReferenceSet ){

    for( const action of notebook_edit_actions ){

        // //Debug. 29:25
        // const testVerse = getAttributedVerseCharactersFromPerf( unupdated_perf, {chapter:29, verse:25}, false, perf_index.verses["29:25"]);
        // console.log( `At this point the verse reads "${testVerse}"` );

        switch( action.type ){
            case "createChapter":
                createChapter( unupdated_perf, action.chapterNumber, action.index );
                break;
            case "insertVerse":
                insertVerse( unupdated_perf, action.chapterNumber, action.verseNumber!, action.newVerseText!, action.index );
                break;
            case "edit":
                editVerse( unupdated_perf, action.chapterNumber, action.verseNumber!, action.newVerseText!, action.index );
                break;
        }

    }
}

async function getPerfFromActiveNotebook() : Promise<Perf> {


    const notebookEditor = vscode.window.activeNotebookEditor;
    if (!notebookEditor) throw new Error('No active notebook editor found');
    const notebook = notebookEditor.notebook;

    //iterate through each cell in the notebook.

    const notebook_content = await collectScriptureDataFromNotebook(notebook);

    const perf = getUnupdatedPerfFromNotebookOrMakeIt(notebook);

    const perf_index = getIndexedReferencesFromPerf(perf);

    const notebook_edit_actions = combineIndexWithContentIntoActions(notebook_content, perf_index, true, perf);

    executeNotebookEditActions( perf, notebook_edit_actions, perf_index );

    updatePerfOnNotebook( notebook, perf );

    return perf;
}


async function doUsfmExport(codex_filename: string, exportParameters: UsfmExportParameters) {
    const perf = await getPerfFromActiveNotebook();

    const usfmData = perfToUsfm( perf );

    await vscode.workspace.fs.writeFile(exportParameters.usfmSaveUri, Buffer.from(usfmData));
}


/**
 * Appends a smiley face to the content of the first cell in the active notebook editor.
 *
 * @return {Promise<void>} A promise that resolves when the smiley face is successfully appended, or rejects with an error message if no active notebook editor is found or if the operation fails.
 */
async function doSmileyToFirstCell() {
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (!notebookEditor) {
        vscode.window.showErrorMessage('No active notebook editor found');
        return;
    }


    const notebook = notebookEditor.notebook;

    // Check if the notebook has at least one cell
    if (notebook.cellCount > 0) {
        const firstCell = notebook.cellAt(0);
        const updatedText = firstCell.document.getText() + ' 😊';

        // Create an edit to update the cell's content
        const edit = new vscode.WorkspaceEdit();
        edit.replace(firstCell.document.uri, new vscode.Range(0, 0, firstCell.document.lineCount, 0), updatedText);

        // Apply the edit
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage('Smiley appended to the first cell');
        } else {
            vscode.window.showErrorMessage('Failed to append smiley to the first cell');
        }
    } else {
        vscode.window.showErrorMessage('The notebook does not contain any cells');
    }
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


async function generateNotebooks( filenameToPerf: { [filename: string]: Perf } ) {


    const filenameToCells: { [filename: string]: vscode.NotebookCellData[] } = {};

    let currentFilename = "";
    let currentChapter = -1;
    let currentVerse = -1;
    let currentChapterCell : vscode.NotebookCellData | undefined = undefined;

    //now generate the notebooks.
    Object.entries(filenameToPerf).forEach(([filename, perf]) => {
    
        //https://stackoverflow.com/questions/175739/built-in-way-in-javascript-to-check-if-a-string-is-a-valid-number
        const strippedFilename = (filename.split("/").pop()?.split( "." )[0] || "").split('').filter( (char) => char !== "-" && isNaN(char as unknown as number) ).join('');

        const bookAbbreviation = perf.metadata?.document?.bookCode || perf.metadata?.document?.toc3 ||
        perf.metadata?.document?.h || perf.metadata?.document?.toc2 || strippedFilename;

        //h followed by toc2 followed by bookCode followed by toc3 followed by the filename with nothing except for letters
        const bookName = perf.metadata?.document?.h || perf.metadata?.document?.toc2 ||
        perf.metadata?.document?.bookCode || perf.metadata?.document?.toc3 || strippedFilename;

        const references = getReferencesFromPerf(perf);

        references.forEach((reference) => {

            const verseText = getAttributedVerseCharactersFromPerf( perf, reference, false ) as string;

            //remove path and add .codex
            const notebookFilename = `files/target/${filename.split("/").pop()?.split( "." )[0] || ""}.codex`;

            //If the chapter or filename has changed then add the notes to the previous chapter if it exists.
            if( (currentChapter != -1 && ((currentChapter !== reference.chapter) || (currentFilename && currentFilename !== notebookFilename))) ){
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
            if( currentChapter != reference.chapter || (currentFilename && currentFilename !== notebookFilename)){
                const newCell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    `# Chapter ${reference.chapter}`,
                    "markdown"
                );
                newCell.metadata = {
                    type: CellTypes.CHAPTER_HEADING,
                    data: {
                        chapter: "" + reference.chapter
                    }
                };
                if( currentChapter == 1 ){
                    newCell.metadata.perf = perf;
                }
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
            currentChapter = reference.chapter;
            currentVerse = reference.verse;

            const refString = `${bookAbbreviation} ${currentChapter}:${currentVerse}`;
            const verseContent = importHacks(verseText);

                
            currentChapterCell!.value += `${refString} ${verseContent}`;
        
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
    const import_disposable = vscode.commands.registerCommand('codex-editor-extension.importUsfm', async () => {
        // The code you place here will be executed every time your command is executed
        const importParameters = await getImportParameters();

        //read the usfm data to a dictionary which maps from the filename to the loaded perf.
        const filenameToPerf = await readUsfmData(importParameters.usfmFiles);

        await generateNotebooks(filenameToPerf);

        // Display a message box to the user
        vscode.window.showInformationMessage('Usfm import complete.');
    });
    context.subscriptions.push(import_disposable);

    const export_disposable = vscode.commands.registerCommand('codex-editor-extension.exportUsfm', async () => {
        
        //vscode.window.showInformationMessage( "Usfm export not implemented" );

        //show an information message with the name of the currently open vscode document.
        //const currently_open_document = vscode.window.activeTextEditor?.document;

        const notebookEditor = vscode.window.activeNotebookEditor;
        if (!notebookEditor) {
            vscode.window.showErrorMessage('No active notebook editor found');
            return;
        }
    

        //const codex_filename = currently_open_document.fileName;
        const codex_filename = notebookEditor.notebook.uri.fsPath;

        if( !codex_filename ){
            vscode.window.showInformationMessage( "No document open" );
            return;
        }

        const codex_basename = path.basename(codex_filename);

        //make sure the extension of the filename is .codex.
        if( !codex_basename.endsWith(".codex") ){
            vscode.window.showInformationMessage( "Filename must be a .codex file" );
            return;
        }

        vscode.window.showInformationMessage( `Exporting ${codex_basename}` );

        const exportParameters = await getExportParameters(codex_filename);

        await doUsfmExport(codex_filename, exportParameters);

        vscode.window.showInformationMessage( `Finished exporting ${codex_basename}` );
    });
    context.subscriptions.push(export_disposable);
}

