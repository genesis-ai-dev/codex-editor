import json
import re

def extract_verses(file_name):
    with open(file_name, 'r') as file:
        data = json.load(file)
    
    verses = []
    current_chapter = ""
    book = ""
    
    # Updated regex pattern to capture verses with or without new lines
    verse_pattern = re.compile(r"(\b[A-Z0-9]{2,4})\s(\d+:\d+)(?:\s+)?(.+?)(?=(\b[A-Z0-9]{2,4}\s\d+:\d+)|$)", re.DOTALL)

    for cell in data["cells"]:
        if cell["kind"] == 1 and "chapter-heading" in cell.get("metadata", {}).get("type", ""):
            current_chapter = cell["metadata"]["data"]["chapter"]
        elif cell["kind"] == 2 and cell["language"] == "scripture":
            verse_lines = cell["value"]
            matches = verse_pattern.findall(verse_lines)
            for match in matches:
                book, verse_number, verse_text = match[:3]
                verses.append({
                    "text": verse_text.strip(),
                    "chapter": current_chapter,
                    "book": book,
                    "verse": verse_number.split(":")[-1]
                })
        elif cell["kind"] == 1:  # Handle markdown cells for inline verse references
            matches = verse_pattern.findall(cell["value"])
            for match in matches:
                book, verse_number, verse_text = match[:3]
                verses.append({
                    "text": verse_text.strip(),
                    "chapter": current_chapter,
                    "book": book,
                    "verse": verse_number
                })
    
    return verses

def extract_verses_bible(file_name):
    with open(file_name, 'r') as file:
        data = file.read()
    
    verses = []
    current_chapter = ""
    book = ""
    
    # Updated regex pattern to capture verses with or without new lines
    verse_pattern = re.compile(r"(\b[A-Z0-9]{2,4})\s(\d+:\d+)(?:\s+)?(.+?)(?=(\b[A-Z0-9]{2,4}\s\d+:\d+)|$)", re.DOTALL)

    matches = verse_pattern.findall(data)
    for match in matches:
        book, verse_number, verse_text = match[:3]
        # Assuming chapter information needs to be extracted from verse_number for .bible files
        chapter = verse_number.split(":")[0]
        verses.append({
            "text": verse_text.strip(),
            "chapter": chapter,
            "book": book,
            "verse": verse_number.split(":")[-1]
        })
    
    return verses
if __name__ == "__main__":
    # Example usage:

    extracted_verses = extract_verses('/Users/daniellosey/Desktop/code/biblica/example_workspace/drafts/target/GEN.codex')
    print(extracted_verses[1])



