from genetok import tokenizer
from typing import List
import sys, os, re

def split(string, n):
    return [string[i:i+n] for i in range(0, len(string), n)]

class TokenDatabase:
    """
    A class for managing database operations with genetic tokenizer.
    """
    def __init__(self, db_path: str, single_words=False, default_tokens=[" "]) -> None:
        """
        Initializes the TokenDatabase class with a specific database path.

        Args:
            db_path (str): The path to the database file.
        """
        self.db_path = db_path
        self.text = ""
        if single_words:
            left = True
            right = True
        
        else:
            left = True
            right = False

        self.tokenizer = tokenizer.GeneticTokenizer(min_range=1, max_range=8, max_population=70, start_population=70, families=4, step_epochs=20, 
                                                    right_freezable=right, left_freezable=left, mutate_amount=30)
        # Load existing tokens from the database if available
        self.load(default_tokens=default_tokens)

    def tokenize(self, text: str) -> List[str]:
        """
        Tokenizes the given text using the genetic tokenizer.

        Args:
            text (str): The text to tokenize.

        Returns:
            List[str]: A list of tokens.
        """
        return self.tokenizer.tokenize(text)

    def save(self) -> None:
        """
        Saves the current state of the tokenizer to the database.
        """
        # Here you would implement the logic to save the tokenizer's state to a database.
        # This is a placeholder for the actual database save operation.
        try:
            self.tokenizer.save(self.db_path)
        except: 
            pass

    def load(self, default_tokens=[]) -> None:
        """
        Loads the tokenizer's state from the database.
        """
        # Here you would implement the logic to load the tokenizer's state from a database.
        # This is a placeholder for the actual database load operation.
        try:
            self.tokenizer.load(self.db_path)
            self.save()

        except Exception:
            pass
        finally:
            self.insert_manual(default_tokens)
    
    def insert_manual(self, tokens: list):
        for token in tokens:
            last_index = len(self.tokenizer.tokens)
            if token not in self.tokenizer.tokens:
                self.tokenizer.trie.insert(token, last_index)
                self.tokenizer.tokens.append(token)
        self.save()

    def upsert_text(self, text: str) -> None:
        """
        Adds the given text to the internal buffer.

        Args:
            text (str): The text to add to the buffer.
        """
        # Remove punctuation, convert to lowercase, remove newlines and tabs
        text = re.sub(r'[^\w\s]', '', text.lower().replace('\n', ' ').replace('\t', ' '))
        self.text += text
    
    def upsert_all(self):
        """
        Tokenizes all buffered text and updates the database with the new tokens.
        """
        if self.text:
            self.text = split(self.text, 10000)
            sys.stdout = open(os.devnull, 'w')
            self.tokenizer.evolve(self.text)
            self.save()
            self.text = ""
            sys.stdout = sys.__stdout__

if __name__ == "__main__":
    db_path = "third"
    token_db = TokenDatabase(db_path)
    # Example usage: tokenize a single text string
    with open("/Users/daniellosey/Desktop/code/biblica/example_workspace/drafts/source/actual.bible", "r") as f:
        text = f.read()
    
    # token_db.upsert_text(text)
    # token_db.upsert_all()
    # print(len(token_db.tokenizer.tokens))
    # tokens = token_db.tokenize("This is an example text to tokenize.")
    # print(tokens)