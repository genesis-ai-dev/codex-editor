import os
import json
import re

def find_all(path: str, types: str = ".codex"):
    """
    Finds all files of a specific type in all subdirectories.
    """
    codex_files = []
    for root, _, files in os.walk(path):
        for file in files:
            if file.endswith(types):
                codex_files.append(os.path.join(root, file))
    return codex_files

def get_data(data, path):
    verses = []
    
    # Iterate over the cells
    for cell in data['cells']:
        if cell['kind'] == 2:  # Scripture cell
            scripture_text = cell['value']
            
            # Find all the references in the scripture text
            references = re.findall(r'\w+\s+\d+:\d+', scripture_text)
            
            # Process each reference
            for i in range(len(references) - 1):
                ref = references[i]
                next_ref = references[i + 1]
                
                # Find the text between the current reference and the next reference
                pattern = re.escape(ref) + r'(.*?)' + re.escape(next_ref)
                match = re.search(pattern, scripture_text, re.DOTALL)
                
                if match:
                    text = match.group(1).strip()
                    
                    # Create a dictionary for the verse
                    verse = {
                        'ref': ref,
                        'text': text,
                        'uri': path
                    }
                    
                    # Add the verse to the list
                    verses.append(verse)
            
            # Handle the last reference
            last_ref = references[-1]
            pattern = re.escape(last_ref) + r'(.*)'
            match = re.search(pattern, scripture_text, re.DOTALL)
            
            if match:
                text = match.group(1).strip()
                
                # Create a dictionary for the last verse
                verse = {
                    'ref': last_ref,
                    'text': text,
                    'uri': path,
                }
                
                # Add the last verse to the list
                verses.append(verse)
    
    return verses

def extract_from_file(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return get_data(data, path)

def extract_codex_chunks(path: str):
    data = []
    files = find_all(path, ".codex")
    for file in files:
        data.extend(extract_from_file(file))
    return data

def extract_from_bible_file(path):
    verses = []

    with open(path, "r", encoding="utf-8") as file:
        content = file.read()

        # Find all the references and their corresponding text
        matches = re.findall(r'(\w+\s+\d+:\d+)\s+(.*?)(?=\s+\w+\s+\d+:\d+|$)', content, re.DOTALL)

        for match in matches:
            ref, text = match
            verse = {
                'ref': ref,
                'text': text.strip(),
                'uri': str(path)
            }
            verses.append(verse)

    return verses

