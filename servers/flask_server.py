from typing import cast
import sys
import glob
import os 
import shutil
import logging
from typing import TextIO
from flask_cors import CORS
from tools.embedding import Database
from experiments.lad import LAD
from time import sleep
from urllib import parse as url_parse
from flask import Flask, request, jsonify
from typing import Dict, Any

app = Flask(__name__)
CORS(app, origins='*')  # Allow requests from any origin

initializers = {
    ".codex": (True, True),
    ".bible": (True, True),
    "resources": (False, False),
    "reference_material": (False, False)
}

DATABASES: Dict[str, Any] = {}
WORKSPACE_PATH: str = ""

AnomalyDetector: LAD = None

def require_workspace(func):
    def wrapper(*args, **kwargs):
        if WORKSPACE_PATH == "" or WORKSPACE_PATH == None:
            return jsonify({"error": "Workspace path not defined. Please initialize the databases first."}), 400
        return func(*args, **kwargs)
    return wrapper

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
    return str(sys.executable) + "<br>"+'<br>'.join(debug_handler.records)

@app.route('/start', methods=['GET'])
def initialize_databases():
    """Initialize databases with the provided workspace path."""
    global WORKSPACE_PATH, AnomalyDetector
    work_path = request.args.get("data_path", default="")
    print(work_path)
    if "codex-editor " in work_path:
        return jsonify("Ignoring request")
    if not work_path:
        return jsonify({"error": "Missing 'data_path' argument"}), 400
    WORKSPACE_PATH = work_path.replace('file://', '')
    if not AnomalyDetector:
        AnomalyDetector = LAD(codex=get_database(".codex"), bible=get_database(".bible"))
    return jsonify({"Databases initialized successfully": WORKSPACE_PATH}), 200


def get_database(db_name: str) -> Database:
    """Retrieve or create a database instance by name."""
    global DATABASES
    if WORKSPACE_PATH == "":
        raise NameError
    if db_name not in DATABASES:
        use_tokenizer, use_fasttext = initializers[db_name]
        db_path = f"{WORKSPACE_PATH}/.project/nlp"
        unified_db_path = f"{db_path}"
        if not os.path.exists(unified_db_path):
            shutil.rmtree(unified_db_path, ignore_errors=True)
        DATABASES[db_name] = Database(db_path=db_path, database_name=db_name, has_tokenizer=use_tokenizer, use_fasttext=use_fasttext)
    return DATABASES[db_name]

@require_workspace
@app.route("/line_lad")
def lad():
    query = request.args.get("query")
    return jsonify({"score": AnomalyDetector.search_and_score(query)}), 200


@require_workspace
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


@require_workspace
@app.route("/train_gensim_model", methods=['GET'])
def train_gensim_model():
    """Train a Gensim model on the specified database."""
    db_name = request.args.get("db_name", default=".codex")
    active_db = get_database(db_name)
    active_db.train_fasttext()
    return jsonify("Ok"), 200


@require_workspace
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


@require_workspace
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


@require_workspace
@app.route('/upsert_all_resource_files', methods=['GET'])
def upsert_all_resource_files():
    """Upsert all resource files from the workspace path into the database."""
    try:
        resource_files = glob.glob(f'{WORKSPACE_PATH}/.project/resources/*.*', recursive=True)
        active_db = get_database("resources")

        for file_path in resource_files:
            active_db.upsert_file(file_path)
        active_db.upsert_queue()
        active_db.save()


        return jsonify({"message": f"Upserted {len(resource_files)} resource files"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@require_workspace
@app.route('/upsert_all_bible_files', methods=['GET'])
def upsert_all_bible_files():
    """Upsert all .bible files from the workspace path into the database."""
    path = WORKSPACE_PATH.replace("/drafts/","")
    bible_files = glob.glob(f'{path}/**/*.bible', recursive=True)
    
    active_db = get_database('.bible')

    for file_path in bible_files:
        active_db.upsert_file(file_path)
    active_db.upsert_queue()
    active_db.tokenizer.upsert_all()
    active_db.save()

    return jsonify({"message": f"Upserted {len(bible_files)} .bible files {bible_files} from {WORKSPACE_PATH}"}), 200


@require_workspace
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


@require_workspace
@app.route("/upsert_all", methods=['GET'])
def upsert_all():
    """Upsert all data into the specified database."""
    db_name = request.args.get('db_name', default='.codex')
    print(f"Upserting all data into {db_name} database")
    active_db = get_database(db_name)
    if active_db.tokenizer:
        active_db.tokenizer.upsert_all()
        return jsonify("success"), 200
    else:
        return jsonify("No Active Database"), 500


@require_workspace
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


@require_workspace
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


@require_workspace
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
        similar_words_dicts = [{"word": word, "score": score} for word, score in similar_words[1:]]
        return jsonify(similar_words_dicts), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@require_workspace
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


@require_workspace
@app.route("/get_tokens", methods=["GET"])
def get_tokens():
    """Get the number of tokens for each database with a tokenizer."""
    all_tokens = []
    for db_name in initializers.keys():
        active_db = get_database(db_name)
        if active_db.has_tokenizer:
            all_tokens.append(len(active_db.tokenizer.tokenizer.tokens))
    return jsonify({"tokens": all_tokens}), 200



@require_workspace
@app.route("/get_text")
def get_text_frm():
    """Retrieve text from the specified database based on book, chapter, and verse."""
    db_name = request.args.get('db_name')
    book = request.args.get('book')
    chapter = request.args.get('chapter')
    verse = request.args.get('verse')
    active_db = get_database(db_name)
    return active_db.get_text_from(book, chapter, verse)


@require_workspace
@app.route("/detect_anomalies")
def detect_anomalies():
    query = request.args.get("query", "")
    limit = request.args.get("limit", "")
    database = get_database(".codex")
    source_database = get_database(".bible")
    codex_results = database.search(query=query, limit=limit)
    try:
        id = codex_results[0]['id']
        source_query = source_database.get_text(id.replace(".codex", ".bible"))[0]
        source_results = source_database.search(source_query, limit=limit)

        source_ids = [item['id'].replace(".bible", "") for item in source_results]
        codex_ids = [item['id'].replace(".codex", "") for item in codex_results]

        # Find codex IDs that are not in the source IDs
        missing_in_source = [codex_id for codex_id in codex_ids if codex_id not in source_ids]
        missing_in_codex = [source_id for source_id in source_ids if source_id not in codex_ids and database.exists([source_id])]
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

        return jsonify({
            "bible_results": source_results,
            "codex_results": codex_results,
            "detailed_anomalies": anomalies
        }), 200
    except IndexError:
        return jsonify({
            "bible_results":  source_database.search(query=query, limit=limit),
            "codex_results": database.search(query=query, limit=limit),
            "anomalies": [{"reason": ".codex results returned none", "reference": "N/A"}]
        })

@require_workspace
@app.route("/add_debug")
def add_debug():
    text = request.args.get("text", "")
    print(text)
    return jsonify("success"), 200

@require_workspace
@app.route('/heartbeat', methods=['GET'])
def heartbeat():
    """Check if the server is running, list available databases, and provide a sample query for each."""
    databases_info = []
    for db_name in initializers.keys():
        sample_query_result = None
        try:
            db = get_database(db_name)
            sample_query_result = db.search("Genesis 1:1", limit=1)
        except Exception as e:
            sample_query_result = f"Failed to execute sample query: {str(e)}"
        databases_info.append({"name": db_name, "sample_query": sample_query_result})

    if not WORKSPACE_PATH:
        databases_info = []

    return jsonify({"message": "Server is running", "databases_info": databases_info}), 200

# FIXME: increment port number if it's already in use
app.run(port=5554, debug=True) 