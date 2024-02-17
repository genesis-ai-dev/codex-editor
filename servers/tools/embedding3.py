from txtai import Embeddings
import datetime
from typing import Union
import string

try:
    from tools.codex_tools import extract_verses
except:
    from codex_tools import extract_verses


translator = str.maketrans('', '', string.punctuation)



def remove_punctuation(text: str) -> str:
    """
    removes punctuation
    """
    return text.translate(translator).strip()


embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)

def sql_safe(text: str) -> str:
    """
    Escapes special characters in a string for use in an SQL statement.

    Args:
        text (str): The input string to be sanitized.

    Returns:
        str: A sanitized string safe for SQL queries.
    """
    if not text:
        return text
    return text.replace("'", "''").replace("\\", "/").replace('"', "''")
class DataBase:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        try:
            self.embeddings.load(self.db_path)
        except:
            pass
    def upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = ''):
        text = sql_safe(text=text)
        reference = sql_safe(text=reference)
        book = sql_safe(text=book)
        verse = sql_safe(text=verse)
        metadata = sql_safe(text=metadata)
        chapter = sql_safe(text=chapter)
        self.embeddings.upsert([ (reference, {'text': text, 'book': book, 'verse': verse, 'chapter': chapter, 'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata})])
        self.save()

    def search(self, query: str, limit: int = 5):
        query = remove_punctuation(query)
        results = self.embeddings.search(f"select text, book, verse, chapter, createdAt, uri, metadata from txtai where similar('f{query}')", limit=limit)
        return results
    
    def upsert_codex_file(self, path: str):
        path = "/" + path if "://" not in path else path
        results = extract_verses(path)

        for result in results:
            if len(result['text']) > 11: # 000 000:000  
                text = result['text']
                book = result['book']
                chapter = result['chapter']
                verse = result['verse']
                reference = f'{book} {chapter}:{verse}'
                #print(text)
                self.upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=path)

    def save(self):
        self.embeddings.save(self.db_path)



# embeddings.upsert([('GEN 1:1', {'text': 'I hate pizza', 'book': 'gen'})])
# embeddings.upsert([ ('GEN 1:1', {'text': 'I looove pizza', 'book': 'gen', 'verse': f"{verse}"}) ])
# print(embeddings.search("select * from txtai where similar('pizza')"))

if __name__ == "__main__":
    db_path = "dbs/db6/embedding"
    database = DataBase(db_path)

    # Inserting new data
    # database.upsert_data(text="the elephant went to the store", uri="http://example.com", metadata={"author": "John Doe"},
    #                         book="Test Book", chapter=1, verse=1)
    #database.upsert_codex_file(path='/Users/daniellosey/Desktop/code/biblica/example_workspace/drafts/target/GEN.codex')
    # Searching for a text
    #database.save()
    search_results = database.search(query="")
    print("Search Results:", search_results)
