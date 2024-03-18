import datetime
import logging
from pathlib import Path
from sqlite3 import IntegrityError
from typing import Union, List, Any, Generator
from gensim.models import FastText, Word2Vec
from gensim.utils import simple_preprocess
from txtai import Embeddings
import string
try:
    from tools.codex_tools import extract_verses, extract_verses_bible
    from tools.nlp import genetik_tokenizer
except ImportError:
    from codex_tools import extract_verses, extract_verses_bible
    from nlp import genetik_tokenizer

# Create a translation table for removing punctuation from strings.
translator = str.maketrans('', '', string.punctuation)


def remove_punctuation(text: str) -> str:
    """
    Removes punctuation from a given string.

    Args:
        text (str): The input string from which punctuation will be removed.

    Returns:
        str: The input string with all punctuation removed.
    """
    return text.translate(translator).strip()


def sql_safe(text: str) -> str:
    """
    Escapes special characters in a string for use in an SQL statement, making it safe for SQL queries.

    Args:
        text (str): The input string to be sanitized.

    Returns:
        str: A sanitized string safe for SQL queries.
    """
    if not text:
        return text
    return text.replace("'", "''").replace("\\", "/").replace('"', "''")


class DataBase:
    def __init__(self, db_path: str, has_tokenizer: bool = False, use_fasttext: bool = False) -> None:
        self.db_path = Path(db_path).as_posix()  # Normalize the path
        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        self.has_tokenizer = has_tokenizer
        self.use_fasttext = use_fasttext
        self.queue: List[Any] = []
        self.open = True
        self.logger = logging.getLogger(__name__)
        self.model_name = f"{'/'.join(self.db_path.split('/')[:-2])}/fast_text.bin"
        if has_tokenizer:
            self.tokenizer = genetik_tokenizer.TokenDatabase(self.db_path)
        else:
            self.tokenizer = None

        if use_fasttext:
            try:
                self.fasttext_model = FastText.load(self.model_name)
            except:
                self.logger.exception("FastText model could not be found.")
                self.fasttext_model = FastText()
        else:
            self.fasttext_model = None
            self.fasttext_model = None

        try:
            self.embeddings.load(self.db_path)
        except Exception as e:
            self.logger.exception(f"Error loading embeddings: {e}")

    def upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now: bool = True) -> None:
        """
        Inserts or updates a record in the database.

        Args:
            text (str): The text of the record.
            reference (str): The reference identifier for the record.
            book (str): The book associated with the record.
            chapter (str): The chapter associated with the record.
            verse (str): The verse associated with the record.
            uri (str): The URI associated with the record.
            metadata (str, optional): Additional metadata for the record. Defaults to an empty string.
            save_now (bool, optional): Indicates whether to save the changes immediately. Defaults to True.
        """
        sanitized_data = map(sql_safe, [text, reference, book, verse, metadata, chapter])
        text, reference, book, verse, metadata, chapter = sanitized_data
        self.embeddings.upsert([(reference, {
            'text': text, 'book': book, 'verse': verse, 'chapter': chapter,
            'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata
        })])
        if save_now:
            self.save()

    def queue_upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now: bool = True) -> None:
        """
        Queues a record for upserting into the database.

        Args:
            text (str): The text of the record.
            reference (str): The reference identifier for the record.
            book (str): The book associated with the record.
            chapter (str): The chapter associated with the record.
            verse (str): The verse associated with the record.
            uri (str): The URI associated with the record.
            metadata (str, optional): Additional metadata for the record. Defaults to an empty string.
            save_now (bool, optional): Indicates whether to save the changes immediately. Defaults to True.
        """
        sanitized_data = map(sql_safe, [text, reference, book, verse, metadata, chapter])
        text, reference, book, verse, metadata, chapter = sanitized_data
        self.queue.append((reference, {
            'text': text, 'book': book, 'verse': verse, 'chapter': chapter,
            'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata
        }))
        if len(self.queue) % 1000 == 0:
            self.embeddings.upsert(self.queue)
            self.save()
            self.queue = []

    def search(self, query: str, limit: int = 5) -> list:
        """
        Searches the database for records similar to the query.

        Args:
            query (str): The search query.
            limit (int, optional): The maximum number of results to return. Defaults to 5.

        Returns:
            list: A list of search results.
        """
        query = remove_punctuation(query)
        results = self.embeddings.search(f"select text, book, verse, chapter, createdAt, uri, metadata from txtai where similar('f{query}')", limit=limit)
        return results

    def exists(self, ids: List[str]) -> List[str]:
        """
        Checks which of the given ids exist in the database.

        Args:
            ids (list): A list of ids to check for existence in the database.

        Returns:
            list: A list of ids that exist in the database.
        """
        existing_ids = []
        for id in ids:
            result = self.embeddings.search(f"select book from txtai where id='{id}'")
            if result:
                existing_ids.append(id)
        return existing_ids

    def get_text(self, id: str) -> str:
        """
        Retrieves the text associated with a given id from the database.

        Args:
            id (str): The id of the record.

        Returns:
            str: The text associated with the id.
        """
        text = self.embeddings.search(f"select text from txtai where id='{id}'")
        return text

    def get_text_from(self, book: str, chapter: str, verse: str) -> str:
        """
        Retrieves the text associated with a specific book, chapter, and verse from the database.

        Args:
            book (str): The book of the record.
            chapter (str): The chapter of the record.
            verse (str): The verse of the record.

        Returns:
            str: The text associated with the specified book, chapter, and verse.
        """
        self.logger.debug(f"Getting text from book={book}, chapter={chapter}, verse={verse}")
        query = f"select text from txtai where book='{book}' and chapter='{chapter}' and verse='{verse}'"
        text = self.embeddings.search(query)
        return text

    def upsert_queue(self) -> None:
        """
        Upserts the queued records into the database.
        """
        self.queue = [item for item in self.queue if item]  # Remove any None items from the queue
        if self.queue:
            self.embeddings.upsert(self.queue)
            self.save()
        self.queue = []

    def upsert_file(self, path: str) -> None:
        """
        Inserts or updates records in the database from a file.

        Args:
            path (str): The path to the file.
        """
        file_path = Path(path)
        if not file_path.is_absolute():
            file_path = Path("/") / file_path

        if file_path.suffix == '.codex':
            results = extract_verses(file_path.as_posix())
            for result in results:
                if len(result['text']) > 11:  # 000 000:000
                    text, book, chapter, verse = result['text'], result['book'], result['chapter'], result['verse']
                    reference = f'{book} {chapter}:{verse}'
                    self.queue_upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=file_path.as_posix())
                    self.tokenizer.upsert_text(text)
            self.tokenizer.upsert_all()
            self.upsert_queue()
        elif file_path.suffix == '.bible':
            results = extract_verses_bible(file_path.as_posix())
            self.logger.info(f"Going through {len(results)} results")

            for result in results:
                if len(result['text']) > 11:  # 000 000:000

                    text, book, chapter, verse = map(result.get, ['text', 'book', 'chapter', 'verse'])
                    reference = f'{book} {chapter}:{verse}'

                    try:
                        self.queue_upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=file_path.as_posix(), save_now=False)
                    except IntegrityError:
                        self.logger.exception("Integrity error")

            self.save()
            self.logger.info("Reading file")

            with file_path.open("r") as file:
                self.tokenizer.upsert_text(file.read())
                self.tokenizer.upsert_all()

            self.upsert_queue()
            if self.use_fasttext:
                self.train_fasttext()
        else:
            if file_path.suffix not in ('.txt', '.md', '.tsv', '.codex', '.bible', '.html', '.csv', '.'):
                self.logger.warning(f"Unsupported file type: {file_path}")
                return

            if file_path.suffix == '.tsv':
                with file_path.open("r", encoding="utf-8") as file:
                    for line in file:
                        parts = line.strip().split('\t')
                        if len(parts) >= 2:
                            text = parts[1]
                            self.queue_upsert(text=text, book=file_path.as_posix(), chapter='', verse='', reference=file_path.as_posix(), uri=file_path.as_posix(), metadata='', save_now=False)
            else:
                with file_path.open("r", encoding="utf-8") as file:
                    text = file.read()
                    if len(text) < 50000:
                        self.queue_upsert(text=text, book=file_path.as_posix(), chapter='', verse='', reference=file_path.as_posix(), uri=file_path.as_posix(), metadata='', save_now=False)

            self.upsert_queue()
            if self.use_fasttext:
                self.train_fasttext()
            self.logger.info(f"Resource file {file_path} upserted successfully.")

    def train_fasttext(self) -> None:
        if self.fasttext_model:
            # Retrieve text data from the database
            texts = self.embeddings.search("SELECT * FROM txtai", limit=10000)
            print("Retrieved texts:", len(texts))  # Print the number of retrieved texts
            
            sentences = []
            for text in texts:
                text = remove_punctuation(text['text']).lower()

                # Tokenize the text using split()
                # tokenized = self.tokenizer.tokenizer.tokenize(text)
                # detokenized = self.tokenizer.tokenizer.detokenize(tokenized, "|||").split("|||")

                sentences.append(text.split(" "))
            print("test text", sentences[0])
            # Build the vocabulary
            try:
                self.fasttext_model.build_vocab(sentences, update=True)
            except:
                self.fasttext_model.build_vocab(sentences)
            
            print("Vocabulary size:", len(self.fasttext_model.wv))  # Print the vocabulary size
            
            # Train the model
            self.fasttext_model.train(sentences, total_examples=len(sentences), epochs=5)
            self.fasttext_model.save(self.model_name)

    def get_similar_words(self, word, k=5):
        print(len(self.fasttext_model.wv))
        return [word for word, _ in self.fasttext_model.wv.most_similar(remove_punctuation(word), topn=k)]

    def save(self) -> None:
        """
        Saves the current state of the embeddings to the database.
        """
        self.embeddings.save(self.db_path)
        db_path = Path(self.db_path)
        if db_path.exists() and db_path.is_dir() and list(db_path.iterdir()) == [db_path / 'config']:
            (db_path / 'config').unlink()
            db_path.rmdir()

    def close(self) -> None:
        """
        Closes the database and releases resources.
        """
        self.open = False
        self.embeddings.close()

if __name__ == "__main__":
    db_path = "/Users/daniellosey/Desktop/temp_ws/nlp/embeddings/.bible"
    database = DataBase(db_path, use_fasttext=True, has_tokenizer=True)
    database.save()

    # print(database.exists(["GEN 1:10", "PRO 1:2"]))
    # search_results = database.search(query="Insightful decisions are on the lips of a king, his mouth should not betray justice.")
    # print("Search Results: ", search_results)

    database.train_fasttext()
    print("Similar Words: ", database.get_similar_words("love"))

