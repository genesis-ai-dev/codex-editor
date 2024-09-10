import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { promisify } from 'util';

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
        places: string[];
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
        locations: string[];
        verses: string[];
        eventID: string;
        modified: string;
        verseSort: string;
        sortKey: number;
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
        const fileUri = vscode.Uri.joinPath(context.extensionUri, 'src', 'assets', 'bible_data_with_vref_keys.json.gz');
        const compressedData = await vscode.workspace.fs.readFile(fileUri);
        const decompressed = await gunzip(compressedData) as Buffer;
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
        console.log('Bible data loaded successfully!', { bibleDataIdIndex });
        vscode.window.showInformationMessage('Bible data loaded successfully!');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load Bible data: ${error}`);
    }
}

const getLinkedBibleDataRecords = (vref: string): { category: string; record: any }[] => {
    const linkedRecords = [];
    const verse = bibleData?.verses[vref];
    if (verse) {
        // Get linked people records
        for (const linkedId of verse.fields.people) {
            const linkedRecord = bibleDataIdIndex?.get(linkedId);
            if (linkedRecord) {
                linkedRecords.push(linkedRecord);
            }
        }
        // Get linked places records
        for (const linkedId of verse.fields["places"]) {
            const linkedRecord = bibleDataIdIndex?.get(linkedId);
            if (linkedRecord) {
                linkedRecords.push(linkedRecord);
            }
        }
        // Get linked events records
        for (const linkedId of verse.fields["timeline"]) {
            const linkedRecord = bibleDataIdIndex?.get(linkedId);
            if (linkedRecord) {
                linkedRecords.push(linkedRecord);
            }
        }
    }
    return linkedRecords;
};


export async function getBibleDataRecordById(id: string): Promise<{ record: any, prose: string } | null> {
    if (!bibleDataIdIndex) {
        throw new Error('Bible data not loaded');
    }
    const record = bibleDataIdIndex.get(id) || null;
    const prose = generateVerseContext(id, bibleDataIdIndex);
    return { record, prose };
}






// Rendering functions





/**
 * Renders a verse and its related data as prose.
 * @param verse The verse object to render
 * @param linkedRecords An object containing linked records (events, people, places, etc.)
 * @returns A string of formatted prose describing the verse and its context
 */
function renderVerseAsProse(verse: Verse, linkedRecords: Record<string, any>): string {
    let prose = `Verse: ${verse.fields.verseText}\n\n`;

    prose += renderEventsDescribed(verse);
    prose += renderTimelineEvents(verse, linkedRecords);
    prose += renderPlacesInVerse(verse, linkedRecords);

    return prose;
}

function renderEventsDescribed(verse: Verse): string {
    if (!verse.fields.eventsDescribed) return '';
    return `Events described in this verse:\n- ${verse.fields.eventsDescribed}\n\n`;
}

function renderTimelineEvents(verse: Verse, linkedRecords: Record<string, any>): string {
    if (!verse.fields.timeline || verse.fields.timeline.length === 0) return '';

    let prose = 'Timeline in this verse:\n';
    for (const eventId of verse.fields.timeline) {
        const event = linkedRecords[eventId] as Event;
        if (!event) continue;

        prose += `- ${event.fields.title} (Duration: ${event.fields.duration})\n`;
        prose += renderEventDetails(event, linkedRecords);
    }
    return prose + '\n';
}

function renderEventDetails(event: Event, linkedRecords: Record<string, any>): string {
    let prose = '';

    // Render participants
    if (event.fields.participants && event.fields.participants.length > 0) {
        prose += '  Participants:\n';
        for (const participantId of event.fields.participants) {
            const participant = linkedRecords[participantId] as Person;
            if (participant) {
                prose += `  - ${participant.fields.displayTitle}\n`;
            }
        }
    }

    // Render locations
    if (event.fields.locations && event.fields.locations.length > 0) {
        prose += '  Locations:\n';
        for (const locationId of event.fields.locations) {
            const location = linkedRecords[locationId] as Place;
            if (location) {
                prose += `  - ${location.fields.displayTitle}\n`;
            }
        }
    }

    // Render verses involved in this event
    if (event.fields.verses && event.fields.verses.length > 0) {
        prose += `  Verses in this event: ${event.fields.verses.join(', ')}\n`;
    }

    return prose;
}

function renderPlacesInVerse(verse: Verse, linkedRecords: Record<string, any>): string {
    if (!verse.fields.placesCount || verse.fields.placesCount === 0) return '';

    let prose = 'Places mentioned in this verse:\n';
    for (const placeId of verse.fields.places) {
        const place = linkedRecords[placeId] as Place;
        if (!place) continue;

        prose += `- ${place.fields.displayTitle} (${place.fields.featureType}`;
        if (place.fields.featureSubType) {
            prose += ` - ${place.fields.featureSubType}`;
        }
        prose += ')\n';

        if (place.fields.comment) {
            prose += `  Comment: ${place.fields.comment}\n`;
        }
    }
    return prose + '\n';
}

// Additional functions can be added here for rendering other types of data
// such as people, people groups, periods, etc., as needed.

/**
 * Main function to generate prose for a given verse reference
 * @param vref The verse reference (e.g., "ACT 2:10")
 * @param bibleDataIdIndex The index of the Bible data object
 * @returns A string of formatted prose describing the verse and its context
 */
export function generateVerseContext(vref: string, bibleDataIdIndex: Map<string, { category: string; record: any }>): string {
    const verse = bibleDataIdIndex.get(vref);
    if (!verse) return `No data found for verse ${vref}`;

    const linkedRecords = getLinkedBibleDataRecords(vref);
    return renderVerseAsProse(verse.record, linkedRecords);
}
