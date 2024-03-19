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

translator = str.maketrans('', '', string.punctuation)

def remove_punctuation(text: str) -> str:
   return text.translate(translator).strip()

def sql_safe(text: str) -> str:
   return text.replace("'", "''").replace("\\", "/").replace('"', "'") # if text else text

def sanitize_data(text: str, reference: str, book: str, chapter: str, verse: str, metadata: str) -> List[str]:
   return list(map(sql_safe, [text, reference, book, verse, metadata, chapter]))

def create_data(sanitized_data: List[str], uri: str, database_name: str) -> dict:
   return {
       'text': sanitized_data[0], 'book': sanitized_data[1], 'verse': sanitized_data[2], 'chapter': sanitized_data[3],
       'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': sanitized_data[4], 'database': database_name
   }

EMBEDDINGS: Embeddings | None = None

class Database:
    def __init__(self, db_path: str, database_name: str, has_tokenizer: bool = False, use_fasttext: bool = False) -> None:
        global EMBEDDINGS
        self.db_path = Path(db_path).as_posix() + "/unified_database/"
        if EMBEDDINGS is None:
            EMBEDDINGS = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
            EMBEDDINGS.save(db_path)
            try:
                EMBEDDINGS.load(self.db_path)
            except Exception as e:
                self.logger.exception(f"Error loading embeddings: {e}")
        self.embeddings = EMBEDDINGS
        self.database_name = database_name
        self.has_tokenizer = has_tokenizer
        self.use_fasttext = use_fasttext
        self.queue = []
        self.open = True
        self.logger = logging.getLogger(__name__)
        self.model_name = f"{'/'.join(self.db_path.split('/')[:-2])}/fast_text.bin"
        if has_tokenizer:
            try:
                self.tokenizer = genetik_tokenizer.TokenDatabase(self.db_path)
            except Exception as e:
                self.logger.exception(f"Error initializing TokenDatabase: {e}")
                self.tokenizer = genetik_tokenizer.TokenDatabase(self.db_path, single_words=True, default_tokens=[])
        else:
            self.tokenizer = None

        if use_fasttext:
            try:
                self.fasttext_model = FastText.load(self.model_name)
            except Exception as e:
                self.logger.exception(f"Error loading FastText model: {e}")
                self.fasttext_model = FastText()
        else:
            self.fasttext_model = None

    def upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now: bool = True) -> None:
        sanitized_data = sanitize_data(text, reference, book, chapter, verse, metadata)
        data = create_data(sanitized_data, uri, self.database_name)
        unique_id = f"{reference}_{self.database_name}"
        self.embeddings.upsert([(unique_id, data)])
        if save_now:
            self.save()

    def queue_upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now: bool = True) -> None:
        sanitized_data = sanitize_data(text, reference, book, chapter, verse, metadata)
        data = create_data(sanitized_data, uri, self.database_name)
        unique_id = f"{reference}_{self.database_name}"
        self.queue.append((unique_id, data))
        if len(self.queue) % 1000 == 0:
            self.embeddings.upsert(self.queue)
            self.save()
            self.queue = []

    def search(self, query: str, limit: int = 5) -> list:
        return self.embeddings.search(f"select text, book, verse, chapter, createdAt, uri, metadata from txtai where similar('{remove_punctuation(query)}') and database='{self.database_name}'", limit=limit)

    def exists(self, ids: List[str]) -> List[str]:
        existing_ids = []
        for id in ids:
            result = self.embeddings.search(f"select book from txtai where id='{id}' and database='{self.database_name}'")
            if result:
                existing_ids.append(id)
        return existing_ids

    def get_text(self, id: str) -> str:
        text = self.embeddings.search(f"select text from txtai where id='{id}' and database='{self.database_name}'")
        return text

    def get_text_from(self, book: str, chapter: str, verse: str) -> str:
        self.logger.debug(f"Getting text from book={book}, chapter={chapter}, verse={verse}, database={self.database_name}")
        text = self.embeddings.search(f"select text from txtai where book='{book}' and chapter='{chapter}' and verse='{verse}' and database='{self.database_name}'")
        return text

    def upsert_queue(self) -> None:
        self.queue = [item for item in self.queue if item]
        if self.queue:
            self.embeddings.upsert(self.queue)
            self.save()
        self.queue = []

    def upsert_file(self, path: str) -> None:
        file_path = Path(path) if Path(path).is_absolute() else Path("/") / path

        process_funcs = {
            '.codex': self.process_codex_file,
            '.bible': self.process_bible_file,
        }
        process_func = process_funcs.get(file_path.suffix, self.process_other_file)
        process_func(file_path)

        if self.use_fasttext:
            self.train_fasttext()
        self.logger.info(f"Resource file {file_path} upserted successfully.")

    def process_codex_file(self, file_path: Path) -> None:
        results = extract_verses(file_path.as_posix())
        process_verses(results, file_path, self)
        self.tokenizer.upsert_all()
        self.upsert_queue()

    def process_bible_file(self, file_path: Path) -> None:
        results = extract_verses_bible(file_path.as_posix())
        self.logger.info(f"Going through {len(results)} results")

        process_verses(results, file_path, self)

        self.save()
        self.logger.info("Reading file")
        with file_path.open("r") as file:
            self.tokenizer.upsert_text(file.read())
            self.tokenizer.upsert_all()
        self.upsert_queue()

    def process_other_file(self, file_path: Path) -> None:
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
        if self.fasttext_model:
            texts = self.embeddings.search("SELECT * FROM txtai", limit=10000)
            sentences = [remove_punctuation(text['text']).lower().split(" ") for text in texts]

            try:
                self.fasttext_model.build_vocab(sentences, update=True)
            except:
                self.fasttext_model.build_vocab(sentences)

            self.fasttext_model.train(sentences, total_examples=len(sentences), epochs=5)
            self.fasttext_model.save(self.model_name)

    def get_similar_words(self, word, k=5):
        return [word for word, _ in self.fasttext_model.wv.most_similar(remove_punctuation(word), topn=k)]

    def save(self) -> None:
        self.embeddings.save(self.db_path)
        self.cleanup_db_path()

    def cleanup_db_path(self) -> None:
        db_path = Path(self.db_path)
        if db_path.exists() and db_path.is_dir() and list(db_path.iterdir()) == [db_path / 'config']:
            (db_path / 'config').unlink()
            db_path.rmdir()

    def close(self) -> None:
        self.open = False
        self.embeddings.close()

def process_verses(results, file_path, db_instance):
    for result in results:
        if len(result['text']) > 11:
            text, book, chapter, verse = result['text'], result['book'], result['chapter'], result['verse']
            reference = f'{book} {chapter}:{verse}'
            db_instance.queue_upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=file_path.as_posix())
            db_instance.tokenizer.upsert_text(text)