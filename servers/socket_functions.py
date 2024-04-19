"""
Socket function router, functions, and logic
"""
import json
from utils import json_database
from utils import lad


class SocketRouter:
    """
    TODO: come up with a more descriptive name, singleton
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls, *args, **kwargs)
        return cls._instance
    def __init__(self):
        self.workspace_path = ""
        self.database: json_database.JsonDatabase = None
        self.anomaly_detector: lad.LAD = None
        self.ready = False

    def prepare(self, workspace_path):
        """prepares the socket stuff"""
        self.workspace_path = workspace_path
        self.database: json_database.JsonDatabase = json_database.JsonDatabase()
        self.database.create_database(bible_dir=self.workspace_path, codex_dir=self.workspace_path, save_all_path=self.workspace_path+"/.project/")
        self.anomaly_detector: lad.LAD = lad.LAD(codex=self.database, bible=self.database, n_samples=10)
        self.ready = True
    def route_to(self, json_input):
        """
        Routes a json query to the needed function
        """
        data = json.loads(json_input)
        function_name = data['function_name']
        args = data['args']

        if function_name == 'verse_lad':
            result = self.verse_lad(args['query'], args['vref'])
            return json.dumps({"score": result})
        elif function_name == 'search':
            results = self.search(args['text_type'], args['query'], args.get('limit', 10))
            return json.dumps({"results": results})
        elif function_name == 'get_most_similar':
            results = self.get_most_similar()
            return json.dumps({"most_similar": results})
        elif function_name == 'get_rarity':
            result = self.get_rarity(args['text_type'], args['text'])
            return json.dumps({"rarity": result})
        elif function_name == 'get_text':
            results = self.get_text(args['ref'], args['text_type'])
            return json.dumps({"text": results})
        elif function_name == 'detect_anomalies':
            results = self.detect_anomalies(args['query'], args.get('limit', 10))
            return json.dumps(results)
        else:
            raise ValueError(f"Unknown function: {function_name}")

    def verse_lad(self, query, vref):
        """
        performs LAD on a verse
        """
        return self.anomaly_detector.search_and_score(query, vref=vref)

    def search(self, text_type, query, limit=10):
        """Search the specified database for a query."""
        return self.database.search(query, text_type=text_type, top_n=int(limit))

    def get_most_similar(self):
        """Get words most similar to the given word from the specified database."""
        return []

    def get_rarity(self, text_type, text):
        """
        tifidf rarity of some words
        """
        return self.database.word_rarity(text=text, text_type=text_type)

    def get_text(self, ref, text_type):
        """Retrieve text from the specified database based on book, chapter, and verse."""
        return self.database.get_text(ref=ref, text_type=text_type)

    def detect_anomalies(self, query, limit=10):
        """
        detects relative differences between source and target translations
        """
        codex_results = self.database.search(query_text=query, text_type="target", top_n=limit)
        try:
            ref = codex_results[0]['ref']
            source_query = self.database.get_text(ref=ref, text_type="source")
            source_results = self.database.search(query_text=source_query, text_type="source", top_n=limit)

            source_ids = [item['ref'] for item in source_results]
            codex_ids = [item['ref'] for item in codex_results]

            # Find codex IDs that are not in the source IDs
            missing_in_source = [codex_id for codex_id in codex_ids if codex_id not in source_ids]
            missing_in_codex = [source_id for source_id in source_ids if source_id not in codex_ids and self.database.get_text(source_id, text_type="source")]
            anomalies = []
            for missing_id in missing_in_source:
                anomalies.append({
                    "reference": missing_id,
                    "reason": "Missing in source"
                })
            for missing_id in missing_in_codex:
                anomalies.append({
                    "reference": missing_id,
                    "reason": "Missing in codex"
                })

            return {
                "bible_results": source_results,
                "codex_results": codex_results,
                "detailed_anomalies": anomalies
            }
        except IndexError:
            return {
                "bible_results":  self.database.search(query_text=query, text_type="source", top_n=limit),
                "codex_results": self.database.search(query_text=query, text_type="target", top_n=limit),
                "detailed_anomalies": [{"reason": ".codex results returned none", "reference": "N/A"}]
            }
        
universal_socket_router = SocketRouter()
