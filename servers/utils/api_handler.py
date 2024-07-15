import time
import requests
import logging
import re
from typing import Dict, Any, List, Tuple
import outlines
import json
import random

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def api_handler_readiness_test() -> str:
    return "pong"

class APIHandler:
    def __init__(self, config: Dict[str, Any], verse_data: Dict[str, Any]):
        self.config = config
        self.verse_data = verse_data
        
    def parse_json_pairs(self, json_pairs_string: str) -> List[Dict[str, str]]:
        # Split the string into individual JSON objects
        json_strings = json_pairs_string.strip().split('\n\n')
        
        # Parse each JSON object and collect them in a list
        parsed_pairs = []
        for json_str in json_strings:
            try:
                pair = json.loads(json_str)
                # Create partial translation
                words = pair['target'].split()
                n = random.randint(0, 5)
                partial_translation = f"{pair['ref']} {' '.join(words[:n])}"
                
                # Create new dictionary with desired structure
                parsed_pair = {
                    "ref": pair['ref'],
                    "source": pair['source'],
                    "partial_translation": partial_translation,
                    "completion": ' '.join(words[n:])
                }
                parsed_pairs.append(parsed_pair)
            except json.JSONDecodeError:
                logging.warning(f"Failed to parse JSON object: {json_str}")
            except KeyError as e:
                logging.warning(f"Missing key in JSON object: {e}")
            except IndexError:
                logging.warning(f"Failed to create partial translation for: {json_str}")
        
        return parsed_pairs
    
    @staticmethod
    @outlines.prompt
    def build_system_prompt(source_language_name: str):
        """
        # Biblical Translation Expert
        --------
        You are an expert biblical translator working on translating from {{ source_language_name }} to the target language. Your task is to learn the target language and complete a partial translation of a verse.
        
        ## Guidelines
        --------
        1. Only complete the missing part of the verse; do not modify already translated portions.
        2. Do not add explanatory content or commentary.
        3. If crucial information is missing, provide the best possible translation based on available context.
        
        Use the data provided by the user to understand how the target language relates to {{ source_language_name }}, then translate the Partial Translation.
        """
    @staticmethod
    @outlines.prompt
    def build_user_prompt(similar_pairs: List[Dict[str, str]], surrounding_context: List[Dict[str, str]], verse_ref: str, source_verse: str, current_verse: str):        
        """
        # Please complete the translation task based on the following examples:

        Example translations:
        --------

        {% for pair in similar_pairs %}
        ref: {{ pair.ref }}
        source: {{ pair.source }}
        partial translation: {{ pair.partial_translation }}
        completion: {{ pair.completion }}
        
        {% endfor %}

        {% for pair in surrounding_context %}
        ref: {{ pair.ref }}
        source: {{ pair.source }}
        partial translation: {{ pair.partial_translation }}
        completion: {{ pair.completion }}
        
        {% endfor %}
        
        Other Resources:
        --------
        {self.verse_data['other_resources']}
        
        Task:
        --------
        only return the completion of the verse.
        
        DO NOT use any of the following excluded words:
        completion, partial, translation, source, ref, verse, {{ verse_ref }}, {{ source_verse }}
        
        ref: {{ verse_ref }}
        source: {{ source_verse }}
        partial translation: {{ current_verse }}
        completion: 
        """

    def build_message(self) -> List[Dict[str, str]]:
        
        system_content = self.build_system_prompt(self.verse_data['source_language_name'])
        user_content = self.build_user_prompt(
            self.parse_json_pairs(self.reformat_pairs(self.verse_data['similar_pairs'])),
            self.parse_json_pairs(self.reformat_pairs(self.verse_data['surrounding_context'])),
            self.verse_data['verse_ref'],
            self.verse_data['source_verse'],
            self.verse_data['current_verse']
        )

        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content}
        ]

    def reformat_pairs(self, pairs_string: str) -> str:
        # Regex to match whitespace before "source"
        source_whitespace_regex = r'\s+(?="source)'
        
        # Replace the matched whitespace with a newline and tab
        result = re.sub(source_whitespace_regex, '\n\t', pairs_string)
        
        return result

    def send_api_request(self, max_retries: int = 3, retry_delay: float = 1.0) -> Tuple[str, List[Dict[str, str]]]:
        try:
            messages = self.build_message()
            
            url = self.config.get('endpoint', 'https://api.openai.com/v1') + "/chat/completions"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.get('api_key', '')}"
            }
            data = {
                "model": self.config.get('model', 'gpt-4'),
                "messages": messages,
                "max_tokens": self.config.get('max_tokens', 2000),
                "temperature": self.config.get('temperature', 0.8),
                "stream": False,
                "stop": ["\n\n", "\r\r", "\r\n\r", "\n\r\n"],
            }

            for attempt in range(max_retries):
                try:
                    response = requests.post(url, headers=headers, json=data, timeout=30)
                    response.raise_for_status()
                    finalResponse = response.json()['choices'][0]['message']['content'].replace('"', '\"')
                    return [finalResponse, messages]
                except requests.exceptions.RequestException as req_err:
                    logging.error(f"Request error: {req_err}")
                    if attempt < max_retries - 1:
                        logging.warning(f"Request attempt {attempt + 1} failed. Retrying in {retry_delay} seconds...")
                        time.sleep(retry_delay)
                    else:
                        raise Exception(f"Failed to complete request after {max_retries} attempts: {req_err}")
                except KeyError as key_err:
                    logging.error(f"Unexpected response format: {key_err}")
                    raise Exception(f"Unexpected response format: {key_err}")
        except Exception as e:
            logging.error(f"Unexpected error in send_api_request: {str(e)}")
            raise Exception(f"Unexpected error in send_api_request: {str(e)}")