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

@app.route('/start', methods=['GET'])
def initialize_databases():
    global WORKSPACE_PATH
    work_path = request.args.get("data_path", default="")
    if not work_path:
        return jsonify({"error": "Missing 'data_path' argument"}), 400
    WORKSPACE_PATH = work_path.replace('file://', '')
    return jsonify({"Databases initialized successfully": WORKSPACE_PATH}), 200


def get_database(db_name: str) -> Database:
    if db_name not in DATABASES:
        use_tokenizer, use_fasttext = initializers[db_name]
        db_path = f"{WORKSPACE_PATH}/nlp/embeddings/{db_name}"
        DATABASES[db_name] = Database(db_path=db_path, database_name=db_name, has_tokenizer=use_tokenizer, use_fasttext=use_fasttext)
    return DATABASES[db_name]


@app.route('/upsert_codex_file', methods=['POST'])
def upsert_codex_file():
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
    db_name = request.args.get("db_name", default=".codex")
    active_db = get_database(db_name)
    active_db.train_fasttext()
    return jsonify("Ok"), 200


@app.route('/upsert_bible_file', methods=['POST'])
def upsert_bible_file():
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
    codex_files = glob.glob(f'{WORKSPACE_PATH}/**/*.codex', recursive=True)
    active_db = get_database('.codex')

    for file_path in codex_files:
        active_db.upsert_file(file_path)
    active_db.tokenizer.upsert_all()
    active_db.upsert_queue()
    active_db.save()
    return jsonify({"message": f"Upserted {len(codex_files)} .codex files {codex_files} from {codex_files}"}), 200


@app.route('/upsert_all_resource_files', methods=['GET'])
def upsert_all_resource_files():
    try:
        resource_files = glob.glob(f'{WORKSPACE_PATH}/resources/*', recursive=True)
        active_db = get_database('resources')

        for file_path in resource_files:
            active_db.upsert_file(file_path)
        active_db.upsert_queue()
        active_db.save()


        return jsonify({"message": f"Upserted {len(resource_files)} resource files"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/upsert_all_bible_files', methods=['GET'])
def upsert_all_bible_files():
    bible_files = glob.glob(f'{WORKSPACE_PATH}/**/*.bible', recursive=True)
    
    active_db = get_database('.bible')

    for file_path in bible_files:
        active_db.upsert_file(file_path)
    active_db.upsert_queue()
    active_db.tokenizer.upsert_all()
    active_db.save()

    return jsonify({"message": f"Upserted {len(bible_files)} .bible files {bible_files} from {WORKSPACE_PATH}"}), 200
    # except Exception as e:
    #     return jsonify({"error": str(e)}), 500


@app.route('/upsert_data', methods=['POST'])
def upsert_data():
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
    db_name = request.args.get('db_name', default='.codex')
    active_db = get_database(db_name)
    if active_db.tokenizer:
        active_db.tokenizer.upsert_all()
        return jsonify("success"), 200
    else:
        return jsonify("No Active Database"), 500


@app.route('/search', methods=['GET'])
def search():
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
    all_tokens = []
    for db_name in initializers.keys():
        active_db = get_database(db_name)
        if active_db.has_tokenizer:
            all_tokens.append(len(active_db.tokenizer.tokenizer.tokens))
    return jsonify({"tokens": all_tokens}), 200


@app.route('/detect_anomalies', methods=['GET'])
def detect_anomalies():
    query = request.args.get('query', default='', type=str)
    limit = request.args.get('limit', default=5, type=int)

    try:
        codex_db = get_database('.codex')
        codex_results = codex_db.search(query=query, limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to search in .codex database: {str(e)}"}), 400
    try:
        bible_query = codex_results[0]
        bible_query_formatted = f"{bible_query['book']} {bible_query['chapter']}:{bible_query['verse']}"
        bible_db = get_database('.bible')
        bible_query_result = bible_db.get_text_from(book=bible_query['book'], chapter=bible_query['chapter'], verse=bible_query['verse'])
        bible_results = bible_db.search(query=bible_query_result[0]['text'], limit=limit)
    except Exception as e:
        return jsonify({"error": f"Failed to search in .bible database: {str(e)}"}), 400

    codex_set = set((item['book'], item['chapter'], item['verse']) for item in codex_results)
    bible_set = set((item['book'], item['chapter'], item['verse']) for item in bible_results)

    detailed_anomalies = []
    for verse in codex_set.symmetric_difference(bible_set):
        reference = f"{verse[0]} {verse[1]}:{verse[2]}".strip()
        codex_exists = codex_db.exists([reference])
        bible_exists = bible_db.exists([reference])

        if bible_set.issuperset({verse}) and codex_exists:
            detailed_anomalies.append({"reference": reference, "reason": "Missing Verses"})
        elif codex_set.issuperset({verse}) and not bible_exists:
            detailed_anomalies.append({"reference": reference, "reason": "Extra Verses"})

    combined_results = {
        'codex_results': codex_results,
        'bible_results': bible_results,
        'detailed_anomalies': detailed_anomalies
    }

    return jsonify(combined_results), 200


@app.route("/get_text")
def get_text_frm():
    db_name = request.args.get('db_name')
    book = request.args.get('book')
    chapter = request.args.get('chapter')
    verse = request.args.get('verse')
    active_db = get_database(db_name)
    return active_db.get_text_from(book, chapter, verse)


@app.route('/heartbeat', methods=['GET'])
def heartbeat():
    database_names_string = ', '.join(initializers.keys())
    if not WORKSPACE_PATH:
        database_names_string = ""

    return jsonify({"message": "Server is running", "databases": f'{database_names_string}'}), 200


app.run(port=5554, debug=True)