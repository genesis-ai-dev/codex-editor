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


class Database:
    def __init__(self, database_name: str,  db_path: str, has_tokenizer: bool = False, use_fasttext: bool = False):
        self.db_path = Path(db_path).as_posix()  # Normalize the path
        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        self.has_tokenizer = has_tokenizer
        self.use_fasttext = use_fasttext
        self.model_name = f"{'/'.join(self.db_path.split('/')[:-2])}/fast_text.bin"
        self.database_name = database_name
        self.tokenizer = genetik_tokenizer.TokenDatabase(self.db_path) if has_tokenizer else None

        if use_fasttext:
            try:
                self.fasttext_model = FastText.load(self.model_name)
            except Exception as e:
                self.fasttext_model = FastText()
        else:
            self.fasttext_model = None

        try:
            self.embeddings.load(self.db_path)
        except Exception as e:
            pass
    
    def update_database(self...)
        # find all entries that have been changed -- or don't exist, then upsert them
    
    def semantic_search(query, topn: int = 5):
        # search for the query in self.database_name