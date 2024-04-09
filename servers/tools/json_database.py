from tools import grabber
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

class JsonDatabase:
    """
    JSON database for the bible files
    """
    def __init__(self):
        self.dictionary = {}
        self.tfidf_vectorizer_source = TfidfVectorizer()
        self.tfidf_vectorizer_target = TfidfVectorizer()
        self.tfidf_matrix_source = None
        self.tfidf_matrix_target = None
        self.source_texts = []
        self.target_texts = []
        self.source_references = []
        self.target_references = []
        self.source_uris = []
        self.target_uris = []
        self.complete_text = ""
    
    def create_database(self, bible_dir, codex_dir, save_all_path):
        """
        Generates database dictionary
        """
        try:
            source_files = grabber.extract_from_bible_file(path=grabber.find_all(bible_dir, ".bible")[0])
        except FileNotFoundError:
            source_files = []
        target_files = grabber.extract_codex_chunks(path=codex_dir)

        for verse in source_files:
            ref = verse["ref"]
            text = verse["text"]
            uri = verse['uri']
            self.dictionary[ref] = {"source": text, "source_uri": uri}
            self.source_texts.append(text)
            self.source_references.append(ref)
            self.source_uris.append(uri)
            self.complete_text += " " + text
        
        for verse in target_files:
            ref = verse["ref"]
            text = verse["text"]
            uri = verse['uri']
            if ref in self.dictionary:
                self.dictionary[ref].update({"target": text, "target_uri": uri})
            else:
                self.dictionary[ref] = {"target": text, "target_uri": uri}
            self.target_texts.append(text)
            self.target_references.append(ref)
            self.target_uris.append(uri)
            self.complete_text += " " + text

        with open(save_all_path+"/complete_draft.txt", "w+") as f:
            f.write(self.complete_text)
        self.tfidf_matrix_source = self.tfidf_vectorizer_source.fit_transform(self.source_texts)
        self.tfidf_matrix_target = self.tfidf_vectorizer_target.fit_transform(self.target_texts)
    
    def search(self, query_text, text_type="source", top_n=5):
        """
        Searches for references based on the query text using TF-IDF
        """
        if text_type == "source":
            query_vector = self.tfidf_vectorizer_source.transform([query_text])
            similarities = cosine_similarity(query_vector, self.tfidf_matrix_source)
            top_indices = similarities.argsort()[0][-top_n:][::-1]
            return [{'ref': self.source_references[i], 'text': self.source_texts[i], 'uri': self.source_uris[i]} for i in top_indices]
        elif text_type == "target":
            query_vector = self.tfidf_vectorizer_target.transform([query_text])
            similarities = cosine_similarity(query_vector, self.tfidf_matrix_target)
            top_indices = similarities.argsort()[0][-top_n:][::-1]
            return [{'ref': self.target_references[i], 'text': self.target_texts[i], 'uri': self.target_uris[i]} for i in top_indices]
        else:
            raise ValueError("Invalid text_type. Choose either 'source' or 'target'.")
    
    def get_text(self, ref: str, text_type="source"):
        return self.dictionary[ref][text_type]