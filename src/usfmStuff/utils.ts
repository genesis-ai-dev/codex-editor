
//@ts-expect-error This library doesn't have types.
import {Proskomma} from 'proskomma-core';
//@ts-expect-error This library doesn't have types.
import {PipelineHandler} from 'proskomma-json-tools';

import { Token } from 'wordmap-lexer';
import { Alignment, Ngram, Prediction, Suggestion } from 'wordmap';


export interface TStrippedUsfm{
    version: number,
    text: string
}
export interface TAlignmentData{
    version: number,
    perf: any,
}

export interface OptionalInternalUsfmJsonFormat{
    strippedUsfm?: TStrippedUsfm,
    alignmentData?: TAlignmentData,
}
export interface InternalUsfmJsonFormat{
    strippedUsfm: TStrippedUsfm,
    alignmentData: TAlignmentData,
}

export interface UsfmMessage{
    command: string,
    content?: OptionalInternalUsfmJsonFormat,
    requestId?: number,
    commandArg?: any,
    response?: any,
    error?: any,
  }

//The perf related types are not official, I add items to these types as
//I verify they exist.
interface PerfAttributes{
    number: string,
}

interface PerfContext{
    type?: string,
    subtype?: string,
    atts?: PerfAttributes,
}

interface PerfBlock{
    type?: string,
    subtype?: string,
    content?: PerfContext[],
}


//Define an interface PerfVerse which is an array of PerfBlock.
export interface PerfVerse extends Array<PerfBlock> {}

interface PerfAlignment{

}

interface PerfSequence{
    blocks?: PerfBlock[],
}

export interface PerfMetadataDocument{
    bookCode?: string,
    h?: string,
    toc?: string,
    toc2?: string,
    toc3?: string,
}

interface PerfMetadata{
    document?: PerfMetadataDocument,
}

export interface Perf{
    metadata?: PerfMetadata,
    sequences?: { [key: string]:PerfSequence},
    main_sequence_id?: string,
}

export const SECONDARY_WORD = 'secondaryWord';
export const PRIMARY_WORD = 'primaryWord';


//Copied this type from alignments-transferer.  Commenting stuff in when they get touched.

export interface TWord{
    type: string;

    occurrence?: number;
    occurrences?: number;

    // position?: number;

    // //Sometimes it is word sometimes it is text.
    // word?: string; //usfm format uses word
    text?: string; //alignment uses text.

    // content?: string;
    // endTag?: string;
    lemma?: string;
    morph?: string;
    // strongs?: string; //something was using strongs, I forget
    strong?: string; //alignment dialog uses strong
    // tag?: string;

    // children?: TWord[];

    disabled?: boolean; //Makes it look used in the word bank.
    
    index?: number;
}

export interface TWordAlignerAlignmentResult{
    targetWords: TWord[];
    verseAlignments: TSourceTargetAlignment[];
}
  

export interface TSourceTargetAlignment{
    sourceNgram: TWord[];
    targetNgram: TWord[];
}

export interface TSourceTargetPrediction{
    alignment: TSourceTargetAlignment;
    confidence: number;
}

export interface TAlignmentSuggestion{
    predictions: TSourceTargetPrediction[];
    confidence: number;
}
/*
    export interface TSourceTargetSuggestion{
        alignment: TSourceTargetAlignment;
        confidence: number;
    }
    

    interface TTopBottomAlignment{
        topWords: TWord[];
        bottomWords: TWord[];
    } 

    export interface TAlignerData{
        wordBank: TWord[];
        alignments: TSourceTargetAlignment[];
    }
  

    interface TReference{
        chapter: number;
        verse: number;
    }

    interface TContextId{
        reference: TReference;
    }

    interface TUsfmVerse{
        verseObjects: TWord[];
    }

    type TUsfmChapter = {[key:string]:TUsfmVerse};

    interface TUsfmHeader{
        tag: string;
        content: string;
    }

    interface TUsfmBook{
        headers: TUsfmHeader[];
        chapters: {[key:string]:TUsfmChapter};
    }

    export interface TWordAlignerAlignmentResult{
        targetWords: TWord[];
        verseAlignments: TSourceTargetAlignment[];
    }
      

    //I don't need this react interface declared on the server side of the project.

    
    // interface SuggestingWordAlignerProps {
    //     style: {[key: string]: string };
    //     verseAlignments: TSourceTargetAlignment;
    //     targetWords: TWord[];
    //     translate: (key:string)=>string;
    //     contextId: TContextId;
    //     targetLanguage: string;
    //     targetLanguageFont: {};
    //     sourceLanguage: string;
    //     showPopover: (PopoverTitle: string, wordDetails: string, positionCoord: string, rawData: any) => void;
    //     lexicons: {};
    //     loadLexiconEntry: (arg:string)=>{[key:string]:string};
    //     onChange: (results: TWordAlignerAlignmentResult) => void;
    //     suggester: ((sourceSentence: string | Token[], targetSentence: string | Token[], maxSuggestions?: number, manuallyAligned: Alignment[] = []) => Suggestion[]) | null;
    // }
    // export class SuggestingWordAligner extends React.Component<SuggestingWordAlignerProps>{}

    //function removeUsfmMarkers(verse: UsfmVerse):string;
    //function usfmVerseToJson();

    


    export module usfmHelpers {
        export function removeUsfmMarkers(targetVerseText: string): string;
    }

    export module AlignmentHelpers{
        export function getWordListFromVerseObjects( verseObjects: TWord[] ): Token[];
        export function markTargetWordsAsDisabledIfAlreadyUsedForAlignments(targetWordList: Token[], alignments: TSourceTargetAlignment[]):TWord[];
        export function addAlignmentsToVerseUSFM( wordBankWords: TWord[], verseAlignments: any, targetVerseText: string ): string;
        //I see that Algnments is not spelled correctly, it is this way in the library.
        export function areAlgnmentsComplete( targetWords: TWord[], verseAlignments: TSourceTargetAlignment[] ): boolean;
    }
    */

export interface TTrainingAndTestingData {
    alignments: {
        [key: string]: {
            targetVerse: TWord[];
            sourceVerse: TWord[];
            alignments: TSourceTargetAlignment[];
        }
    };
    corpus: {
        [key: string]: {
            sourceTokens: TWord[];
            targetTokens: TWord[];
        }
    };
}

export function deepCopy(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
}


export function usfmToPerf( usfm: string ): Perf {
    const pk = new Proskomma();
    pk.importDocument({lang: "xxx", abbr: "yyy"}, "usfm", usfm);
    return JSON.parse(pk.gqlQuerySync("{documents {perf}}").data.documents[0].perf);
}

export function pullVerseFromPerf( reference: string, perf: Perf ): PerfVerse | undefined {
    if( !reference ) return undefined;
    
    const referenceParts = reference.split(":");

    if( referenceParts.length != 2 ) return undefined;

    const chapter : string = referenceParts[0];
    const verse : string = referenceParts[1];


    let currentChapter : string = "-1";
    let currentVerse : string = "-1";

    const collectedContent : any[] = [];

    //first iterate the chapters.
    //perf.sequences[perf.main_sequence_id].blocks is an array.
    for( const block of perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks ?? [] ){
        if( block.type == 'paragraph' ){
            for( const content of (block.content ?? []) ){
                if( content.type == 'mark' ){
                    if( content.subtype == 'chapter' ){
                        currentChapter = content?.atts?.number ?? "-1";
                    }else if( content.subtype == 'verses' ){
                        currentVerse = content?.atts?.number ?? "-1";
                    }
                    //if we have changed the reference and we have already
                    //collected content, then we can stop scanning and just return
                    if( collectedContent.length > 0 && currentChapter != chapter && currentVerse != verse ){
                        return collectedContent;
                    }
                }else{
                    //if we are in the correct reference then collect the content.
                    if( currentChapter == chapter && currentVerse == verse ){
                        collectedContent.push( content );
                    }
                }
            }
        }
    }

    return collectedContent;
}


export function pullVersesFromPerf( perf: Perf ): { [key: string]: PerfVerse } {
    let currentChapter : string = "-1";
    let currentVerse : string = "-1";

    const collectedContent : { [key: string]: PerfVerse } = {};

    //first iterate the chapters.
    //perf.sequences[perf.main_sequence_id].blocks is an array.
    for( const block of perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks ?? [] ){
        if( block.type == 'paragraph' ){
            for( const content of (block.content ?? []) ){
                if( content.type == 'mark' ){
                    if( content.subtype == 'chapter' ){
                        currentChapter = content?.atts?.number ?? "-1";
                    }else if( content.subtype == 'verses' ){
                        currentVerse = content?.atts?.number ?? "-1";
                    }
                }else{
                    if( currentChapter !== "-1" && currentVerse !== "-1" ){
                        const currentReference = `${currentChapter}:${currentVerse}`;
                        if( !collectedContent[currentReference] ){
                            collectedContent[currentReference] = [];
                        }

                        collectedContent[currentReference].push( content );
                    }
                }
            }
        }
    }
    return collectedContent;
}

export function chopUpPerfIntoChaptersAndVerses( filenamesToPerf: { [filename: string]: Perf } ): { [filename: string]: {[chapter: number]: {[verse: number]: PerfVerse }} } {
    const result : { [filename: string]: {[chapter: number]: {[verse: number]: PerfVerse}}} = {};

    Object.entries(filenamesToPerf).forEach(([filename, perf]) => {
        const verses = pullVersesFromPerf(perf);

        Object.entries(verses).forEach(([reference, verse]) => {
            const referenceParts = reference.split(":");

            if( referenceParts.length != 2 ) return;

            const chapterNumber : number = parseInt(referenceParts[0]);
            const verseNumber : number = parseInt(referenceParts[1]);

            if( !(filename in result) ) result[filename] = {};

            const filenameResult = result[filename];

            if( !(chapterNumber in filenameResult) ) filenameResult[chapterNumber] = {};
            const chapterResult = filenameResult[chapterNumber];

            if( !(verseNumber in chapterResult) ) chapterResult[verseNumber] = [];
            const verseResult = chapterResult[verseNumber];

            verseResult.push(...verse);
        });
    });


    return result;
}

export function replacePerfVerseInPerf( perf :Perf, perfVerse: PerfVerse, reference : string ){
    if( !reference ) return undefined;
    
    const referenceParts = reference.split(":");

    if( referenceParts.length != 2 ) return undefined;

    const chapter : string = referenceParts[0];
    const verse : string = referenceParts[1];


    let currentChapter : string = "-1";
    let currentVerse : string = "-1";

    const newMainSequenceBlocks : any[] = [];

    //iterate the chapters.
    for( const block of perf?.sequences?.[perf?.main_sequence_id ?? ""]?.blocks ?? [] ){
        if( block.type == 'paragraph' ){
            const newContent = [];
            for( const content of block.content ?? [] ){
                let dropContent  = false;
                let pushNewVerse = false;
                if( content.type == 'mark' ){
                    if( content.subtype == 'chapter' ){
                        currentChapter = content.atts?.number ?? "-1";
                    }else if( content.subtype == 'verses' ){
                        currentVerse = content.atts?.number ?? "-1";

                        //if the chapter and verse are correct, then dump the inserted content in.
                        if( currentChapter == chapter && currentVerse == verse ){
                            //I set a flag here instead of just push it because
                            //the content has to be pushed after the verse indicator
                            pushNewVerse = true;
                        }   
                    }
                }else{
                    //if we are in the existing verse, then drop all existing content
                    //so that the inserted content is not doubled.
                    if( currentChapter == chapter && currentVerse == verse ){
                        dropContent = true;
                    }
                }
                if( !dropContent ){ newContent.push(    content   );}
                if( pushNewVerse ){ newContent.push( ...perfVerse );}
            }
            newMainSequenceBlocks.push( {
                ...block,
                content: newContent
            });
        }else{
            newMainSequenceBlocks.push( block );
        }
    }

    const newPerf = {
        ...perf,
        sequences: {
            ...perf.sequences,
            [perf?.main_sequence_id ?? ""]: {
                ...perf?.sequences?.[perf?.main_sequence_id ?? ""],
                blocks: newMainSequenceBlocks
            }
        }
    };

    return newPerf;
}

// /**
//  * Adds the indexing location into tokens similar to tokenizeWords in Lexer.
//  * https://github.com/unfoldingWord/wordMAP-lexer/blob/develop/src/Lexer.ts#L20
//  * @param inputTokens - an array Wordmap Token objects.
//  * @param sentenceCharLength - the length of the sentence in characters
//  */
// export function updateTokenLocations(inputTokens : Token[], sentenceCharLength : number = -1) : void {
//     if (sentenceCharLength === -1) {
//         sentenceCharLength = inputTokens.map( t => t.toString() ).join(" ").length;
//     }
  
//     //const tokens: {text: string, position: number, characterPosition: number, sentenceTokenLen: number, sentenceCharLen: number, occurrence: number}[] = [];
//     let charPos = 0;
//     let tokenCount = 0;
//     const occurrenceIndex : {[key: string]: number }= {};
//     for (const inputToken of inputTokens) {
//         if (!occurrenceIndex[inputToken.toString()]) {
//             occurrenceIndex[inputToken.toString()] = 0;
//         }
//         occurrenceIndex[inputToken.toString()] += 1;
//         (inputToken as any).inputToken.tokenPos = tokenCount;
//         (inputToken as any).charPos = charPos;
//         (inputToken as any).sentenceTokenLen = inputTokens.length;
//         (inputToken as any).sentenceCharLen = sentenceCharLength;
//         (inputToken as any).tokenOccurrence = occurrenceIndex[inputToken.toString()];
//         tokenCount++;
//         charPos += inputToken.toString().length;
//     }
  
//     // Finish adding occurrence information
//     for( const t of inputTokens){
//       (t as any).tokenOccurrences = occurrenceIndex[t.toString()];
//     }
//   }
  


export function wordmapTokenToTWord( token: Token, type: string ): TWord {
    return {
        type,
        occurrence: token.occurrence,
        occurrences: token.occurrences,
        text: token.toString(),
        lemma: token.lemma,
        morph: token.morph,
        strong: token.strong,
        disabled: false,
        index: token.position,
    };
}

export function tWordToWordmapToken( tWord: TWord ): Token {
    return new Token( tWord );
}

export function wordMapAlignmentToTSourceTargetAlignment( alignment: Alignment ): TSourceTargetAlignment {
    return {
        sourceNgram: alignment.sourceNgram.getTokens().map( token => wordmapTokenToTWord( token, PRIMARY_WORD  ) ),
        targetNgram: alignment.targetNgram.getTokens().map( token => wordmapTokenToTWord( token, SECONDARY_WORD) ),
    };
}

export function tSourceTargetAlignmentToWordmapAlignment( tSourceTargetAlignment: TSourceTargetAlignment ): Alignment {
    return new Alignment(
        new Ngram( tSourceTargetAlignment.sourceNgram.map( tWordToWordmapToken ) ),
        new Ngram( tSourceTargetAlignment.targetNgram.map( tWordToWordmapToken ) )
    );
}

export function tSourceTargetPredictionToWordmapPrediction( tSourceTargetPrediction: TSourceTargetPrediction ): Prediction {
    const prediction: Prediction = new Prediction( tSourceTargetAlignmentToWordmapAlignment(tSourceTargetPrediction.alignment) );
    prediction.setScore( "confidence", tSourceTargetPrediction.confidence );
    return prediction;
}

export function wordmapPredictionToTSourceTargetPrediction( prediction: Prediction ): TSourceTargetPrediction {
    return {
        alignment: wordMapAlignmentToTSourceTargetAlignment( prediction.alignment ),
        confidence: prediction.getScore("confidence")
    };
}

export function tAlignmentSuggestionToWordmapSuggestion( tAlignmentSuggestion: TAlignmentSuggestion ): Suggestion {
    const predictions: Prediction[] = tAlignmentSuggestion.predictions.map( tSourceTargetPredictionToWordmapPrediction );
    const suggestion: Suggestion = new Suggestion( );
    //The tokens in the prediction don't have their index set so using the addPrediction gets the alignments all of order.
    //predictions.forEach( prediction => suggestion.addPrediction( prediction ) );
    (suggestion as any).predictions.push( ...predictions );
    return suggestion;
}

export function wordmapSuggestionToTAlignmentSuggestion( suggestion: Suggestion ): TAlignmentSuggestion {
    return {
        predictions: suggestion.getPredictions().map( prediction => wordmapPredictionToTSourceTargetPrediction( prediction ) ),
        confidence: suggestion.compoundConfidence()
    };
}


function perfContentToTWord( perfContent: any, type: string ): TWord {
    const word : TWord = {
        type
    };

    if (perfContent?.atts?.["x-occurrence" ] ) { word["occurrence" ] = parseInt(perfContent.atts["x-occurrence" ].join(" ")); }
    if (perfContent?.atts?.["x-occurrences"] ) { word["occurrences"] = parseInt(perfContent.atts["x-occurrences"].join(" ")); }
    if (perfContent?.atts?.["x-content"    ] ) { word["text"       ] =          perfContent.atts["x-content"    ].join(" ");  }
    if (perfContent?.      ["content"      ] ) { word["text"       ] =          perfContent.content              .join(" ");  }
    if (perfContent?.atts?.["x-lemma"      ] ) { word["lemma"      ] =          perfContent.atts["x-lemma"      ].join(" ");  }
    if (perfContent?.atts?.["lemma"        ] ) { word["lemma"      ] =          perfContent.atts["lemma"        ].join(" ");  }
    if (perfContent?.atts?.["x-morph"      ] ) { word["morph"      ] =          perfContent.atts["x-morph"      ].join(",");  }
    if (perfContent?.atts?.["x-strong"     ] ) { word["strong"     ] =          perfContent.atts["x-strong"     ].join(" ");  }
    if (perfContent?.atts?.["strong"       ] ) { word["strong"     ] =          perfContent.atts["strong"       ].join(" ");  }
    return word;
}


function computeOccurrenceInformation( words: TWord[] ){
    const wordsCopy = deepCopy( words );
    const occurrenceMap = new Map<string, number>();
    for( const word of wordsCopy ){
        const occurrence = (occurrenceMap.get( word.text ) || 0) + 1;
        occurrenceMap.set( word.text, occurrence );
        word.occurrence = occurrence;
    }
    for( const word of wordsCopy ){
        word.occurrences = occurrenceMap.get( word.text );
    }
    return wordsCopy;
}

export function extractWrappedWordsFromPerfVerse( perfVerse: PerfVerse, type: string, reindexOccurrences: boolean = false ): TWord[] {
    let wrappedWords : TWord[] = [];
    let inMapping = false;
    let index = 0;
    for( const content of perfVerse ){
        //If content is a string just skip it.  It is like commas and stuff.
        if( typeof content == 'string' ){
            //pass
        }else if( content.type == "wrapper" && content.subtype == "usfm:w" ){
            const wrappedWord = perfContentToTWord( content, type );
            wrappedWord.disabled = inMapping; //If the word is mapped then disable it for the wordBank.
            wrappedWord.index = index++;
            wrappedWords.push( wrappedWord );
        }else if( content.type == "start_milestone" && content.subtype == "usfm:zaln" ){
            inMapping = true;
        }else if( content.type == "end_milestone" && content.subtype == "usfm:zaln" ){
            //I know the end_milestone can come in clumps, but this works anyways.
            inMapping = false;
        }
    }
    //recompute occurrence information if it doesn't exist.
    if( wrappedWords.length > 0 && (!wrappedWords[0].occurrence || reindexOccurrences) ){
        wrappedWords = computeOccurrenceInformation( wrappedWords );
    }
    return wrappedWords;
}

export function extractTextFromPerfVerse( perfVerse: PerfVerse ): string {
    let result : string = "";

    for( const content of perfVerse ){
        if( typeof content == 'string' ){
            result += content;
        }else if( content.type == "wrapper" && content.subtype == "usfm:w" ){
            result += content.content;
        }
    }

    return result;
}

export function extractAlignmentsFromPerfVerse( perfVerse: PerfVerse ): TSourceTargetAlignment[] {
    const alignments : TSourceTargetAlignment[] = [];
    const sourceStack : any[] = [];
    const targetStack : any[] = [];

    //we need to stash alignments as we make them so that further words that get
    //added to them can get poked into existing ones.
    const sourceNgramHashToAlignment = new Map<string, any>();

    let targetIndex = 0;
    for( const content of perfVerse ){

        if( content.type == "start_milestone" && content.subtype == "usfm:zaln" ){
            //we can't index the source words right now because they are out of order.
            //we will do it later when the alignments are supplemented with the unused source words.
            sourceStack.push( perfContentToTWord(content, PRIMARY_WORD) );

            //If there are any target words then just drop them because they aren't part of this
            //group.
            targetStack.length = 0;
        }else if( content.type == "end_milestone" && content.subtype == "usfm:zaln" ){
            //process the source and target stacks when we are a place where we are popping
            if( targetStack.length > 0 ){
                const sourceNgram = [...sourceStack];
                const targetNgram = [...targetStack];

                const sourceNgramHash = hashNgramToString( sourceNgram );

                //If we have already seen the source ngram then add the target ngram to it
                if( !sourceNgramHashToAlignment.has( sourceNgramHash ) ){
                    const newAlignment = { sourceNgram, targetNgram };
                    sourceNgramHashToAlignment.set( sourceNgramHash, newAlignment );
                    alignments.push( newAlignment );
                }else{
                    const existingAlignment = sourceNgramHashToAlignment.get( sourceNgramHash );
                    existingAlignment.targetNgram = [...existingAlignment.targetNgram, ...targetNgram];
                }
                //clear the targetStack
                targetStack.length = 0;
            }

            sourceStack.pop();
        }else if( content.type == "wrapper" && content.subtype == "usfm:w" ){
            const wrappedWord = perfContentToTWord( content, SECONDARY_WORD );
            wrappedWord.index = targetIndex++;
            targetStack.push( wrappedWord );
        }
    }
    return alignments;
}

function hashWordToString( word: TWord ){
    return `${word.text}-${word.occurrence}`;
}

function hashNgramToString( ngram: TWord[] ){
    return ngram?.map( ( word: TWord ) => hashWordToString( word ) )?.join("/");
}

export function sortAndSupplementFromSourceWords( sourceWords:any, alignments:any ){
    //Hash the source word list so that we can find them when going through the alignment source words.
    const sourceWordHashToSourceWord = Object.fromEntries( sourceWords.map( ( word : any ) => {
        return [ hashWordToString( word ), word ];
    }));
    //now hash all the sources to indicate which ones are represented so we can add the ones which are not.
    const sourceWordHashToExistsBool = alignments.reduce( (acc:any, cur:any) => {
        cur.sourceNgram.forEach( ( word :any  ) => {
            acc[ hashWordToString( word ) ] = true;
        });
        return acc;
    }, {});

    //now create an array of the sourceWords which are not represented.
    const newSourceWords = sourceWords.filter( ( word : any ) => {
        return !( hashWordToString( word ) in sourceWordHashToExistsBool );
    });

    //now create bogus alignments for the new source words.
    const newAlignments = newSourceWords.map( ( word : any ) => {
        //return a bogus alignment
        return {
            sourceNgram: [ word ],
            targetNgram: []
        };
    });

    //Now create a new list which has both the new alignments and the old alignments
    const combinedAlignments = alignments.concat( newAlignments );

    //Get the index set on all the source words in the alignment.
    const sourceIndexedAlignments = combinedAlignments.map( ( alignment : any, index : number ) => {
        const indexedSourceNgram = alignment.sourceNgram.map( ( sourceWord : any ) => {
            return {
                ...sourceWord,
                index: sourceWordHashToSourceWord[ hashWordToString( sourceWord  )  ]?.index ?? -1
            };
        });
        return {
            ...alignment,
            sourceNgram: indexedSourceNgram
        };
    });
    
    //now sort the alignment based on index of the first source word.
    sourceIndexedAlignments.sort( ( a : any, b : any ) => {
        return a.sourceNgram[0].index - b.sourceNgram[0].index;
    });

    //now give each alignment an index.
    const indexedAlignments = sourceIndexedAlignments.map( ( alignment : any, index : number ) => {
        return {
            ...alignment,
            index
        };
    });

    return indexedAlignments;
}

export function reindexPerfVerse( perfVerse: PerfVerse ): PerfVerse {
    const perfVerseCopy = deepCopy( perfVerse );
    const occurrenceMap = new Map<string, number>();
    for( const perfContent of perfVerseCopy ){
        if( ("type" in perfContent) && perfContent.type == "wrapper" && 
        ("subtype" in perfContent) && perfContent.subtype == "usfm:w" ){
            const text = (perfContent?.["content"])?perfContent.content.join(" "):"";
            const occurrence = (occurrenceMap.get( text ) || 0) + 1;
            occurrenceMap.set( text, occurrence );
            if( !perfContent.atts ) perfContent.atts = {};
            perfContent.atts["x-occurrence" ] = [ "" + occurrence ];
        }
    }
    for( const perfContent of perfVerseCopy ){
        if( ("type" in perfContent) && perfContent.type == "wrapper" && 
        ("subtype" in perfContent) && perfContent.subtype == "usfm:w" ){
            const text = (perfContent?.["content"])?perfContent.content.join(" "):"";
            if( !perfContent.atts ) perfContent.atts = {};
            perfContent.atts["x-occurrences" ] = [ "" + occurrenceMap.get( text ) ];
        }
    }
    return perfVerseCopy;
}


export async function mergeAlignmentPerf( strippedUsfmPerf: Perf, strippedAlignment: PerfAlignment ): Promise<Perf | undefined> {
    try{
        const pipelineH = new PipelineHandler({proskomma: new Proskomma()});
        const mergeAlignmentPipeline_output = await pipelineH.runPipeline('mergeAlignmentPipeline', {
            perf: strippedUsfmPerf,
            strippedAlignment,
        });
        return mergeAlignmentPipeline_output.perf;
    }catch( e ){
        console.log( e );
    }
    return undefined;
}

export function replaceAlignmentsInPerfVerse( perfVerse: PerfVerse, newAlignments: TSourceTargetAlignment[] ): PerfVerse{
    const result : PerfVerse = [];

    const withoutOldAlignments = perfVerse.filter( ( perfContent : any ) => {
        if( ("type" in perfContent) && 
        (perfContent.type == "start_milestone" || perfContent.type == "end_milestone") &&
        ("subtype" in perfContent) && perfContent.subtype == "usfm:zaln" ){
            return false;
        }
        return true;
    });

    //this indicates what the current source alignment stack is so we know when it needs to change.
    let currentSourceAlignmentHash = "";
    let currentSourceAlignmentLength = 0;

    //hash each of the target words to the alignment which contains them.
    const targetWordHashToAlignment = new Map<string, any>();
    for( const alignment of newAlignments ){
        for( const targetWord of alignment.targetNgram ){
            targetWordHashToAlignment.set( hashWordToString( targetWord ), alignment );
        }
    }

    const closeSourceRange = () => {
        //we can just put it at the end but we will instead look backwards and find the last place
        //a word wrapper is and put it after that.
        let lastWordIndex = result.length - 1;
        while( lastWordIndex >= 0 && 
         !(( "type"    in result[lastWordIndex]) && result[lastWordIndex].type    == "wrapper" && 
           ( "subtype" in result[lastWordIndex]) && result[lastWordIndex].subtype == "usfm:w") ){
            lastWordIndex--;
        }

        //take out the old source alignment
        //by inserting in after lastWordIndex
        for( let i = 0; i < currentSourceAlignmentLength; i++ ){
            const newEndMilestone : any = { 
                type: "end_milestone", 
                subtype: "usfm:zaln"
            };
            result.splice( lastWordIndex + i + 1, 0, newEndMilestone );
        }
    };

    for( const perfContent of withoutOldAlignments ){
        //Only do something different if it is a wrapped word.
        if( ("type" in perfContent) && perfContent.type == "wrapper" && 
        ("subtype" in perfContent) && perfContent.subtype == "usfm:w" ){
            
            const relevantAlignment = targetWordHashToAlignment.get( hashWordToString( perfContentToTWord( perfContent, SECONDARY_WORD ) ) );

            //If the current currentSourceAlignmentHash is not correct and it is set we need to close it out.
            if( currentSourceAlignmentHash != (hashNgramToString(relevantAlignment?.sourceNgram) ?? "") ){
                closeSourceRange();

                //add in the new alignment.
                if( relevantAlignment ){
                    for( const sourceToken of relevantAlignment.sourceNgram ){
                        const newStartMilestone : any= {
                            type: "start_milestone",
                            subtype: "usfm:zaln",
                            atts: {}
                        };
                        if( ("strong"      in sourceToken) ){ newStartMilestone.atts["x-strong"      ] = [ "" + sourceToken.strong         ]; }
                        if( ("lemma"       in sourceToken) ){ newStartMilestone.atts["x-lemma"       ] = [ "" + sourceToken.lemma          ]; }
                        if( ("morph"       in sourceToken) ){ newStartMilestone.atts["x-morph"       ] =        sourceToken.morph.split(","); }
                        if( ("occurrence"  in sourceToken) ){ newStartMilestone.atts["x-occurrence"  ] = [ "" + sourceToken.occurrence     ]; }
                        if( ("occurrences" in sourceToken) ){ newStartMilestone.atts["x-occurrences" ] = [ "" + sourceToken.occurrences    ]; }
                        if( ("text"        in sourceToken) ){ newStartMilestone.atts["x-content"     ] = [ "" + sourceToken.text           ]; }
                        result.push( newStartMilestone );
                    }
                    currentSourceAlignmentHash = hashNgramToString(relevantAlignment.sourceNgram);
                    currentSourceAlignmentLength = relevantAlignment.sourceNgram.length;
                }else{
                    currentSourceAlignmentHash = "";
                    currentSourceAlignmentLength = 0;
                }
            }
        }

        result.push( perfContent );
    }


    //now close out any remaining source alignment.
    closeSourceRange();
    currentSourceAlignmentHash = "";
    currentSourceAlignmentLength = 0;

    //Note, this will not work correctly if the alignment spans multiple verses.  But we have issues otherwise if this is the case.

    return result;
}




/**
 * Asynchronously retrieves the source map.  The source map is what
 * maps source files (greek, hebrew) from the target files that you are working
 * with.
 * @return {Promise<{ [key: string]: string[] }>} The retrieved source map
 */
export async function getSourceFolders( getConfiguration: (key: string) => Promise<any> ) : Promise< string[] >{
    
    console.log( "requesting sourceFolders." );

    //let sourceFolders : string[] | undefined = vscode.workspace?.getConfiguration("usfmEditor").get("sourceFolders" );
    let sourceFolders : string[] | undefined = await getConfiguration( "sourceFolders" );
    
    //if sourceFolders is undefined, then get the default.
    if( sourceFolders === undefined ) { sourceFolders = []; }

    //if sourceFolders is a string wrap it in an array.
    if( typeof sourceFolders === 'string' ){ sourceFolders = [sourceFolders]; }


    return sourceFolders;
}



