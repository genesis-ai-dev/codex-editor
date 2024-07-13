
import re
import json
import threading
from typing import Dict, List, Any, Optional
from dataclasses import dataclass

import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

from utils import json_database, bia, editor, api_handler

@dataclass
class SearchResult:
    text: str
    value: float


class SocketRouter:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        self.workspace_path: str = ""
        self.database: Optional[json_database.JsonDatabase] = None
        self.edit_results: List[Any] = []
        self.ready: bool = False
        self.bia: Optional[bia.BidirectionalInverseAttention] = None
        self.lspw: Any = None
        self.statuses: Dict[str, str] = {}

    def prepare(self, workspace_path: str, lspw: Any) -> None:
        self.workspace_path = workspace_path
        self.lspw = lspw
        try:
            self.database = json_database.JsonDatabase()
            self.database.create_database(
                bible_dir=self.workspace_path,
                codex_dir=self.workspace_path,
                resources_dir=f"{self.workspace_path}/.project/",
                save_all_path=f"{self.workspace_path}/.project/"
            )
            self.ready = True
        except FileNotFoundError:
            self.ready = False

    def route_to(self, json_input: str) -> str:
        data = json.loads(json_input)
        function_name = data['function_name']
        args = data['args']

        router = {
            'verse_lad': self._handle_verse_lad,
            'search': self._handle_search,
            'search_resources': self._handle_search_resources,
            'get_most_similar': self._handle_get_most_similar,
            'get_rarity': self._handle_get_rarity,
            'smart_edit': self._handle_smart_edit,
            'get_text': self._handle_get_text,
            'get_similar_drafts': self._handle_get_similar_drafts,
            'detect_anomalies': self._handle_detect_anomalies,
            'apply_edit': self._handle_apply_edit,
            'hover_word': self._handle_hover_word,
            'hover_line': self._handle_hover_line,
            'get_status': self._handle_get_status,
            'set_status': self._handle_set_status,
            'send_api_request': self._handle_send_api_request
        }

        handler = router.get(function_name)
        if handler:
            return handler(args)
        else:
            raise ValueError(f"Unknown function: {function_name}")

    def _handle_verse_lad(self, args: Dict[str, Any]) -> str:
        result = self.database.get_lad(args['query'], vref=args['vref'])
        return json.dumps({"score": result})

    def _handle_search(self, args: Dict[str, Any]) -> str:
        results = self.database.search(args['query'], text_type=args['text_type'], top_n=int(args.get('limit', 10)))
        return json.dumps(results)

    def _handle_search_resources(self, args: Dict[str, Any]) -> str:
        results = self.database.search_resources(args['query'], args.get('limit', 10))
        return json.dumps(results)

    def _handle_get_most_similar(self, args: Dict[str, Any]) -> str:
        results = self.bia.synonimize(args['text'], 100)[:15]
        return json.dumps([{'text': p[0], 'value': p[1]} for p in results])

    def _handle_get_rarity(self, args: Dict[str, Any]) -> str:
        result = self.database.word_rarity(text=args['text'], text_type=args['text_type'])
        return json.dumps({"rarity": result})

    def _handle_smart_edit(self, args: Dict[str, Any]) -> str:
        result = editor.get_edit(args['before'], args['after'], args['query'], args['api_key'])

        return json.dumps({'text': result})

    def _handle_get_text(self, args: Dict[str, Any]) -> str:
        results = self.database.get_text(ref=args['ref'], text_type=args['text_type'])
        return json.dumps({"text": results})

    def _handle_get_similar_drafts(self, args: Dict[str, Any]) -> str:
        results = self.database.get_similar_drafts(ref=args['ref'], top_n=args.get('limit', 5), book=args.get('book', ''))
        return json.dumps(results)

    def _handle_detect_anomalies(self, args: Dict[str, Any]) -> str:
        codex_results = self.database.search(query_text=args['query'], text_type="target", top_n=args.get('limit', 100))
        try:
            ref = codex_results[0]['ref']
            source_query = self.database.get_text(ref=ref, text_type="source")
            source_results = self.database.search(query_text=source_query, text_type="source", top_n=args.get('limit', 100))
        except IndexError:
            source_results = self.database.search(query_text=args['query'], text_type="source", top_n=args.get('limit', 100))
        
        return json.dumps({
            "bible_results": source_results,
            "codex_results": codex_results
        })

    def _handle_apply_edit(self, args: Dict[str, Any]) -> str:
        self.change_file(args['uri'], args['before'], args['after'])
        self.lspw.refresh_database()
        return json.dumps({'status': 'ok'})

    def _handle_hover_word(self, args: Dict[str, Any]) -> str:
        word = self.lspw.most_recent_hovered_word
        return json.dumps({'word': word})

    def _handle_hover_line(self, args: Dict[str, Any]) -> str:
        line = self.lspw.most_recent_hovered_line if self.lspw else ''
        return json.dumps({'line': line})

    def _handle_get_status(self, args: Dict[str, Any]) -> str:
        return json.dumps({'status': self.get_status(args['key'])})

    def _handle_set_status(self, args: Dict[str, Any]) -> str:
        self.set_status(key=args['key'], value=args['value'])
        return json.dumps({'status': args['value']})

    def change_file(self, uri: str, before: str, after: str) -> None:
        after = after.replace('"', '\\"')
        with open(uri, 'r+', encoding='utf-8') as f:
            text = f.read()
            text = text.replace(before, after)
            f.seek(0)
            f.write(text)
            f.truncate()

    def get_status(self, key: str) -> str:
        return self.statuses.get(key, 'none')
    
    def set_status(self, key: str, value: str) -> None:
        self.statuses[key] = value
    
    def _handle_send_api_request(self, args: Dict[str, Any]) -> str:
        try:
            received_data = args.get('config', {})
            config = received_data.get('config', {})
            verse_data = received_data.get('verse_data', {})
        
            logging.info(f"Received config: {config}")
            logging.info(f"Received verse_data: {verse_data}")
            
            logging.info("Creating APIHandler instance...")
            api_handler_instance = api_handler.APIHandler(config, verse_data)
            logging.info("APIHandler instance created successfully")
            
            logging.info("Calling send_api_request method...")
            result = api_handler_instance.send_api_request()
            logging.info(f"API request completed. Result: {result}")
            
            return json.dumps({"response": result})
        except Exception as e:
            logging.error(f"Error in _handle_send_api_request: {str(e)}")
            logging.error(f"Error type: {type(e).__name__}")
            logging.error(f"Error traceback: ", exc_info=True)
            return json.dumps({"error": str(e)})

universal_socket_router = SocketRouter()