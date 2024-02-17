from txtai import Embeddings
import datetime
from typing import Union
try:
    from tools.codex_tools import CodexReader, sql_safe
except:
    from codex_tools import CodexReader, sql_safe

# Create embeddings index
embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)




class DataBase:
    def __init__(self, path: str) -> None:
        self.path = path
        self.query = "select text, uri, createdAt, book, chapter, verse, metadata from txtai where similar('{query}')"
        self.min_score_query = self.query + " and score >= {score}"
        self.search_by_attribute_query = "select text, uri, createdAt, book, chapter, verse, metadata from txtai where {attribute}={value}"
        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        try:
            self.embeddings.load(path=path)
        except FileNotFoundError:
            pass


    def upsert_data(self, text: str, uri: str='', metadata: Union[dict, str] = {}, book: str = "", chapter: int = -1,
                    verse: str = ""):
        # Search for existing text in the database
        existing_items = self.embeddings.search(query=f"select id, text, uri, createdAt, book, chapter, verse, metadata from txtai where book='{sql_safe(book)}' and chapter='{sql_safe(chapter)}' and verse='{sql_safe(verse)}'")
        if existing_items:
            # If text exists, update metadata of the first matching item
            existing_id = existing_items[0]['id']
            updated_item = {"text": f"{sql_safe(text)}",
                            "uri": uri,
                            "createdAt": str(datetime.datetime.now()),
                            "book": sql_safe(book),
                            "chapter": sql_safe(str(chapter)),
                            "verse": sql_safe(str(verse)),
                            "metadata": sql_safe(str(metadata))
                            }
            self.embeddings.upsert([(existing_id, updated_item, None)])
        else:
            # If text does not exist, create a new item
            new_item = (None, {"text": f"{sql_safe(text)}",
                               "uri": uri,
                               "createdAt": str(datetime.datetime.now()),
                               "book": sql_safe(book),
                               "chapter": sql_safe(str(chapter)),
                               "verse": sql_safe(str(verse)),
                               "metadata": sql_safe(str(metadata))
                               }, None)
            self.embeddings.upsert([(None, new_item, None)])

        self.save()

    def simple_search(self, query: str, limit: int = 5, min_score: float | None = None):
        if min_score:
            results = self.embeddings.search(query=self.min_score_query.format(query=sql_safe(query), score=min_score),
                                             limit=limit)
        else:
            results = self.embeddings.search(query=self.query.format(query=sql_safe(query)), limit=limit)
        return results

    def search_by_attribute(self, attribute: str, value: str, limit: int = 5):
        return self.embeddings.search(query=self.search_by_attribute_query.format(attribute=attribute, query=value), limit=limit)

    def upsert_codex_file(self, path: str) -> None:
        """
        Reads a Codex file, extracts embeddings, and upserts relevant data into the database.

        Args:
            path (str): The path to the Codex file.

        Returns:
            None
        """
        reader = CodexReader()
        results = reader.get_embed_format(path)
        for result in results:
            if len(result['text']) > 2:
                self.upsert_data(text=result['text'], book=result['data']['book'], chapter=result['data']['chapter'],verse=result['data']['verse'], uri=path)

    def save(self):
        self.embeddings.save(self.path)


# Example/Test
if __name__ == "__main__":
    db_path = "dbs/db6/embedding"
    database = DataBase(db_path)

    # Inserting new data
    # database.upsert_data(text="the elephant went to the store", uri="http://example.com", metadata={"author": "John Doe"},
    #                         book="Test Book", chapter=1, verse=1)
    database.upsert_codex_file(path='/Users/daniellosey/Desktop/code/biblica/example_workspace/drafts/target/GEN.codex')
    # Searching for a text
    database.save()
    search_results = database.simple_search(query="God")
    print("Search Results:", search_results)
