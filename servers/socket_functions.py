"""
Socket function router, functions, and logic
"""
import os
import re
import json
import threading
from utils import json_database
from utils import bia
from utils import editor
import logging
import socket
import hashlib
from typing import Dict, Any
import time

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
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.DEBUG)
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
        self.logger.addHandler(handler)
        self.data_cache: Dict[str, tuple[Any, float]] = {}
        self.data_hashes: Dict[str, str] = {}
        self.cache_expiration = 5  # Cache expiration time in seconds

    def prepare(self, workspace_path, lspw):
        """prepares the socket stuff"""
        self.workspace_path = workspace_path
        try:
            self.database: json_database.JsonDatabase = json_database.JsonDatabase()

            self.database.create_database(
                bible_dir=self.workspace_path,
                codex_dir=self.workspace_path,
                resources_dir=os.path.join(self.workspace_path, '.project'),
                project_dictionary_path=os.path.join(self.workspace_path, '.project', 'project.dictionary'), # FIXME the project dictionary should be in the /files/ dir, not .project! This needs to be fixed wherever the dictionary is being initialized or created (spell checker?)
                save_all_path=os.path.join(self.workspace_path, '.project')
            )
            self.ready = True
            self.logger.info(f"SocketRouter prepared successfully. Workspace path: {workspace_path}")
        except FileNotFoundError as e:
            self.ready = False
            self.logger.error(f"Error preparing SocketRouter: {e}")
        except Exception as e:
            self.ready = False
            self.logger.error(f"Unexpected error preparing SocketRouter: {e}")
        self.lspw = lspw

    def cache_data(self, key: str, data: Any) -> None:
        """Cache data, its hash, and the current timestamp."""
        data_str = json.dumps(data, sort_keys=True)
        data_hash = hashlib.md5(data_str.encode()).hexdigest()
        self.data_cache[key] = (data, time.time())
        self.data_hashes[key] = data_hash

    def get_cached_data(self, key: str) -> tuple[Any, bool]:
        """Retrieve cached data if it exists and is not expired."""
        if key in self.data_cache:
            data, timestamp = self.data_cache[key]
            if time.time() - timestamp < self.cache_expiration:
                return data, True
        return None, False

    def has_data_changed(self, key: str, data: Any) -> bool:
        """Check if data has changed since last cache."""
        if key not in self.data_hashes:
            return True
        data_str = json.dumps(data, sort_keys=True)
        new_hash = hashlib.md5(data_str.encode()).hexdigest()
        return new_hash != self.data_hashes[key]

    def route_to(self, json_input):
        """
        Routes a json query to the needed function
        """

        try:
            data = json.loads(json_input)
            function_name = data['function_name']
            args = data['args']

            # Generate a cache key based on the function name and arguments
            cache_key = f"{function_name}:{json.dumps(args, sort_keys=True)}"

            # Check if we have valid cached data for this request
            cached_data, is_valid = self.get_cached_data(cache_key)
            if is_valid and not self.has_data_changed(cache_key, cached_data):
                return json.dumps(cached_data)

            # If no valid cached data or data has changed, process the request
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
                force_refresh = args.get('force_refresh', False)
                cached_data, is_valid = self.get_cached_data(cache_key)
                if force_refresh or not is_valid or self.has_data_changed(cache_key, cached_data):
                    result = self.database.get_glosser_info()
                    self.cache_data(cache_key, result)
                else:
                    result = cached_data
                return json.dumps(result)
            
            elif function_name == "get_glosser_counts":
                result = self.database.get_glosser_counts()
                self.cache_data(cache_key, result)
                return json.dumps(result)
            
            elif function_name == "predict_sentence_glosses":
                return json.dumps(self.database.predict_sentence_glosses(args['sentence'], args['is_source']))
            
            else:
                raise ValueError(f"Unknown function: {function_name}")

        except json.JSONDecodeError as e:
            self.logger.error(f"JSON decoding error: {e}")
            return json.dumps({"error": "Invalid JSON input"})
        except KeyError as e:
            self.logger.error(f"Missing key in JSON input: {e}")
            return json.dumps({"error": f"Missing required key: {e}"})
        except Exception as e:
            self.logger.error(f"Unexpected error in route_to: {e}")
            return json.dumps({"error": "An unexpected error occurred"})

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
    
    
try:
    universal_socket_router = SocketRouter()
except Exception as e:
    logging.error(f"Error initializing SocketRouter: {e}")
    universal_socket_router = None