

export interface TAttributedChar {
    char: string;
    blockIndex: number;
    contentIndex: number;
    charIndex: number;
    isMeta: boolean;
}


export interface TAttributedString extends Array<TAttributedChar> {}


export enum DiffState {
    STATE_MATCH,
    STATE_PASSING_1ST,
    STATE_PASSING_2ND
}


class LineCompIndex {
    errorCount: number;
    previous: LineCompIndex | null;
    state: DiffState;
    content: TAttributedChar;

    constructor() {
        this.errorCount = 0;
        this.previous = null;
        this.state = DiffState.STATE_PASSING_1ST;
        this.content = { char: "", blockIndex: 0, contentIndex: 0, charIndex: 0, isMeta: false };
    }
}

export function traceDiffs( content1: TAttributedString, content2: TAttributedString ){
    let lastLine : LineCompIndex[] = [];
    let thisLine : LineCompIndex[] = [];

    //init the root root
    let thisIndex = new LineCompIndex();
    thisIndex.state = DiffState.STATE_MATCH;
    thisLine.push(thisIndex);

    //init the root top case
    let columnIndex = 1;
    content2.forEach( (char2, index2) => {
        thisIndex = new LineCompIndex();
        thisIndex.previous = thisLine[ columnIndex-1 ];
        thisIndex.errorCount = thisIndex.previous.errorCount+1;
        thisIndex.content = char2;
        thisIndex.state = DiffState.STATE_PASSING_2ND;
        thisLine.push( thisIndex );
        columnIndex += 1;
    });

    content1.forEach( (char1, index1) => {
        lastLine = thisLine;
        thisLine = [];

        //init the root left case
        thisIndex = new LineCompIndex();
        thisIndex.previous = lastLine[ 0 ];
        thisIndex.errorCount = thisIndex.previous.errorCount+1;
        thisIndex.content = char1;
        thisIndex.state = DiffState.STATE_PASSING_1ST;
        thisLine.push( thisIndex );

        columnIndex = 1;
        for (const char2 of content2) {
            thisIndex = new LineCompIndex();

            if( char2.char == char1.char && char2.isMeta == char1.isMeta ){
                thisIndex.previous = lastLine[ columnIndex-1 ];
                thisIndex.errorCount = thisIndex.previous.errorCount;

                thisIndex.state = DiffState.STATE_MATCH;
                thisIndex.content = char1;

            }else{
                if( lastLine[ columnIndex ].errorCount < thisLine[ columnIndex-1 ].errorCount ){
                    thisIndex.previous = lastLine[ columnIndex ];
                    thisIndex.content = char1;
                    thisIndex.state = DiffState.STATE_PASSING_1ST;
                }else{
                    thisIndex.previous = thisLine[ columnIndex-1 ];
                    thisIndex.content = char2;
                    thisIndex.state = DiffState.STATE_PASSING_2ND;
                }

                thisIndex.errorCount = thisIndex.previous.errorCount+1;
            }

            thisLine.push( thisIndex );
            columnIndex += 1;
        }
    });

    const backwardsList : LineCompIndex[] = [];
    let currentNode : LineCompIndex | null = thisLine[ thisLine.length-1 ];
    while( currentNode != null ){
        backwardsList.push( currentNode);
        currentNode = currentNode.previous;
    }

    const forwardsList = backwardsList.reverse();

    return forwardsList;
}