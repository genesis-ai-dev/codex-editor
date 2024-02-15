import json
import re


def parse_scripture(scripture):
    pattern = r"scripture\s+([0-9]*\w+)\s+(\d+):(\d+)\s+-\s+(\d+):(\d+)"
    match = re.match(pattern, scripture)
    if match:
        book_abbr, start_chapter, start_verse, end_chapter, end_verse = match.groups()
        return {"book": book_abbr, "chapter": start_chapter, "verse": f"{start_verse}-{end_verse}"}
    else:
        return None


class CodexReader:
    """
    A class for reading and processing Codex files containing markdown and scripture cells.

    Attributes:
        verse_chunk_size (int): The size of verse chunks for grouping scripture verses.

    Methods:
        read_file(filename: str) -> dict:
            Reads a Codex file and processes its cells to extract chapters and verse chunks.

        process_cells(cells: list) -> dict:
            Processes the cells from the Codex file to extract chapters and verse chunks.

        split_verses(scripture_text: str) -> list:
            Splits the scripture text into verses and retains the markers.

        chunk_verses(verses: list, language: str) -> list:
            Groups verses into chunks based on the specified size.

        combine_verses(verse_chunk: list, language: str) -> dict:
            Combines verses into a chunk, providing a formatted name and combined text.

        get_embed_format(filename: str) -> list:
            Retrieves the embedded format of chapters and verse chunks from the Codex file.
    """
    def __init__(self, verse_chunk_size=4):
        self.verse_chunk_size = verse_chunk_size

    def read_file(self, filename):
        with open('/'+filename if ':' not in filename[1] else filename, 'r') as file:
            data = json.load(file)
            return self.process_cells(data.get('cells', []))

    def process_cells(self, cells):
        chapters = []
        current_chapter = None

        for cell in cells:
            if cell['kind'] == 1:  # Markdown cell representing a chapter
                current_chapter = {"verse_chunks": []}
                chapters.append(current_chapter)
            elif cell['kind'] == 2:  # Scripture cell
                if current_chapter is not None:
                    verses = self.split_verses(cell['value'])
                    verse_chunks = self.chunk_verses(verses, cell['language'])
                    current_chapter["verse_chunks"].extend(verse_chunks)

        return {"chapters": chapters}

    def split_verses(self, scripture_text):
        marker_match = re.search(r'(\d?[A-Z]+) \d+:\d+', scripture_text)
        if marker_match:
            marker = marker_match.group(1)
            # Split the verses and keep the markers
            parts = re.split(f'({marker} \\d+:\\d+)', scripture_text)
            # Re-combine markers with verses
            verses = [parts[i] + parts[i + 1] for i in range(0, len(parts) - 1, 2)]
            if len(parts) % 2 != 0:
                verses.append(parts[-1])
        else:
            
            parts = re.split(r'(\w+ \d+:\d+)', scripture_text)
            verses = [parts[i] + parts[i + 1] for i in range(0, len(parts) - 1, 2)]
            if len(parts) % 2 != 0:
                verses.append(parts[-1])
        return verses

    def chunk_verses(self, verses, language):
        verses = list(filter(None, verses))
        return [self.combine_verses(verses[i:i+self.verse_chunk_size], language) for i in range(0, len(verses), self.verse_chunk_size)]

    def combine_verses(self, verse_chunk, language):
        first_verse_info = re.search(r'(\d?[A-Z]{2,3}) (\d+:\d+)', verse_chunk[0])
        last_verse_info = re.search(r'(\d?[A-Z]{2,3}) (\d+:\d+)', verse_chunk[-1])

        if first_verse_info and last_verse_info and first_verse_info.group(1) == last_verse_info.group(1):
            chunk_name = f"{language} {first_verse_info.group(1)} {first_verse_info.group(2)} - {last_verse_info.group(2)}"
        else:
            chunk_name = f"{language} Chunk (problematic schema)"

        combined_text = ''.join(re.sub(r'[A-Z]+\s\d+:\d+\n?', '', verse) for verse in verse_chunk)
        combined_text = combined_text.replace('\r', '').replace('1\n', '').replace('\n1', '') # bunch of random characters get replaced
        return {chunk_name: combined_text.strip()}
    
    def get_embed_format(self, filename):
        result = self.read_file(filename=filename)
        chapters = result['chapters']
        chunks = []
        for chapter in chapters:
            for chunk in chapter['verse_chunks']:
                item = list(list(chunk.items())[0])
                item[0] = (parse_scripture(item[0]))
                chunks.append({"data": item[0], "text": item[1].replace("'", "")})
        return chunks


if __name__ == "__main__":
    reader = CodexReader(verse_chunk_size=5)
    result = reader.get_embed_format("/Users/daniellosey/Desktop/code/biblica/example_workspace/drafts/eng/GEN.codex")

    for i in result:
        print(i)
        
