from txtai import Embeddings
import datetime
from typing import Union
try:
    from tools.codex_tools import CodexReader
except:
    from codex_tools import CodexReader

# Create embeddings index
embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)

# Data to index




class DataBase:
    def __init__(self, path: str) -> None:
        self.path = path
        self.query = "select text, uri, timestamp, book, chapter, verse, metadata from txtai where similar('{query}')"
        self.min_score_query = self.query + " and score >= {score}"
        self.search_by_attribute = "select text, uri, timestamp, book, chapter, verse, metadata from txtai where {attribute}={query}"
        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        try:
            self.embeddings.load(path=path)
        except FileNotFoundError:
            pass


    def upsert_data(self, text: str, uri: str='', metadata: Union[dict, str] = {}, book: str = "", chapter: int = -1,
                    verse: str = ""):
        # Search for existing text in the database
        existing_items = self.embeddings.search(query=f"select id, text, uri, timestamp, book, chapter, verse, metadata from txtai where text='{text}'")
        if existing_items:
            # If text exists, update metadata of the first matching item
            self.embeddings.delete(existing_items[0]['id'])


        # If text does not exist, create a new item
        new_item = (None, {"text":text,
            "uri": uri,
            "timestamp": str(datetime.datetime.now()),
            "book": book,
            "chapter": str(chapter),
            "verse": str(verse),
            "metadata": str(metadata)
        }, None)
        self.embeddings.index([new_item])

        self.save()

    def simple_search(self, query: str, limit: int = 5, min_score: float = None):
        if min_score:
            results = self.embeddings.search(query=self.min_score_query.format(query=query, score=min_score),
                                             limit=limit)
        else:
            results = self.embeddings.search(query=self.query.format(query=query), limit=limit)
        return results

    def search_by_attribute(self, attribute: str, value: str, limit: int = 5):
        return self.embeddings.search(query=self.search_by_attribute.format(attribute=attribute, query=value), limit=limit)

    def upsert_codex_file(self, path: str, verse_chunk_size: int = 4) -> None:
        """
        Reads a Codex file, extracts embeddings, and upserts relevant data into the database.

        Args:
            path (str): The path to the Codex file.
            verse_chunk_size (int): The size of verse chunks for grouping scripture verses.

        Returns:
            None
        """
        reader = CodexReader(verse_chunk_size=verse_chunk_size)
        results = reader.get_embed_format(path)
        for result in results:
            self.upsert_data(text=result['text'], book=result['data']['book'], chapter=result['data']['chapter'],verse=result['data']['verse'], uri=path)

    def save(self):
        self.embeddings.save(self.path)


# Example/Test
if __name__ == "__main__":
    db_path = "dbs/db5"
    database = DataBase(db_path)

    # Inserting new data
    database.upsert_data(text="the elephant went to the store", uri="http://example.com", metadata={"author": "John Doe"},
                         book="Test Book", chapter=1, verse=1)

    # Searching for a text
    search_results = database.simple_search(query="store")
    print("Search Results:", search_results)
