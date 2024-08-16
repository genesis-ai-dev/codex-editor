export function meshCompletion(currentText: string, completion: string): string {
    // Remove any leading whitespace from the completion
    let trimmedCompletion = completion.trimStart();

    // Check if the completion starts with a verse reference
    const vrefRegex = /^([\w\d\s:]+):/;
    const currentVrefMatch = currentText.match(vrefRegex);
    const completionVrefMatch = trimmedCompletion.match(vrefRegex);

    if (currentVrefMatch && completionVrefMatch && currentVrefMatch[1] === completionVrefMatch[1]) {
        // If both have the same verse reference, remove it from the completion
        trimmedCompletion = trimmedCompletion.slice(completionVrefMatch[0].length).trimStart();
    }

    // Find the longest common prefix
    let commonPrefixLength = 0;
    while (commonPrefixLength < currentText.length &&
        commonPrefixLength < trimmedCompletion.length &&
        currentText[commonPrefixLength].toLowerCase() === trimmedCompletion[commonPrefixLength].toLowerCase()) {
        commonPrefixLength++;
    }

    // Remove the common prefix from the completion
    return trimmedCompletion.slice(commonPrefixLength);
}