import time
import requests
import logging
import re
from typing import Dict, Any, List

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class APIHandler:
    def __init__(self, config: Dict[str, Any], verse_data: Dict[str, Any]):
        self.config = config
        self.verse_data = verse_data

    def build_message(self) -> List[Dict[str, str]]:
        system_content = f"""# Biblical Translation Expert
        
        You are an expert biblical translator working on translating from {self.verse_data['source_language_name']} to the target language. Your task is to learn the target language and complete a partial translation of a verse.
        
        ## Guidelines
        
        1. Only complete the missing part of the verse; do not modify already translated portions.
        2. Do not add explanatory content or commentary.
        3. If crucial information is missing, provide the best possible translation based on available context.
        
        Use the data provided by the user to understand how the target language relates to {self.verse_data['source_language_name']}, then translate the Partial Translation."""

        user_content = f"""# Translation Task
        
        ## Reference Data
        
        ### Similar Verse Translations
        
        {self.reformat_pairs(self.verse_data['similar_pairs'])}
        
        ### Translations of Surrounding Verses
        
        {self.reformat_pairs(self.verse_data['surrounding_context'])}
        
        ### Additional Resources
        
        {self.verse_data['other_resources']}
        
        ## Instructions
        
        1. Complete the partial translation of the verse.
        2. Ensure your translation fits seamlessly with the existing partial translation.
        
        ## Verse to Complete
        
        Reference: {self.verse_data['verse_ref']}
        Source: {self.verse_data['source_verse']}
        Partial Translation: 
        "{self.verse_data['current_verse']}"""

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

    def send_api_request(self, args: Dict[str, Any], max_retries: int = 3, retry_delay: float = 1.0) -> str:
        try:
            messages = self.build_message()
            
            logging.info(f"Using config: {self.config}")
            logging.info(f"Using verse_data: {self.verse_data}")
            
            url = "https://api.openai.com/v1" + "/chat/completions"
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
                    return response.json()['choices'][0]['message']['content'].replace('"', '\"')
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
    
# Create an instance of APIHandler
api_handler = APIHandler({}, {})