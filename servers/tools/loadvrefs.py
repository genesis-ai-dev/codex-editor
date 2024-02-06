import re
import json

def extract_json_like_from_file(file_path):
    """
    Reads the file content and extracts the JSON-like part that contains the verse reference data.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            ts_content = file.read()
            
            # Assuming the verse reference data is contained within a specific object structure
            # Adjust the regex pattern if the structure is known to be different
            json_like_matches = re.findall(r'=\s*{.*?}\s*;', ts_content, re.DOTALL)
            for match in json_like_matches:
                if "chapterVerseCountPairings" in match:
                    json_like = match[1:-1].strip()  # Remove the leading '=' and trailing ';', then strip spaces
                    return json_like
    except FileNotFoundError:
        print(f"File not found: {file_path}")
        return "{}"
    return "{}"

def parse_ts_content_from_json_like(json_like):
    """
    Parses the JSON-like string to a Python dictionary.
    """
    json_like = json_like.replace("'", '"')  # Replace single quotes with double quotes
    try:
        data = json.loads(json_like)
        return data
    except json.JSONDecodeError:
        print("Failed to decode JSON")
        return {}

def generate_verse_references(data):
    """
    Generates verse references from the parsed data.
    """
    verse_references = []
    for book, details in data.items():
        chapter_verse_pairs = details.get("chapterVerseCountPairings", {})
        for chapter, verse_count in chapter_verse_pairs.items():
            for verse in range(1, verse_count + 1):
                verse_references.append(f"{book} {chapter}:{verse}")
    return verse_references

def get_verse_references_from_file(file_path):
    """
    High-level function to process TypeScript content from a file and return all valid verse references.
    """
    json_like = extract_json_like_from_file(file_path)
    data = parse_ts_content_from_json_like(json_like)
    verse_references = generate_verse_references(data)
    return verse_references




def filter(text, verse_references):
    """
    Replaces any verse references in the text with underscores.

    :param text: The input text containing potential verse references.
    :param verse_references: A list of verse references to look for in the text.
    :return: The text with verse references replaced by underscores.
    """
    # Sort verse references by length in descending order to match longer references first
    verse_references_sorted = sorted(verse_references, key=len, reverse=True)

    for vref in verse_references_sorted:
        # Escape special regex characters in verse reference
        vref_escaped = re.escape(vref)
        # Replace the verse reference with underscores
        text = re.sub(vref_escaped, lambda match: '_' * len(match.group(0)), text)

    return text


if __name__ == '__main__':
    # Example usage
    file_path = "/Users/daniellosey/Desktop/code/biblica/codex-editor/src/assets/vref.ts"
    verse_references = get_verse_references_from_file(file_path)
    print(verse_references)
