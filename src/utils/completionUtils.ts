export function meshCompletion(currentText: string, completion: string): string {
    // Find the index at which currentText and completion start to differ
    const minLength = Math.min(currentText.length, completion.length);
    let splitIndex = 0;

    while (splitIndex < minLength && currentText[splitIndex] === completion[splitIndex]) {
        splitIndex++;
    }

    // If the currentText is a prefix of completion, append the rest of completion
    if (splitIndex === currentText.length) {
        return currentText + completion.slice(splitIndex);
    }

    // If they are identical up to the length of completion, return currentText
    if (splitIndex === completion.length) {
        return currentText;
    }

    // Otherwise, find the first non-matching point after any common prefix
    while (splitIndex > 0 && currentText[splitIndex - 1] !== " ") {
        splitIndex--;
    }

    return currentText + completion.slice(splitIndex);
}

function computeDiff(text1: string, text2: string): number[] {
    const n = text1.length;
    const m = text2.length;
    const max = n + m;
    const v = Array(2 * max + 1).fill(0);
    const trace = [];

    for (let d = 0; d <= max; d++) {
        trace.push([...v]);
        for (let k = -d; k <= d; k += 2) {
            let x;
            if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
                x = v[k + 1 + max];
            } else {
                x = v[k - 1 + max] + 1;
            }

            let y = x - k;
            while (x < n && y < m && text1[x] === text2[y]) {
                x++;
                y++;
            }

            v[k + max] = x;
            if (x >= n && y >= m) {
                return trace[d];
            }
        }
    }
    return [];
}

function applyDiff(text: string, diff: number[]): string {
    // This is a simplified version; you'll need to expand this based on actual diff operations (insert, delete, etc.)
    let result = "";
    let index = 0;
    for (let i = 0; i < diff.length; i++) {
        while (index < diff[i]) {
            result += text[index++];
        }
        // Handle diff operation here (e.g., skip deletion in the original text or add insertion from the new text)
    }
    return result;
}
