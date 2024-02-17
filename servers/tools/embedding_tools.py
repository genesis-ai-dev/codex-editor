try:
    from tools.codex_tools import CodexReader
except:
    from codex_tools import CodexReader

from txtai import Embeddings

class DataBase:
    """
    A class representing a database for managing embeddings and searching Codex files.

    Attributes:
        name (str): The name of the database.
        embeddings (Embeddings): An instance of the txtai Embeddings class for handling sentence embeddings.

    Methods:
        __init__(name: str) -> None:
            Initializes a new database with the specified name and loads existing embeddings if available.

        upsert_codex_file(path: str) -> None:
            Reads a Codex file, extracts embeddings, and upserts relevant data into the database.

        index_all(data: list) -> None:
            Indexes all the provided data into the database.

        save() -> None:
            Saves the current state of the embeddings to the database.

        upsert(new_data) -> None:
            Upserts new data into the database and saves the changes.

        upsert_all(new_data: list) -> None:
            Upserts a list of new data into the database and saves the changes.

        search(query: str, limit: int = 1) -> list:
            Searches for embeddings related to the specified query within the database.

    Example Usage:
        database = DataBase('db3')
        database.upsert_codex_file('C:\\Users\\danie\\example_workspace\\drafts\\Bible\\1CH.codex')
        print(database.search('dog', limit=1900))
        database.save()
    """

    def __init__(self, name: str) -> None:
        """
        Initializes a new database with the specified name and loads existing embeddings if available.
        """
        self.name = name
        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        try:
            self.embeddings.load(self.name)
        except:
            print("No embeddings to load yet")

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
        self.upsert_all(results)

    def index_all(self, data: list) -> None:
        """
        Indexes all the provided data into the database.

        Args:
            data (list): The data to be indexed.

        Returns:
            None
        """
        self.embeddings.index(data)

    def save(self) -> None:
        """
        Saves the current state of the embeddings to the database.

        Returns:
            None
        """
        self.embeddings.save(self.name)

    def upsert(self, new_data) -> None:
        """
        Upserts new data into the database and saves the changes.

        Args:
            new_data: The new data to be upserted.

        Returns:
            None
        """
        self.embeddings.upsert(new_data)
        self.save()

    def upsert_all(self, new_data: list) -> None:
        """
        Upserts a list of new data into the database and saves the changes.

        Args:
            new_data (list): The list of new data to be upserted.

        Returns:
            None
        """
        for data in new_data:
            if data:
                self.embeddings.upsert(data)
        self.save()

    def search(self, query: str, limit: int = 1) -> list:
        """
        Searches for embeddings related to the specified query within the database.

        Args:
            query (str): The query for searching embeddings.
            limit (int): The maximum number of results to return.

        Returns:
            list: A list of search results.
        """
        results = self.embeddings.search(query, limit)
        results = [result for result in results if result['score'] > .1]
        return results

if __name__ == "__main__":
    database = DataBase('db3')
    #database.upsert_codex_file('C:\\Users\\danie\\example_workspace\\drafts\\Bible\\1CH.codex')
    database.upsert_all([{'id': 1, 'text': "hello this is a test"}, {'id': 2, 'text': "it is so cold in il"}])
    print(database.search('dog', limit=1900))
    database.save()