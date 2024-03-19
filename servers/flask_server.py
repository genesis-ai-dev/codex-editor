from typing import cast
from flask import Flask, request, jsonify
from tools.embedding import DataBase  # Updated import path
from enum import Enum
from typing import Dict, Any, AnyStr
from flask_cors import CORS
from urllib import parse as url_parse
import logging
from typing import TextIO
import sys
import glob
import json
from time import sleep

app = Flask(__name__)
CORS(app, origins='*')  # Allow requests from any origin

initilaizers = {
    ".codex": (True, False),
    ".bible": (True, False),
    "resources": (False, False),
    "reference_material": (False, False)
}

ACTIVE_DATABASE: DataBase | None = None
WORKSPACE_PATH: str | None = None


class DebugHandler(logging.Handler):
    def __init__(self, level=logging.NOTSET):
        super().__init__(level)
        self.records = []

    def emit(self, record):
        self.records.append(self.format(record))

# Redirect Flask's default logger to our custom handler
debug_handler = DebugHandler()
app.logger.removeHandler(app.logger.handlers[0])
app.logger.addHandler(debug_handler)

# Capture stdout and stderr
class StdoutStderrWrapper:
    def __init__(self, stream, handler):
        self.stream = stream
        self.handler = handler

    def write(self, message):
        self.stream.write(message)
        self.handler.emit(logging.LogRecord(
            'stdout/stderr', logging.INFO, '', 0, message, (), None))

    def flush(self):
        self.stream.flush()

sys.stdout = cast(TextIO, StdoutStderrWrapper(sys.stdout, debug_handler))
sys.stderr = cast(TextIO, StdoutStderrWrapper(sys.stderr, debug_handler))

# Route to display all debug information
@app.route('/debug')
def debug():
    return '<br>'.join(debug_handler.records)

@app.route("/start", methods=['GET'])
def initialize_databases() -> tuple:
    global WORKSPACE_PATH
    """
    Initializes the databases required for the application.

    Reads the work path from the request arguments, iterates over the DatabaseName enum to create
    and store DataBase instances in the global databases dictionary.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    work_path = request.args.get("data_path", default="")
    if not work_path:
        return jsonify({"error": "Missing 'data_path' argument"}), 400
    work_path = work_path.replace('file://', '') # FIXME: this feels wrong
    WORKSPACE_PATH = work_path

    return jsonify({"Databases initialized successfully": WORKSPACE_PATH}), 200

def get_active_database(db_name: str, use_tokenizer: bool, use_fasttext: bool) -> DataBase:
    global ACTIVE_DATABASE
    if not WORKSPACE_PATH:
        raise ValueError("Workspace path is not set. Call /start to initialize.")

    target_path = WORKSPACE_PATH + '/nlp/embeddings/' + db_name
    if ACTIVE_DATABASE and ACTIVE_DATABASE.db_path != target_path:
        ACTIVE_DATABASE.close()
        ACTIVE_DATABASE = None
    if not ACTIVE_DATABASE:
        ACTIVE_DATABASE = DataBase(db_path=target_path, has_tokenizer=use_tokenizer, use_fasttext=use_fasttext)
    return ACTIVE_DATABASE

@app.route('/upsert_codex_file', methods=['POST'])
def upsert_codex_file() -> tuple:
    """
    Upserts a codex file into the specified database.

    Expects 'db_name', 'path', and optionally in the JSON payload of the request.
    If the required parameters are present, it calls the upsert_codex_file method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    data: Dict | Any = request.json
    db_name = '.codex'
    path = data.get('path')

    if not db_name or not path:
        return jsonify({"error": "Both 'db_name' and 'path' are required parameters"}), 400
    
    try:
        use_tokenizer, use_fasttext = initilaizers[db_name]
        active_db = get_active_database(db_name, use_tokenizer, use_fasttext)
        active_db.upsert_file(path)
        return jsonify({"message": "Codex file upserted"}), 200
    except ValueError as e:
        print("CODEX ERROR: ", str(e))

        return jsonify({"error": str(e)}), 500


@app.route('/upsert_bible_file', methods=['POST'])
def upsert_bible_file() -> tuple:
    """
    Upserts a codex file into the specified database.

    Expects 'db_name', 'path', and optionally in the JSON payload of the request.
    If the required parameters are present, it calls the upsert_bible_file method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    data: Dict | Any = request.json
    db_name = ".bible"
    path = data.get('path')

    if not db_name or not path:
        return jsonify({"error": "Both 'db_name' and 'path' are required parameters"}), 400
    
    try:
        use_tokenizer, use_fasttext = initilaizers[db_name]
        active_db = get_active_database(db_name, use_tokenizer, use_fasttext)
        active_db.upsert_file(path)
        return jsonify({"message": "Bible file upserted"}), 200
    except ValueError as e:
        print("BIBLE ERROR: ", str(e))

        return jsonify({"error": str(e)}), 500

WORKSPACE_PATH = '/path/to/workspace'  # Assuming WORKSPACE_PATH is defined

@app.route('/upsert_all_codex_files', methods=['GET'])
def upsert_all_codex_files() -> tuple:
    """
    Finds all .codex files within the WORKSPACE_PATH directory and upserts them into the database.
    
    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    
    codex_files = glob.glob(f'{WORKSPACE_PATH}/**/*.codex', recursive=True)
    use_tokenizer, use_fasttext = initilaizers[".codex"]
    active_db = get_active_database(".codex", use_tokenizer, use_fasttext)

    for file_path in codex_files:
        active_db.upsert_bible_file(file_path)
        sleep(.1)
    active_db.tokenizer.upsert_all()
    return jsonify({"message": f"Upserted {len(codex_files)} .codex files"}), 200

@app.route('/upsert_all_resource_files', methods=['GET'])
def upsert_all_resource_files() -> tuple:
    """
    Finds all files within the WORKSPACE_PATH/resources directory and upserts them into the database.
    
    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    try:
        resource_files = glob.glob(f'{WORKSPACE_PATH}/.project/resources/*', recursive=True)
        use_tokenizer, use_fasttext = initilaizers["resources"]
        active_db = get_active_database("resources", use_tokenizer, use_fasttext)

        for file_path in resource_files:
            active_db.upsert_bible_file(file_path)
            active_db.save()

        return jsonify({"message": f"Upserted {len(resource_files)} resource files"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/upsert_all_bible_files', methods=['GET'])
def upsert_all_bible_files() -> tuple:
    """
    Finds all .bible files within the WORKSPACE_PATH directory and upserts them into the database.
    
    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    try:
        bible_files = glob.glob(f'{WORKSPACE_PATH}/**/*.bible', recursive=True)
        use_tokenizer, use_fasttext = initilaizers[".bible"]
        active_db = get_active_database(".bible", use_tokenizer, use_fasttext)

        for file_path in bible_files:
            active_db.upsert_file(file_path)
        active_db.tokenizer.upsert_all()

        return jsonify({"message": f"Upserted {len(bible_files)} .bible files"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/upsert_data', methods=['POST'])
def upsert_data() -> tuple:
    """
    Upserts text data into the specified database.

    Expects 'db_name', 'text', 'uri', and optionally 'metadata', 'book', 'chapter', 'verse' in the JSON payload of the request.
    If the required parameters are present, it calls the upsert_data method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    data: Dict | Any = request.json
    db_name = data.get('db_name')
    text = data.get('text')
    if not db_name or not text:
        return jsonify({"error": "Both 'db_name' and 'text' are required parameters"}), 400
    uri: str = data.get('uri', "")
    metadata = data.get('metadata', {})
    book = data.get('book', "")
    chapter = data.get('chapter', -1)
    verse = data.get('verse', "")

    try:
        use_tokenizer, use_fasttext = initilaizers[db_name]
        active_db = get_active_database(db_name, use_tokenizer, use_fasttext)
        reference = f'{book} {chapter}:{verse}'
        active_db.upsert_data(text=text, uri=uri, metadata=metadata, book=book, chapter=chapter, verse=verse, reference=reference)
        return jsonify("Data has been upserted"), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 500

@app.route("/upsert_all", methods=['GET'])
def upsert_all() -> tuple:
    if ACTIVE_DATABASE and ACTIVE_DATABASE.tokenizer:
        ACTIVE_DATABASE.tokenizer.upsert_all()
        return jsonify("success"), 200
    else:
        return jsonify("No Active Database"), 500
    
@app.route('/search', methods=['GET'])
def search() -> tuple:
    """
    Searches for a query in the specified database after decoding the query parameter.

    Expects 'db_name', 'query', and optionally 'limit', 'min_score' in the request arguments.
    The 'query' parameter is URL-decoded before processing.
    If the required parameters are present, it calls the simple_search method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    db_name = request.args.get('db_name')
    query = request.args.get('query')
    if not db_name or not query:
        return jsonify({"error": "Both 'db_name' and 'query' are required parameters"}), 400
    try:
        query_decoded = url_parse.unquote(query)
    except Exception as e:
        return jsonify({"error": f"Failed to decode query parameter: {str(e)}"}), 400
    limit = request.args.get('limit', default=5, type=int)

    try:
        use_tokenizer, use_fasttext = initilaizers[db_name]
        active_db = get_active_database(db_name, use_tokenizer, use_fasttext)
        results = active_db.search(query_decoded, limit)
        return jsonify(results), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 500


@app.route('/searchboth', methods=["GET"])
def search_both() -> tuple:

    query = request.args.get('query')
    limit = request.args.get('limit', default=5, type=int)

    try:
        use_tokenizer, use_fasttext = initilaizers['.codex']
        active_db = get_active_database('.codex', use_tokenizer, use_fasttext)
        first = active_db.search(query=query, limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to decode query parameter: {str(e)}"}), 400
    try:
        use_tokenizer, use_fasttext = initilaizers['.bible']
        active_db = get_active_database('.bible', use_tokenizer, use_fasttext)
        second = active_db.search(query=query, limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to decode query parameter: {str(e)}"}), 400
    
    result = jsonify({'target': first, 'source': second})
    print(result)
    return result, 200


@app.route('/save', methods=['POST'])
def save() -> tuple:
    """
    Saves the current state of the specified database.

    Expects 'db_name' in the JSON payload of the request.
    If the required parameter is present, it calls the save method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    data: Dict | Any = request.json
    db_name: str | Any = data.get('db_name')
    if not db_name:
        return jsonify({"error": "Missing 'db_name' parameter"}), 400
    try:
        use_tokenizer, use_fasttext = initilaizers[db_name]
        active_db = get_active_database(db_name, use_tokenizer, use_fasttext)
        active_db.save()
        return jsonify({"message": f"Database '{db_name}' state saved"}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 404



@app.route("/get_tokens", methods=["GET"])
def get_tokens() -> tuple:
    all_tokens = []
    try:
        for db_name, (use_tokenizer, use_fasttext) in initilaizers.items():
            active_db = get_active_database(db_name, use_tokenizer, use_fasttext)
            if active_db.has_tokenizer:
                all_tokens.append(len(active_db.tokenizer.tokenizer.tokens))
        return jsonify({"tokens": all_tokens}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 500

@app.route('/detect_anomalies', methods=['GET'])
def detect_anomalies() -> tuple:
    """
    Detects anomalies between two databases by comparing the search results of verses,
    and provides detailed information about the anomalies, including which database the verse is missing from.
    Additionally, returns all the data that /search_both would return.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    query = request.args.get('query', default='', type=str)
    limit = request.args.get('limit', default=5, type=int)
    

    try:
        use_tokenizer, use_fasttext = initilaizers['.codex']
        codex_db = get_active_database('.codex', use_tokenizer, use_fasttext)
        codex_results = codex_db.search(query=query, limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to search in .codex database: {str(e)}"}), 400
    try:
        bible_query = codex_results[0]
        bible_query_formatted = f"{bible_query['book']} {bible_query['chapter']}:{bible_query['verse']}"
        use_tokenizer, use_fasttext = initilaizers['.bible']
        bible_db = get_active_database('.bible', use_tokenizer, use_fasttext)
        print(bible_query_formatted)
        bible_query_result = bible_db.get_text_from(book=bible_query['book'], chapter=bible_query['chapter'], verse=bible_query['verse'])
        print(bible_query_result)
        bible_results = bible_db.search(query=bible_query_result[0]['text'], limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to search in .bible database: {str(e)}"}), 400

    # Convert search results to sets for easier comparison
    codex_set = set((item['book'], item['chapter'], item['verse']) for item in codex_results)
    bible_set = set((item['book'], item['chapter'], item['verse']) for item in bible_results)

    # Find anomalies where the two databases disagree on verses
    detailed_anomalies = []
    for verse in codex_set.symmetric_difference(bible_set):
        # Construct the reference in the expected format "BOOK CHAPTER:VERSE"
        reference = f"{verse[0]} {verse[1]}:{verse[2]}".strip()
        codex_exists = codex_db.exists([reference])
        bible_exists = bible_db.exists([reference])

        # Determine the source of the anomaly
        if bible_set.issuperset({verse}) and codex_exists:
            detailed_anomalies.append({"reference": reference, "reason": "Missing Verses"})
        elif codex_set.issuperset({verse}) and not bible_exists:
            detailed_anomalies.append({"reference": reference, "reason": "Extra Verses"})

    # Prepare the combined search results
    combined_results = {
        'codex_results': codex_results,
        'bible_results': bible_results,
        'detailed_anomalies': detailed_anomalies
    }

    return jsonify(combined_results), 200

@app.route("/get_text")
def get_text_frm():
    return ACTIVE_DATABASE.get_text_from(request.args['book'], request.args['chapter'], request.args['verse'])

@app.route('/heartbeat', methods=['GET'])
def heartbeat() -> tuple:
    """
    Returns a simple JSON response to indicate that the server is running.


    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    database_names_string = ', '.join(initilaizers.keys())
    if not WORKSPACE_PATH:
        database_names_string = ""

    return jsonify({"message": "Server is running", "databases": f'{database_names_string}'}), 200


app.run(port=5554, debug=True)

