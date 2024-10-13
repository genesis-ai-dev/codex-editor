import { vrefData } from "./../../utils/verseRefUtils/verseData";

export async function s2sCompletion(
    language: string,
    vref: string,
    currentLineContent: string
): Promise<string | null> {
    const baseUrl = "https://0e8e6cb00ffb2b6166.gradio.live/call/translate"; // FIXME: this should be a config, and if it is not available, then the function should return null
    //hardcode "language" for now.
    language = "NETfree";

    // Note: we need to reconstruct the vref to include the full book name instead of just the abbreviation
    const fullBookName = vrefData[vref.split(" ")[0]]?.["name"];
    if (!fullBookName) {
        console.error(`Invalid vref passed to s2sCompletion: ${vref}`);
        return null;
    }

    const reconstructedVref = `${fullBookName} ${vref.split(" ")[1]}`;

    console.log(
        `Calling with forced_output_string set to ${currentLineContent} and reference set to ${reconstructedVref} (full book name: ${fullBookName})`
    );

    try {
        // First request to get the event ID
        const initialResponse = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                data: [language, reconstructedVref, currentLineContent],
                stream: false,
            }),
        });

        if (!initialResponse.ok) {
            throw new Error(`HTTP error! status: ${initialResponse.status}`);
        }

        const initialResult = await initialResponse.json();
        const eventId = initialResult.event_id;

        // Second request to get the actual result
        const resultResponse = await fetch(`${baseUrl}/${eventId}`);

        if (!resultResponse.ok) {
            throw new Error(`HTTP error! status: ${resultResponse.status}`);
        }
        const result = await resultResponse.text();
        console.log(`Raw result: ${result}`);

        // Extract the array content using regex
        const match = result.match(/\[.*\]/);
        if (!match) {
            console.error("Unexpected result format");
            return null;
        }

        try {
            const parsedResult = JSON.parse(match[0]);
            if (Array.isArray(parsedResult) && parsedResult.length > 0) {
                const completion = parsedResult[0];
                console.log(`Extracted completion: ${completion}`);
                return completion;
            } else {
                console.error("Parsed result is not an array or is empty");
                return null;
            }
        } catch (error) {
            console.error("Error parsing result:", error);
            return null;
        }

        return result;
    } catch (error) {
        console.error("Error in s2sCompletion:", error);
        return null;
    }
}
