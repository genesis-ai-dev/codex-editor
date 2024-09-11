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


export async function getBibleDataRecordById(id: string): Promise<{ record: any, /* prose: string */ } | null> {
    if (!bibleDataIdIndex) {
        throw new Error('Bible data not loaded');
    }
    const record = bibleDataIdIndex.get(id) || null;
    // const prose = generateVerseContext(id, bibleDataIdIndex);
    return { record };
}






// Rendering functions





/**
 * Renders a verse and its related data as prose.
 * @param verse The verse object to render
 * @param linkedRecords An object containing linked records (events, people, places, etc.)
 * @returns A string of formatted prose describing the verse and its context
 */
// function renderVerseAsProse(verse: Verse, linkedRecords: Record<string, any>): string {
//     let prose = `Verse: ${verse.fields.verseText}\n\n`;

//     prose += renderEventsDescribed(verse);
//     prose += renderEventDetails(event);
//     prose += renderPlacesInVerse(verse, linkedRecords);

//     return prose;
// }

function renderEventsDescribed(verse: Verse): string {
    if (!verse.fields.eventsDescribed) return '';
    return `Events described in this verse:\n- ${verse.fields.eventsDescribed}\n\n`;
}

function renderEventDetails(event: Event): string {
    if (!event || !bibleDataIdIndex) return '';

    let prose = `Details of the event: ${event.fields.title}\n`;

    if (event.fields.startDate) {
        prose += `  - Start Date: ${event.fields.startDate}\n`;
    }
    if (event.fields.duration) {
        prose += `  - Duration: ${event.fields.duration}\n`;
    }

    // Render participants
    if (event.fields.participants && event.fields.participants.length > 0) {
        prose += '  Participants:\n';
        for (const participantId of event.fields.participants) {
            const participant = bibleDataIdIndex.get(participantId)?.record as Person;
            if (participant) {
                prose += `  - ${participant.fields.displayTitle}\n`;
            }
        }
    }

    // Render locations
    if (event.fields.locations && event.fields.locations.length > 0) {
        prose += '  Locations:\n';
        for (const locationId of event.fields.locations) {
            const location = bibleDataIdIndex.get(locationId)?.record as Place;
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

function renderPersonInVerse(person: Person): string {
    if (!person) return '';

    let prose = `- ${person.fields.displayTitle || person.fields.name} (${person.fields.gender})`;

    const yearStart = person.fields.birthYear || person.fields.minYear || null;
    const yearEnd = person.fields.deathYear || person.fields.maxYear || null;

    if (yearStart) {
        prose += ` ${yearStart}`;
    }
    if (person.fields.birthPlace) {
        prose += ` in ${person.fields.birthPlace}`;
    }
    if (yearEnd) {
        prose += ` – ${yearEnd}`;
    }
    if (person.fields.deathPlace) {
        prose += ` in ${person.fields.deathPlace}`;
    }

    return prose;
}


function renderPlaceInVerse(place: Place): string {
    let prose = '';
    if (!place) return prose;

    prose += `- ${place.fields.displayTitle} (${place.fields.featureType}`;
    if (place.fields.featureSubType) {
        prose += ` (${place.fields.featureSubType})`;
    }
    prose += ')\n';

    if (place.fields.comment) {
        prose += `  Comment: ${place.fields.comment}\n`;
    }
    return prose;
}

// Additional functions can be added here for rendering other types of data
// such as people, people groups, periods, etc., as needed.


export interface TheographicBibleDataRecord {
    verse: Verse | null;
    people: string[];
    places: string[];
    events: string[];
    eventsDescribed: string;
}
/**
 * Main function to generate prose for a given verse reference
 * @param vref The verse reference (e.g., "ACT 2:10")
 * @param bibleDataIdIndex The index of the Bible data object
 * @returns A string of formatted prose describing the verse and its context
 */
export async function generateVerseContext(vref: string): Promise<TheographicBibleDataRecord> {
    const verseRecord = bibleDataIdIndex?.get(vref);
    const verse = verseRecord?.record as Verse;
    if (!verse || !bibleDataIdIndex) return {
        verse: null,
        people: [],
        places: [],
        events: [],
        eventsDescribed: '',
    };

    const { peopleCount, people, placesCount, places, timeline, eventsDescribed } = verse.fields;

    const peopleIdsInVerse = peopleCount > 0 ? verse.fields.people || [] : [];
    const placeIdsInVerse = placesCount > 0 ? verse.fields.places || [] : [];
    const eventsDescribedInVerse = eventsDescribed || '';
    const eventIdsInVerse = timeline || [];

    console.log('DEBUG', { peopleIdsInVerse, placeIdsInVerse, eventIdsInVerse });

    const fetchAndProcessRecords = async <T>(ids: string[], renderFunction: (record: T) => string): Promise<string[]> => {
        try {
            const records = await Promise.all(ids.map(id => getBibleDataRecordById(id)));
            return records
                .filter((record): record is { record: T } => record !== null && record !== undefined)
                .map(({ record }) => renderFunction(record as T));
        } catch (error) {
            console.error(`Error fetching records: ${error}`);
            return [];
        }
    };

    const [peopleStrings, placesStrings, eventsStrings] = await Promise.all([
        fetchAndProcessRecords<Person>(peopleIdsInVerse, renderPersonInVerse),
        fetchAndProcessRecords<Place>(placeIdsInVerse, renderPlaceInVerse),
        fetchAndProcessRecords<Event>(eventIdsInVerse, renderEventDetails)
    ]);

    return {
        verse,
        people: peopleStrings,
        places: placesStrings,
        events: eventsStrings,
        eventsDescribed: eventsDescribedInVerse,
    };
}
