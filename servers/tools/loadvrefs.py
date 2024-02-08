import re

def filter(text, refrence):
    # Define a regular expression pattern to find verse references
    pattern = r'\b([A-Z]+)\s+(\d+):(\d+)\b'

    # Define a function to replace each match with underscores
    def replace_with_underscores(match):
        book, chapter, verse = match.groups()
        book_underscores = "_" * len(book)
        chapter_underscores = "_" * len(chapter)
        verse_underscores = "_" * len(verse)
        return f"{book_underscores} {chapter_underscores}:{verse_underscores}"

    # Use re.sub to replace each match with underscores
    filtered_text = re.sub(pattern, replace_with_underscores, text)

    return filtered_text


def get_verse_references_from_file(path):
    path = 'servers/versedata.txt'
    with open(path, 'r') as f:
        return f.readlines()

def extract_chapter_verse_counts(file_path):
    all_chapter_verse_counts = []
    with open(file_path, 'r') as file:
        content = file.read()
        matches = re.findall(r'"chapterVerseCountPairings":\s*{([^}]*)}', content)
        for match in matches:
            chapter_verse_pairs = match.strip()
            pairs = re.findall(r'"(\d+)":\s*(\d+)', chapter_verse_pairs)
            chapter_verse_counts = {int(chapter): int(verse) for chapter, verse in pairs}
            all_chapter_verse_counts.append(chapter_verse_counts)
    return all_chapter_verse_counts


def extract_book_names(file_path):
    # This regular expression looks for patterns that match }, followed by whitespace (optional),
    # then a sequence of uppercase letters and/or numbers (the book name), followed by ": {". 
    # The book name is captured in a group by the parentheses.
    pattern = re.compile(r'},\s*"([A-Z0-9]+)":\s*{')

    book_names = []
    with open(file_path, 'r') as file:
        content = file.read()
        matches = re.findall(pattern, content)
        for match in matches:
            # Each match is a book name that is appended to the book_names list
            book_names.append(match)

    return book_names


# file_path = "src/assets/vref.ts"  # Update with your file path
# all_chapter_verse_counts = extract_chapter_verse_counts(file_path)

# names = extract_book_names(file_path)
# names = ["GEN"] + names

# combined = [{name: all_chapter_verse_counts[names.index(name)]} for name in names]
# print(combined[0])
# lines = []
# for combo in combined:
#     name = list(combo.keys())[0]  # Fixed to get the actual name string instead of dict_keys object
#     data = list(combo.values())[0]  # Fixed to get the actual dictionary instead of dict_values object
#     for chapter, verse_count in data.items():  # Fixed to iterate over items of the dictionary
#         for i in range(verse_count):
#             lines.append(f"\n{name} {chapter}:{i+1}")  # Fixed to print the correct chapter and verse number

# with open("versedata.txt", "w") as f:
#     f.writelines(lines)