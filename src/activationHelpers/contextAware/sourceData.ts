export interface Verse {
    id: string;
    createdTime: string;
    fields: {
        osisRef: string;
        verseNum: string;
        verseText: string;
        book: string[];
        eventsDescribed: string;
        people: string[];
        yearNum: number;
        chapter: string[];
        status: string;
        mdText: string;
        richText: string;
        verseID: string;
        timeline: string[];
        peopleCount: number;
        placesCount: number;
        modified: string;
    };
}

export interface Easton {
    id: string;
    createdTime: string;
    fields: {
        dictLookup: string;
        termID: string;
        termLabel: string;
        def_id: string;
        has_list: string;
        itemNum: number;
        matchType: string;
        matchSlugs: string;
        dictText: string;
        index: number;
    };
}

export interface Event {
    id: string;
    createdTime: string;
    fields: {
        title: string;
        startDate: string;
        duration: string;
        participants: string[];
        verses: string[];
        eventID: string;
        modified: string;
        verseSort: string;
        sortKey: number;
        "people (from verses)": string[];
    };
}

export interface Person {
    id: string;
    createdTime: string;
    fields: {
        personLookup: string;
        personID: string;
        name: string;
        isProperName: boolean;
        gender: string;
        birthYear: string[];
        deathYear: string[];
        memberOf: string[];
        birthPlace: string[];
        deathPlace: string[];
        dictionaryLink: string;
        dictionaryText: string;
        verses: string[];
        siblings: string[];
        mother: string[];
        father: string[];
        children: string[];
        displayTitle: string;
        status: string;
        partners: string[];
        eastons: string[];
        timeline: string[];
        verseCount: number;
        minYear: number;
        maxYear: number;
        alphaGroup: string;
        slug: string;
        "Easton's Count": number;
        dictText: string[];
        modified: string;
    };
}

export interface PeopleGroup {
    id: string;
    createdTime: string;
    fields: {
        groupName: string;
        members: string[];
        events_dev: string[];
        modified: string;
    };
}

export interface Period {
    id: string;
    createdTime: string;
    fields: {
        yearNum: string;
        peopleBorn: string[];
        events: string;
        isoYear: number;
        "BC-AD": string;
        formattedYear: string;
        modified: string;
    };
}

export interface Place {
    id: string;
    createdTime: string;
    fields: {
        placeLookup: string;
        openBibleLat: string;
        openBibleLong: string;
        kjvName: string;
        esvName: string;
        comment: string;
        featureType: string;
        placeID: string;
        recogitoUri: string;
        recogitoLat: string;
        recogitoLon: string;
        verses: string[];
        recogitoStatus: string;
        recogitoLabel: string;
        recogitoUID: string;
        status: string;
        displayTitle: string;
        eastons: string[];
        featureSubType: string;
        verseCount: number;
        latitude: string;
        longitude: string;
        alphaGroup: string;
        slug: string;
        dictText: string[];
        modified: string;
    };
}

import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

export interface BibleData {
    verses: Record<string, Verse>;
    easton: Record<string, Easton>;
    events: Record<string, Event>;
    people: Record<string, Person>;
    peopleGroups: Record<string, PeopleGroup>;
    periods: Record<string, Period>;
    places: Record<string, Place>;
}

let bibleData: BibleData | null = null;
let bibleDataIdIndex: Map<string, { category: string; record: any }> | null = null;

export async function initializeBibleData(context: vscode.ExtensionContext) {
    try {
        const fileUri = vscode.Uri.joinPath(context.extensionUri, 'src', 'assets', 'bible_data.json.gz');
        const compressedData = await vscode.workspace.fs.readFile(fileUri);
        const decompressed = await gunzip(compressedData);
        bibleData = JSON.parse(decompressed.toString()) as BibleData;

        if (bibleData) {
            bibleDataIdIndex = new Map<string, { category: string; record: Verse | Easton | Event | Person | PeopleGroup | Period | Place }>();
            for (const [category, records] of Object.entries(bibleData)) {
                for (const record of Object.values(records)) {
                    if (typeof record === 'object' && record !== null && 'id' in record && typeof record.id === 'string') {
                        bibleDataIdIndex.set(record.id, { category, record });
                    }
                }
            }
        }

        // Register the command
        const disposable = vscode.commands.registerCommand('extension.getRecordById', getRecordById);
        context.subscriptions.push(disposable);

        vscode.window.showInformationMessage('Bible data loaded successfully!');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load Bible data: ${error}`);
    }
}

export async function getRecordById(id: string): Promise<{ category: string; record: any } | null> {
    if (!bibleDataIdIndex) {
        throw new Error('Bible data not loaded');
    }
    if (!id) {
        vscode.window.showQuickPick(['rec7mkRLwey2ntUG9',
            "reco82mzy0XTzaOgv",
        ]).then(selectedId => {
            if (selectedId) {
                return bibleDataIdIndex?.get(selectedId) || null;
            }
        });
    }
    return bibleDataIdIndex.get(id) || null;
}

// // This function can be called from other parts of your extension
// export function getRecordByIdSync(id: string): { category: string; record: any } | null {
//     if (!bibleData) {
//         return null;
//     }

//     for (const [category, records] of Object.entries(bibleData)) {
//         if (id in records) {
//             return { category, record: records[id] };
//         }
//     }

//     return null;
// }



