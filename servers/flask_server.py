from typing import cast
from flask import Flask, request, jsonify
from tools.embedding import Database
from typing import Dict, Any, AnyStr
from flask_cors import CORS
from urllib import parse as url_parse
import logging
from typing import TextIO
import sys
import glob
from time import sleep
import os 
import shutil

app = Flask(__name__)
CORS(app, origins='*')  # Allow requests from any origin

initializers = {
    ".codex": (True, True),
    ".bible": (True, True),
    "resources": (False, False),
    "reference_material": (False, False)
}

DATABASES = {}
WORKSPACE_PATH = ""


class DebugHandler(logging.Handler):
    """Custom logging handler to store log records."""
    def __init__(self, level=logging.NOTSET):
        super().__init__(level)
        self.records = []

    def emit(self, record):
        """Append formatted log record to the records list."""
        self.records.append(self.format(record))

# Redirect Flask's default logger to our custom handler
debug_handler = DebugHandler()
app.logger.removeHandler(app.logger.handlers[0])
app.logger.addHandler(debug_handler)

# Capture stdout and stderr
class StdoutStderrWrapper:
    """Wrapper class to capture stdout and stderr, redirecting them to a logging handler."""
    def __init__(self, stream, handler):
        self.stream = stream
        self.handler = handler

    def write(self, message):
        """Write message to the stream and logging handler."""
        self.stream.write(message)
        self.handler.emit(logging.LogRecord(
            'stdout/stderr', logging.INFO, '', 0, message, (), None))

    def flush(self):
        """Flush the stream."""
        self.stream.flush()

sys.stdout = cast(TextIO, StdoutStderrWrapper(sys.stdout, debug_handler))
sys.stderr = cast(TextIO, StdoutStderrWrapper(sys.stderr, debug_handler))

@app.route('/debug')
def debug():
    """Return all debug information as HTML."""
    return '<br>'.join(debug_handler.records)

@app.route('/start', methods=['GET'])
def initialize_databases():
    """Initialize databases with the provided workspace path."""
    global WORKSPACE_PATH
    work_path = request.args.get("data_path", default="")
    if "codex-editor " in work_path:
        return jsonify("Ignoring request")
    if not work_path:
        return jsonify({"error": "Missing 'data_path' argument"}), 400
    WORKSPACE_PATH = work_path.replace('file://', '')
    return jsonify({"Databases initialized successfully": WORKSPACE_PATH}), 200


def get_database(db_name: str) -> Database:
    """Retrieve or create a database instance by name."""
    if db_name not in DATABASES:
        use_tokenizer, use_fasttext = initializers[db_name]
        db_path = f"{WORKSPACE_PATH}/nlp/embeddings"
        unified_db_path = f"{db_path}/unified_database"
        if not os.path.exists(unified_db_path):
            shutil.rmtree(f"{WORKSPACE_PATH}/nlp/", ignore_errors=True)
        DATABASES[db_name] = Database(db_path=db_path, database_name=db_name, has_tokenizer=use_tokenizer, use_fasttext=use_fasttext)
    return DATABASES[db_name]


@app.route('/upsert_codex_file', methods=['POST'])
def upsert_codex_file():
    """Upsert a .codex file into the database."""
    data = request.json
    path = data.get('path')
    if not path:
        return jsonify({"error": "'path' is a required parameter"}), 400

    try:
        active_db = get_database('.codex')
        active_db.upsert_file(path)
        return jsonify({"message": "Codex file upserted"}), 200
    except ValueError as e:
        print("CODEX ERROR: ", str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/train_gensim_model", methods=['GET'])
def train_gensim_model():
    """Train a Gensim model on the specified database."""
    db_name = request.args.get("db_name", default=".codex")
    active_db = get_database(db_name)
    active_db.train_fasttext()
    return jsonify("Ok"), 200


@app.route('/upsert_bible_file', methods=['POST'])
def upsert_bible_file():
    """Upsert a .bible file into the database."""
    data = request.json
    path = data.get('path')
    if not path:
        return jsonify({"error": "'path' is a required parameter"}), 400

    try:
        active_db = get_database('.bible')
        active_db.upsert_file(path)
        return jsonify({"message": "Bible file upserted"}), 200
    except ValueError as e:
        print("BIBLE ERROR: ", str(e))
        return jsonify({"error": str(e)}), 500


@app.route('/upsert_all_codex_files', methods=['GET'])
def upsert_all_codex_files():
    """Upsert all .codex files from the workspace path into the database."""
    codex_files = glob.glob(f'{WORKSPACE_PATH}/**/*.codex', recursive=True)

    active_db = get_database('.codex')

    for file_path in codex_files:
        active_db.upsert_file(file_path)
    active_db.tokenizer.upsert_all()
    active_db.upsert_queue()
    active_db.save()
    return jsonify({"message": f"Upserted {len(codex_files)} .codex files {codex_files} from {WORKSPACE_PATH}"}), 200


@app.route('/upsert_all_resource_files', methods=['GET'])
def upsert_all_resource_files():
    """Upsert all resource files from the workspace path into the database."""
    try:
        resource_files = glob.glob(f'{WORKSPACE_PATH}/.project/resources/*', recursive=True)
<<<<<<< HEAD
        active_db = get_database("resources")
=======
        use_tokenizer, use_fasttext = initilaizers["resources"]
        active_db = get_active_database("resources", use_tokenizer, use_fasttext)
>>>>>>> 36680e8df44d94ad8246adf71395c2a3031e30f4

        for file_path in resource_files:
            active_db.upsert_file(file_path)
        active_db.upsert_queue()
        active_db.save()


        return jsonify({"message": f"Upserted {len(resource_files)} resource files"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/upsert_all_bible_files', methods=['GET'])
def upsert_all_bible_files():
    """Upsert all .bible files from the workspace path into the database."""
    bible_files = glob.glob(f'{WORKSPACE_PATH}/**/*.bible', recursive=True)
    
    active_db = get_database('.bible')

    for file_path in bible_files:
        active_db.upsert_file(file_path)
    active_db.upsert_queue()
    active_db.tokenizer.upsert_all()
    active_db.save()

    return jsonify({"message": f"Upserted {len(bible_files)} .bible files {bible_files} from {WORKSPACE_PATH}"}), 200


@app.route('/upsert_data', methods=['POST'])
def upsert_data():
    """Upsert data into the specified database."""
    data = request.json
    db_name = data.get('db_name')
    text = data.get('text')
    if not db_name or not text:
        return jsonify({"error": "Both 'db_name' and 'text' are required parameters"}), 400
    uri = data.get('uri', "")
    metadata = data.get('metadata', "")
    book = data.get('book', "")
    chapter = data.get('chapter', -1)
    verse = data.get('verse', "")

    try:
        active_db = get_database(db_name)
        reference = f'{book} {chapter}:{verse}'
        active_db.upsert(text=text, reference=reference, book=book, chapter=str(chapter), verse=str(verse), uri=uri, metadata=metadata)
        return jsonify("Data has been upserted"), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upsert_all", methods=['GET'])
def upsert_all():
    """Upsert all data into the specified database."""
    db_name = request.args.get('db_name', default='.codex')
    active_db = get_database(db_name)
    if active_db.tokenizer:
        active_db.tokenizer.upsert_all()
        return jsonify("success"), 200
    else:
        return jsonify("No Active Database"), 500


@app.route('/search', methods=['GET'])
def search():
    """Search the specified database for a query."""
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
        active_db = get_database(db_name)
        results = active_db.search(query_decoded, limit)
        return jsonify(results), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 500


@app.route('/searchboth', methods=["GET"])
def search_both():
    """Search both .codex and .bible databases for a query."""
    query = request.args.get('query')
    limit = request.args.get('limit', default=5, type=int)

    try:
        codex_db = get_database('.codex')
        first = codex_db.search(query=query, limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to decode query parameter: {str(e)}"}), 400
    try:
        bible_db = get_database('.bible')
        second = bible_db.search(query=query, limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to decode query parameter: {str(e)}"}), 400
    
    result = jsonify({'target': first, 'source': second})
    return result, 200


@app.route("/get_most_similar", methods=["GET"])
def get_most_similar():
    """Get words most similar to the given word from the specified database."""
    word = request.args.get('word')
    if not word:
        return jsonify({"error": "Missing 'word' parameter"}), 400

    try:
        db_name = request.args.get('db_name', default='.codex')
        active_db = get_database(db_name)
        if not active_db.use_fasttext:
            return jsonify({"error": "FastText is not enabled for this database"}), 400

        similar_words = active_db.get_similar_words(word)
        return jsonify(similar_words), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/save', methods=['POST'])
def save():
    """Save the state of the specified database."""
    data = request.json
    db_name = data.get('db_name')
    if not db_name:
        return jsonify({"error": "Missing 'db_name' parameter"}), 400
    try:
        active_db = get_database(db_name)
        active_db.save()
        return jsonify({"message": f"Database '{db_name}' state saved"}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 404


@app.route("/get_tokens", methods=["GET"])
def get_tokens():
    """Get the number of tokens for each database with a tokenizer."""
    all_tokens = []
    for db_name in initializers.keys():
        active_db = get_database(db_name)
        if active_db.has_tokenizer:
            all_tokens.append(len(active_db.tokenizer.tokenizer.tokens))
    return jsonify({"tokens": all_tokens}), 200

@app.route('/detect_anomalies', methods=['GET'])
def detect_anomalies():
    """Detect anomalies between .codex and .bible databases."""
    query = request.args.get('query', default='', type=str)
    query_decoded = url_parse.unquote(query)
    limit = request.args.get('limit', default=5, type=int)
    detailed_anomalies = []

    try:
        codex_db = get_database('.codex')
        codex_results = codex_db.search(query=query_decoded, limit=limit)
        if not codex_results:
            return jsonify({"error": "No results found in .codex database"}), 404

        bible_db = get_database('.bible')
        bible_results = []
        for codex_result in codex_results:
            try:
                bible_id = f"{codex_result['id'].replace('.codex', '.bible')}"
                bible_query_result = bible_db.get_text(bible_id)
                if bible_query_result:
                    bible_results.extend(bible_db.search(query=bible_query_result[0]['text'], limit=limit))


            except Exception as e:
                print(f"Failed to search in .bible database for id {bible_id}: {str(e)}")
                continue

        if codex_results and bible_results:
            codex_set = set((item['book'], item['chapter'], item['verse']) for item in codex_results)
            bible_set = set((item['book'], item['chapter'], item['verse']) for item in bible_results)

            for verse in codex_set.difference(bible_set):
                reference = f"{verse[0]} {verse[1]}:{verse[2]}".strip()
                detailed_anomalies.append({"reference": reference, "reason": "Extra Verse"})

            for verse in bible_set.difference(codex_set):
                reference = f"{verse[0]} {verse[1]}:{verse[2]}".strip()
                detailed_anomalies.append({"reference": reference, "reason": "Missing Verse"})

        combined_results = {
            'codex_results': codex_results,
            'bible_results': bible_results,
            'detailed_anomalies': detailed_anomalies
        }

        return jsonify(combined_results), 200

    except Exception as e:
        return jsonify({"error": f"Failed to search databases: {str(e)}"}), 500


@app.route("/get_text")
def get_text_frm():
    """Retrieve text from the specified database based on book, chapter, and verse."""
    db_name = request.args.get('db_name')
    book = request.args.get('book')
    chapter = request.args.get('chapter')
    verse = request.args.get('verse')
    active_db = get_database(db_name)
    return active_db.get_text_from(book, chapter, verse)


@app.route('/heartbeat', methods=['GET'])
def heartbeat():
    """Check if the server is running and list available databases."""
    database_names_string = ', '.join(initializers.keys())
    if not WORKSPACE_PATH:
        database_names_string = ""

    return jsonify({"message": "Server is running", "databases": f'{database_names_string}'}), 200


app.run(port=5554, debug=True)