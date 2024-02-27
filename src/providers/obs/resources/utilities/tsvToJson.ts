export default function tsvToJson(tsv: string) {
    const result = [];

    if (tsv) {
        const lines = tsv.trim().split("\n");
        const headers = lines[0].split("\t");

        for (let i = 1; i < lines.length; i++) {
            const obj: Record<string, any> = {};
            const currentLine = lines[i].split("\t");

            for (let j = 0; j < headers.length; j++) {
                // Use empty string if the column value is undefined.
                // If last element in tsv is empty, will be undefined
                obj[headers[j]] =
                    currentLine[j] !== undefined ? currentLine[j] : "";
            }

            result.push(obj);
        }
    }

    return result;
}
