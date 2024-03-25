import datetime
import logging
from pathlib import Path
from sqlite3 import IntegrityError
from typing import Union, List, Any, Generator
from gensim.models import FastText
from gensim.utils import simple_preprocess
from txtai import Embeddings
import os
import string
try:
    from tools.codex_tools import extract_verses, extract_verses_bible
    from servers.tools.nlp import genetic_tokenizer
except ImportError:
    from .codex_tools import extract_verses, extract_verses_bible
    from .nlp import genetic_tokenizer

translator = str.maketrans('', '', string.punctuation+"'"+'"')

def remove_punctuation(text: str) -> str:
    """
    Remove punctuation from the given text.

    Parameters:
    - text (str): The text to remove punctuation from.

    Returns:
    - str: The text with punctuation removed.
    """
    return text.translate(translator).strip()

def sql_safe(text: str) -> str:
    """
    Make a string safe for SQL queries by escaping single quotes and backslashes.

    Parameters:
    - text (str): The text to be sanitized for SQL.

    Returns:
    - str: The sanitized text.
    """
    return text.replace("'", "''").replace("\\", "/").replace('"', "'") # if text else text

def sanitize_data(text: str, reference: str, book: str, chapter: str, verse: str, metadata: str) -> List[str]:
    """
    Sanitize a set of strings for SQL queries and return them as a list.

    Parameters:
    - text (str): The main text content.
    - reference (str): The reference identifier.
    - book (str): The book name.
    - chapter (str): The chapter number.
    - verse (str): The verse number.
    - metadata (str): Additional metadata.

    Returns:
    - List[str]: A list of sanitized strings.
    """
    return list(map(sql_safe, [text, reference, book, chapter, verse, metadata]))

def create_data(sanitized_data: List[str], uri: str, database_name: str) -> dict:
    """
    Create a dictionary of data from sanitized inputs and additional information.

    Parameters:
    - sanitized_data (List[str]): A list of sanitized strings.
    - uri (str): The URI for the data.
    - database_name (str): The name of the database.

    Returns:
    - dict: A dictionary containing the data.
    """
    return {
        'text': sanitized_data[0], 'reference': sanitized_data[1], 'book': sanitized_data[2], 'chapter': sanitized_data[3],
        'verse': sanitized_data[4], 'metadata': sanitized_data[5], 'createdAt': str(datetime.datetime.now()), 'uri': uri, 'database': database_name
    }

EMBEDDINGS: Embeddings | None = None

class Database:
    def __init__(self, db_path: str, database_name: str, has_tokenizer: bool = False, use_fasttext: bool = False) -> None:
        """
        Initialize the Database object with paths and configurations.

        Parameters:
        - db_path (str): The path to the database directory.
        - database_name (str): The name of the database.
        - has_tokenizer (bool): Flag indicating if a tokenizer is used.
        - use_fasttext (bool): Flag indicating if FastText is used.
        """
        global EMBEDDINGS
        self.db_path = db_path
        self.logger = logging.getLogger(__name__)
        if EMBEDDINGS is None:
            EMBEDDINGS = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
            print("Loading: ", self.db_path)
            EMBEDDINGS.load(self.db_path + "/embeddings")
            print("Loaded: ", self.db_path)

            self.save()
        self.database_name = database_name
        self.has_tokenizer: bool = has_tokenizer
        self.use_fasttext: bool = use_fasttext
        self.queue: List[Any] = []  # Replace 'Any' with the actual type when known
        self.open: bool = True
        self.tokenizer = None
        self.model_name: str = self.db_path +"/fast_text.bin"
        if self.has_tokenizer:
            try:
                self.tokenizer = genetic_tokenizer.TokenDatabase(self.db_path + database_name)
                self.tokenizer.save()
            except Exception as e:
                self.logger.exception(f"Error initializing TokenDatabase: {e}")
                self.tokenizer = genetic_tokenizer.TokenDatabase(self.db_path + database_name, single_words=True, default_tokens=[])
        else:
            self.tokenizer = None

        if use_fasttext:
            try:
                self.fasttext_model = FastText.load(self.model_name)
            except Exception as e:
                self.fasttext_model = FastText()
        else:
            self.fasttext_model = None

    def upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now: bool = False) -> None:
        """
        Insert or update a record in the database.

        Parameters:
        - text (str): The main text content.
        - reference (str): The reference identifier.
        - book (str): The book name.
        - chapter (str): The chapter number.
        - verse (str): The verse number.
        - uri (str): The URI for the data.
        - metadata (str): Additional metadata.
        - save_now (bool): If True, save changes immediately.
        """
        sanitized_data = sanitize_data(text, reference, book, chapter, verse, metadata)
        data = create_data(sanitized_data, uri, self.database_name)
        unique_id = f"{reference}_{self.database_name}"
        Embeddings.upsert([(unique_id, data)])
        if save_now:
            self.save()

    def save_codex_to_file(self) -> None:
        """
        Save the contents of the database to a text file, removing newlines and punctuation.
        Ensure the directory for the output file exists, create it if it doesn't.
        """
        texts_codex_bible = EMBEDDINGS.search("SELECT text FROM txtai WHERE database IN ('.codex', '.bible')", limit=1000000)
        processed_text = ' '.join(remove_punctuation(text['text'].replace('\n', ' ')) for text in texts_codex_bible)
        processed_text = remove_punctuation(processed_text)
        
        output_dir = os.path.dirname(self.db_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        with open(os.path.join(output_dir, "complete_draft.txt"), 'w+', encoding='utf-8') as file:
            file.write(processed_text)
    def queue_upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now: bool = True) -> None:
        """
        Queue an upsert operation to be executed later.

        Parameters:
        - text (str): The main text content.
        - reference (str): The reference identifier.
        - book (str): The book name.
        - chapter (str): The chapter number.
        - verse (str): The verse number.
        - uri (str): The URI for the data.
        - metadata (str): Additional metadata.
        - save_now (bool): If True, save changes immediately.
        """
        sanitized_data = sanitize_data(text, reference, book, chapter, verse, metadata)
        data = create_data(sanitized_data, uri, self.database_name)
        unique_id = f"{reference}_{self.database_name}"
        self.queue.append((unique_id, data))
        if len(self.queue) % 1000 == 0:
            EMBEDDINGS.upsert(self.queue)
            self.save()
            self.queue = []

    def search(self, query: str, limit: int = 5) -> list:
        """
        Search the database for records similar to the query.

        Parameters:
        - query (str): The search query.
        - limit (int): The maximum number of results to return.

        Returns:
        - list: A list of search results.
        """
        return EMBEDDINGS.search(f"select text, book, verse, chapter, createdAt, uri, metadata, id from txtai where similar('{remove_punctuation(query)}') and database='{self.database_name}'", limit=limit)

    def exists(self, ids: List[str]) -> List[str]:
        """
        Check which of the given IDs exist in the database.

        Parameters:
        - ids (List[str]): A list of IDs to check.

        Returns:
        - List[str]: A list of IDs that exist in the database.
        """
        existing_ids = []
        for id in ids:
            result = EMBEDDINGS.search(f"select book from txtai where id='{id}' and database='{self.database_name}'")
            if result:
                existing_ids.append(id)
        return existing_ids

    def get_text(self, id: str) -> str:
        """
        Retrieve the text content for a given ID.

        Parameters:
        - id (str): The ID of the record.

        Returns:
        - str: The text content of the record.
        """
        text = EMBEDDINGS.search(f"select text from txtai where id='{id}' and database='{self.database_name}'")
        return text

    def get_text_from(self, book: str, chapter: str, verse: str) -> str:
        """
        Retrieve text content from the database based on book, chapter, and verse.

        Parameters:
        - book (str): The book name.
        - chapter (str): The chapter number.
        - verse (str): The verse number.

        Returns:
        - str: The text content of the specified location.
        """
        self.logger.debug(f"Getting text from book={book}, chapter={chapter}, verse={verse}, database={self.database_name}")
        text = EMBEDDINGS.search(f"select text from txtai where book='{book}' and chapter='{chapter}' and verse='{verse}' and database='{self.database_name}'")
        return text

    def upsert_queue(self) -> None:
        """
        Upsert all queued items to the database and clear the queue.
        """
        self.queue = [item for item in self.queue if item]
        if self.queue:
            EMBEDDINGS.upsert(self.queue)
            self.save()
        self.queue = []

    def upsert_file(self, path: str) -> None:
        """
        Upsert the contents of a file into the database.

        Parameters:
        - path (str): The path to the file.
        """
        file_path = Path(path) if Path(path).is_absolute() else Path("/") / path

        process_funcs = {
            '.codex': self.process_codex_file,
            '.bible': self.process_bible_file,
        }
        process_func = process_funcs.get(file_path.suffix, self.process_other_file)
        process_func(file_path)

        # if self.use_fasttext:
        #     self.train_fasttext()
        self.logger.info(f"Resource file {file_path} upserted successfully.")

    def process_codex_file(self, file_path: Path) -> None:
        """
        Process a .codex file and upsert its contents into the database.

        Parameters:
        - file_path (Path): The path to the .codex file.
        """
        results = extract_verses(file_path.as_posix())
        process_verses(results, file_path, self)
        if self.tokenizer:
            self.tokenizer.upsert_all()
        self.upsert_queue()

    def process_bible_file(self, file_path: Path) -> None:
        """
        Process a .bible file and upsert its contents into the database.

        Parameters:
        - file_path (Path): The path to the .bible file.
        """
        results = extract_verses_bible(file_path.as_posix())
        self.logger.info(f"Going through {len(results)} results")

        process_verses(results, file_path, self)

        self.logger.info("Reading file")
        if self.tokenizer:
            with file_path.open("r") as file:
                self.tokenizer.upsert_text(file.read())
                self.tokenizer.upsert_all()

    def process_other_file(self, file_path: Path) -> None:
        """
        Process a file with an unsupported extension and upsert its contents into the database.

        Parameters:
        - file_path (Path): The path to the file.
        """
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

    def train_fasttext(self) -> None:
        """
        Train the FastText model with data from the database.
        """
        if self.fasttext_model:
            texts = EMBEDDINGS.search("SELECT * FROM txtai", limit=10000)
            sentences = [remove_punctuation(text['text']).split(" ") for text in texts]

            try:
                self.fasttext_model.build_vocab(sentences, update=True)
            except:
                self.fasttext_model.build_vocab(sentences)

            self.fasttext_model.train(sentences, total_examples=len(sentences), epochs=10)
            print("model_name: ", self.model_name)
            self.fasttext_model.save(self.model_name)

    def get_similar_words(self, word, k=10):
        """
        Get a list of words similar to the given word using the FastText model.

        Parameters:
        - word (str): The word to find similar words for.
        - k (int): The number of similar words to return.

        Returns:
        - list: A list of similar words.
        """
        return self.fasttext_model.wv.most_similar(remove_punctuation(word), topn=k)

    def save(self) -> None:
        """
        Save the embeddings to the database path.
        """
        self.save_codex_to_file() # TODO: See if this takes too long, shouldn't
        EMBEDDINGS.save(self.db_path+"/embeddings")
        self.cleanup_db_path()

    def cleanup_db_path(self) -> None:
        """
        Clean up the database path by removing the 'config' file and directory if empty.
        """
        db_path = Path(self.db_path+"/embeddings")
        if db_path.exists() and db_path.is_dir() and list(db_path.iterdir()) == [db_path / 'config']:
            (db_path / 'config').unlink()
            db_path.rmdir()

    def close(self) -> None:
        """
        Close the database and release any resources.
        """
        self.open = False
        EMBEDDINGS.close()


def process_verses(results, file_path, db_instance):
    """
    Process a list of verse results and upsert them into the database.

    Parameters:
    - results (list): A list of verse results to process.
    - file_path (Path): The path to the file containing the verses.
    - db_instance (Database): The database instance to use for upserting.
    """
    for result in results:
        if len(result['text']) > 11:
            text, book, chapter, verse = result['text'], result['book'], result['chapter'], result['verse']
            reference = f'{db_instance.database_name} {book} {chapter}:{verse}'  # Modified line
            db_instance.queue_upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=str(file_path.as_posix()))
            db_instance.tokenizer.upsert_text(text)





# db = Database("/Users/daniellosey/Desktop/temp_ws/.project/nlp", ".codex", True, True)
# print(db.search("hello"))