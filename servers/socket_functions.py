"""
Socket function router, functions, and logic
"""
import re
import json
import threading
from utils import json_database
from utils import lad
from utils import bia
from utils import editor


def replace_pairs(text):
    # Define a regular expression pattern to match pairs of *some text*
    pattern = r'\*(.*?)\*'
    
    # Use re.sub to replace matches with <b>some text</b>
    replaced_text = re.sub(pattern, r'<b>\1</b>', text)
    
    return replaced_text

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
            self.anomaly_detector: lad.LAD = lad.LAD(codex=self.database, bible=self.database, n_samples=3)
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
        
        elif function_name == 'get_text':
            results = self.get_text(args['ref'], args['text_type'])
            return json.dumps({"text": results})
        
        elif function_name == 'detect_anomalies':
            results = self.detect_anomalies(args['query'], args.get('limit', 10))
            return json.dumps(results)
        
        elif function_name == 'search_for_edits':
            self.set_status('smartview', 'loading')
            results = self.search_for_edits(args['before'], args['after'])
            return json.dumps(results)
        
        elif function_name == 'apply_edit':
            self.change_file(args['uri'], args['before'], args['after'])
            return json.dumps({'status': 'ok'})
        
        elif function_name == 'hover_word':
            word = self.lspw.most_recent_hovered_word
            return json.dumps({'word': word})
        
        elif function_name == "hover_line":
            line = self.lspw.most_recent_hovered_line
            return json.dumps({'line': line})
        
        elif function_name == "get_status":
            key = args['key']
            return json.dumps({'status': self.get_status(key)})
        
        elif function_name == "set_status":
            key = args['key']
            value = args['value']
            self.set_status(key=key, value=value)
            return json.dumps({'status': value})

        elif function_name == 'get_edit_results':
            results = self.get_edit_results()
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
    def change_file(self, uri, before, after):
        after = after.replace("*", "")
        before = before.replace("*", "") # in case its an undo command
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
    
    def search_for_edits(self, before, after):
        items = self.database.search(before, text_type="target")
        lock = threading.Lock()  # Create a lock for thread safety

        def apply_edit_to_item(item_index):
            try:
                if item_index < len(items):
                    item = items[item_index]
                    result = self.apply_edit(item, before, after)
                    with lock:  # Acquire the lock before appending to edit_results
                        self.edit_results.append(result)
                    # Spawn a new thread for the next item
                    threading.Thread(target=apply_edit_to_item, args=(item_index + 1,)).start()
                else:
                    self.set_status('smartview', 'completed')
            except:
                self.set_status('smartview', 'completed')

        # Start processing the first item
        apply_edit_to_item(0)
        return items

    def get_edit_results(self):
        
        ret = self.edit_results.copy()
        self.edit_results = []
        return ret
    
universal_socket_router = SocketRouter()
