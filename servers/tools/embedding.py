import datetime
import logging
from pathlib import Path
from sqlite3 import IntegrityError
from typing import List, Any
from gensim.models import FastText
from txtai import Embeddings
import string

try:
   from tools.codex_tools import extract_verses, extract_verses_bible
   from tools.nlp import genetik_tokenizer
except ImportError:
   from codex_tools import extract_verses, extract_verses_bible
   from nlp import genetik_tokenizer

TRANSLATOR = str.maketrans('', '', string.punctuation)


def remove_punctuation(text: str) -> str:
   return text.translate(TRANSLATOR).strip()


def sql_safe(text: str) -> str:
   if not text:
       return text
   return text.replace("'", "''").replace("\\", "/").replace('"', "''")


class DataBase:
   def __init__(self, db_path: str, has_tokenizer: bool = False, use_fasttext: bool = False) -> None:
       self.db_path = Path(db_path).as_posix()
       self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
       self.has_tokenizer = has_tokenizer
       self.use_fasttext = use_fasttext
       self.open = True
       self.logger = logging.getLogger(__name__)
       self.model_name = f"{'/'.join(self.db_path.split('/')[:-2])}/fast_text.bin"
       self.tokenizer = genetik_tokenizer.TokenDatabase(self.db_path) if has_tokenizer else None

       if use_fasttext:
           try:
               self.fasttext_model = FastText.load(self.model_name)
           except:
               self.logger.exception("FastText model could not be found.")
               self.fasttext_model = FastText()
       else:
           self.fasttext_model = None

       try:
           self.embeddings.load(self.db_path)
       except Exception as e:
           self.logger.exception(f"Error loading embeddings: {e}")

   def upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, database: str, metadata: str = '') -> None:
       sanitized_data = map(sql_safe, [text, reference, book, verse, metadata, chapter, database])
       text, reference, book, verse, metadata, chapter, database = sanitized_data
       self.embeddings.upsert([(reference, {
           'text': text, 'book': book, 'verse': verse, 'chapter': chapter,
           'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata, 'database': database
       })])
       self.save()

   def search(self, query: str, database: str, limit: int = 5) -> list:
       query = remove_punctuation(query)
       results = self.embeddings.search(f"select text, book, verse, chapter, createdAt, uri, metadata from txtai where similar('f{query}') and database='{database}'", limit=limit)
       return results

   def exists(self, ids: List[str], database: str) -> List[str]:
       existing_ids = []
       for id in ids:
           result = self.embeddings.search(f"select book from txtai where id='{id}' and database='{database}'")
           if result:
               existing_ids.append(id)
       return existing_ids

   def get_text(self, id: str, database: str) -> str:
       text = self.embeddings.search(f"select text from txtai where id='{id}' and database='{database}'")
       return text

   def get_text_from(self, book: str, chapter: str, verse: str, database: str) -> str:
       self.logger.debug(f"Getting text from book={book}, chapter={chapter}, verse={verse}, database={database}")
       query = f"select text from txtai where book='{book}' and chapter='{chapter}' and verse='{verse}' and database='{database}'"
       text = self.embeddings.search(query)
       return text

   def track_file(self, path: str, database: str) -> None:
       file_path = Path(path)
       if not file_path.is_absolute():
           file_path = Path("/") / file_path

       result = self.embeddings.search(f"select book from txtai where uri='{file_path.as_posix()}' and database='{database}'")
       if not result:
           self.upsert_file(path, database)

   def untrack_file(self, path: str, database: str) -> None:
       file_path = Path(path)
       if not file_path.is_absolute():
           file_path = Path("/") / file_path

       self.embeddings.delete(f"delete from txtai where uri='{file_path.as_posix()}' and database='{database}'")
       self.save()

   def process_file(self, file_path: Path, database: str) -> List[tuple]:
       upsert_data = []

       if file_path.suffix == '.codex':
           results = extract_verses(file_path.as_posix())
           for result in results:
               if len(result['text']) > 11:
                   text, book, chapter, verse = result['text'], result['book'], result['chapter'], result['verse']
                   reference = f'{book} {chapter}:{verse}'
                   upsert_data.append(self.create_upsert_entry(text, reference, book, verse, chapter, file_path.as_posix(), database))
                   self.tokenizer.upsert_text(text)
           self.tokenizer.upsert_all()
       elif file_path.suffix == '.bible':
           results = extract_verses_bible(file_path.as_posix())
           self.logger.info(f"Going through {len(results)} results")

           for result in results:
               if len(result['text']) > 11:
                   text, book, chapter, verse = map(result.get, ['text', 'book', 'chapter', 'verse'])
                   reference = f'{book} {chapter}:{verse}'
                   upsert_data.append(self.create_upsert_entry(text, reference, book, verse, chapter, file_path.as_posix(), database))

           self.logger.info("Reading file")

           with file_path.open("r") as file:
               self.tokenizer.upsert_text(file.read())
               self.tokenizer.upsert_all()
       else:
           if file_path.suffix == '.tsv':
               with file_path.open("r", encoding="utf-8") as file:
                   for line in file:
                       parts = line.strip().split('\t')
                       if len(parts) >= 2:
                           text = parts[1]
                           upsert_data.append(self.create_upsert_entry(text, file_path.as_posix(), file_path.as_posix(), '', '', database))
           else:
               with file_path.open("r", encoding="utf-8") as file:
                   text = file.read()
                   if len(text) < 50000:
                       upsert_data.append(self.create_upsert_entry(text, file_path.as_posix(), file_path.as_posix(), '', '', database))

       return upsert_data

   def create_upsert_entry(self, text: str, reference: str, book: str, verse: str, chapter: str, uri: str, database: str, metadata: str = '') -> tuple:
       sanitized_data = map(sql_safe, [text, reference, book, verse, metadata, chapter, database])
       text, reference, book, verse, metadata, chapter, database = sanitized_data
       return (reference, {
           'text': text, 'book': book, 'verse': verse, 'chapter': chapter,
           'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata, 'database': database
       })

   def update_tracked_files(self, database: str) -> None:
       results = self.embeddings.search(f"select uri from txtai where database='{database}'")
       tracked_files = set(result['uri'] for result in results)
       upsert_data = []

       for file_path in tracked_files:
           file_path = Path(file_path)
           if file_path.exists() and file_path.suffix in ('.txt', '.md', '.tsv', '.codex', '.bible', '.html', '.csv', '.'):
               upsert_data.extend(self.process_file(file_path, database))

       for i in range(0, len(upsert_data), 1000):
           self.embeddings.upsert(upsert_data[i:i+1000])

       self.save()
       if self.use_fasttext:
           self.train_fasttext()
       self.logger.info("All tracked files upserted successfully.")

   def train_fasttext(self) -> None:
       if self.fasttext_model:
           texts = self.embeddings.search("SELECT * FROM txtai", limit=10000)
           print("Retrieved texts:", len(texts))

           sentences = []
           for text in texts:
               text = remove_punctuation(text['text']).lower()
               sentences.append(text.split(" "))
           print("test text", sentences[0])

           try:
               self.fasttext_model.build_vocab(sentences, update=True)
           except:
               self.fasttext_model.build_vocab(sentences)

           print("Vocabulary size:", len(self.fasttext_model.wv))

           self.fasttext_model.train(sentences, total_examples=len(sentences), epochs=5)
           self.fasttext_model.save(self.model_name)

   def get_similar_words(self, word: str, k: int = 5) -> List[str]:
       print(len(self.fasttext_model.wv))
       return [word for word, _ in self.fasttext_model.wv.most_similar(remove_punctuation(word), topn=k)]

   def save(self) -> None:
       self.embeddings.save(self.db_path)
       db_path = Path(self.db_path)
       if db_path.exists() and db_path.is_dir() and list(db_path.iterdir()) == [db_path / 'config']:
           (db_path / 'config').unlink()
           db_path.rmdir()

   def close(self) -> None:
       self.open = False
       self.embeddings.close()