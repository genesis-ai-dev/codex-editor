"""
Socket function router, functions, and logic
"""
import re
import json
import threading
from utils import json_database
from utils import bia
from utils import editor



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
        self.edit_results = []
        self.ready = False
        self.bia: bia.BidirectionalInverseAttention = None
        self.lspw = None
        self.statuses = {}

    def prepare(self, workspace_path, lspw):
        """prepares the socket stuff"""
        self.workspace_path = workspace_path
        try:
            self.database: json_database.JsonDatabase = json_database.JsonDatabase()
            self.database.create_database(bible_dir=self.workspace_path, codex_dir=self.workspace_path, resources_dir=self.workspace_path+'/.project/', save_all_path=self.workspace_path+"/.project/")
            self.ready = True
        except FileNotFoundError:
            self.ready = False
        self.lspw = lspw

        

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
            return json.dumps(results)

        elif function_name == 'search_resources':
            results = self.search_resources(args['query'], args.get('limit', 10))
            return json.dumps(results)

        elif function_name == 'get_most_similar':
            results = self.get_most_similar(args['text_type'], args['text'])
            return json.dumps([{'text': p[0], 'value': p[1]} for p in results])

        elif function_name == 'get_rarity':
            result = self.get_rarity(args['text_type'], args['text'])
            return json.dumps({"rarity": result})
        elif function_name == "smart_edit":
            result = editor.get_edit(args['before'], args['after'], args['query'])
            return json.dumps({'text': result})
        elif function_name == 'get_text':
            results = self.get_text(args['ref'], args['text_type'])
            return json.dumps({"text": results})
        elif function_name == 'get_similar_drafts':
            results = self.database.get_similar_drafts(ref=args['ref'], top_n=args.get('limit', 5))
            return json.dumps(results)
        elif function_name == 'detect_anomalies':
            results = self.detect_anomalies(args['query'], args.get('limit', 10))
            return json.dumps(results)
        
        
        elif function_name == 'apply_edit':
            self.change_file(args['uri'], args['before'], args['after'])
            self.lspw.refresh_database()
            return json.dumps({'status': 'ok'})
        
        elif function_name == 'hover_word':
            word = self.lspw.most_recent_hovered_word
            return json.dumps({'word': word})
        
        elif function_name == "hover_line":
            if self.lspw:
                line = self.lspw.most_recent_hovered_line
                return json.dumps({'line': line})
            else:
                return json.dumps({'line': ''})

        elif function_name == "get_status":
            key = args['key']
            return json.dumps({'status': self.get_status(key)})
        
        elif function_name == "set_status":
            key = args['key']
            value = args['value']
            self.set_status(key=key, value=value)
            return json.dumps({'status': value})
        
        elif function_name == "predict_word_glosses":
            word = args['word']
            is_source = args.get('is_source', True)
            top_n = args.get('top_n', 3)
            return json.dumps(self.database.predict_word_glosses(word, is_source, top_n))
        
        elif function_name == "get_glosser_info":
            if self.database:
                return json.dumps(self.database.get_glosser_info())
            elif self.glosser == None:
                return json.dumps({"error": "Glosser not initialized"})
            else:
                return json.dumps({"error": "Database not initialized"})
        
        elif function_name == "get_glosser_counts":
            return json.dumps(self.database.get_glosser_counts())
        
        elif function_name == "predict_sentence_glosses":
            return json.dumps(self.database.predict_sentence_glosses(args['sentence'], args['is_source']))
        
        else:
            raise ValueError(f"Unknown function: {function_name}")

    def verse_lad(self, query, vref):
        """
        performs LAD on a verse
        """
        return self.database.get_lad(query, vref=vref)

    def search(self, text_type, query, limit=10):
        """Search the specified database for a query."""
        return self.database.search(query, text_type=text_type, top_n=int(limit))

    def search_resources(self, query, limit=10):
        """searches resources"""
        return self.database.search_resources(query, limit)

    def get_most_similar(self, text_type, text):
        """Get words most similar to the given word from the specified database."""
        return self.bia.synonimize(text, 100)[:15]

    def get_status(self, key: str):
        return self.statuses.get(key, 'none')
    
    def set_status(self, key: str, value: str):
        current = self.statuses.get(key, None)
        if current:
            self.statuses[key] = value
        else:
            self.statuses.update({key: value})
        

    def get_rarity(self, text_type, text):
        """
        tifidf rarity of some words
        """
        return self.database.word_rarity(text=text, text_type=text_type)

    def get_text(self, ref, text_type):
        """Retrieve text from the specified database based on book, chapter, and verse."""
        return self.database.get_text(ref=ref, text_type=text_type)

    def detect_anomalies(self, query, limit=100):
        """
        detects relative differences between source and target translations
        """
        codex_results = self.database.search(query_text=query, text_type="target", top_n=limit)
        try:
            ref = codex_results[0]['ref']
            source_query = self.database.get_text(ref=ref, text_type="source")
            source_results = self.database.search(query_text=source_query, text_type="source", top_n=limit)

            return {
                "bible_results": source_results,
                "codex_results": codex_results
            }
        except IndexError:
            return {
                "bible_results": self.database.search(query_text=query, text_type="source", top_n=limit),
                "codex_results": self.database.search(query_text=query, text_type="target", top_n=limit)
            }
    def change_file(self, uri, before, after):
        after = after.replace('"', '\\"')
        with open(uri, 'r+', encoding='utf-8') as f:
            text = f.read()
            text = text.replace(before, after)
            f.seek(0)
            f.write(text)
            f.truncate()
            
    def apply_edit(self,item, before, after):
        # soemthing that takes a while
        result = editor.get_edit(before, after, item['text'])
        jsn = json.loads(result)
        result = {
            "reference": item['ref'],
            "uri": item['uri'],
            "before": item['text'],
            "after": jsn['edit']
        }
        return result
    
    
universal_socket_router = SocketRouter()
