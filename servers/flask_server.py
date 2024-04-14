from typing import TextIO, cast
import sys
import os 
import shutil
import logging
import argparse
from flask_cors import CORS
from flask import Flask, request, jsonify

from tools.json_database import JsonDatabase
from experiments.lad import LAD


parser = argparse.ArgumentParser(description='Flask server for anomaly detection.')
parser.add_argument('--workspace_path', type=str, required=True,
                     help='The workspace directory path.')
args = parser.parse_args()


WORKSPACE_PATH: str = args.workspace_path
DATABASE: JsonDatabase = JsonDatabase()

DATABASE.create_database(bible_dir=WORKSPACE_PATH, codex_dir=WORKSPACE_PATH, save_all_path=WORKSPACE_PATH+"/.project/")
AnomalyDetector: LAD = LAD(codex=DATABASE, bible=DATABASE, n_samples=10)


app = Flask(__name__)
CORS(app, origins='*')  # Allow requests from any origin

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



@app.route("/line_lad")
def lad():
    query = request.args.get("query")
    return jsonify({"score": AnomalyDetector.search_and_score(query)}), 200



# @app.route("/train_gensim_model", methods=['GET'])
# def train_gensim_model():
#     """Train a Gensim model on the specified database."""
#     db_name = request.args.get("db_name", default=".codex")
#     active_db = get_database(db_name)
#     active_db.train_fasttext()
#     return jsonify("Ok"), 200






@app.route('/search', methods=['GET'])
def search():
    """Search the specified database for a query."""
    db_name = request.args.get('db_name')
    db_name = "source" if db_name == ".codex" else "target"
    query = request.args.get('query')
    limit = request.args.get("limit", default=10)
    results = DATABASE.search(query, text_type=db_name, top_n=int(limit))
    return jsonify(results), 200



@app.route("/get_most_similar", methods=["GET"])
def get_most_similar():
    """Get words most similar to the given word from the specified database."""
    return jsonify([])

@app.route("/get_rarity")
def get_rarity():
    db_name = request.args.get("db_name")
    text = request.args.get("text")
    result = DATABASE.word_rarity(text=text, text_type=db_name)
    return jsonify(result)

@app.route("/get_text")
def get_text_frm():
    """Retrieve text from the specified database based on book, chapter, and verse."""
    ref = request.args.get("ref")
    db_name = request.args.get("db_name")
    results = DATABASE.get_text(ref=ref, text_type=db_name)
    return jsonify(results)


@app.route("/add_debug")
def add_debug():
    text = request.args.get("text", "")
    print(text)
    return jsonify("success"), 200

@app.route("/detect_anomalies")
def detect_anomalies():
    query = request.args.get("query", "")
    limit = int(request.args.get("limit", 10))
    
    codex_results = DATABASE.search(query_text=query, text_type="target", top_n=limit)
    try:
        ref = codex_results[0]['ref']
        source_query = DATABASE.get_text(ref=ref, text_type="source")
        source_results = DATABASE.search(query_text=source_query, text_type="source", top_n=limit)

        source_ids = [item['ref'] for item in source_results]
        codex_ids = [item['ref'] for item in codex_results]

        # Find codex IDs that are not in the source IDs
        missing_in_source = [codex_id for codex_id in codex_ids if codex_id not in source_ids]
        missing_in_codex = [source_id for source_id in source_ids if source_id not in codex_ids and DATABASE.get_text(source_id, text_type="source")]
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
            "bible_results":  DATABASE.search(query_text=query, text_type="source", top_n=limit),
            "codex_results": DATABASE.search(query_text=query, text_type="target", top_n=limit),
            "anomalies": [{"reason": ".codex results returned none", "reference": "N/A"}]
        })# add stuff here

@app.route('/heartbeat', methods=['GET'])
def heartbeat():
    """Check if the server is running, list available databases, and provide a sample query for each."""
    return jsonify({"message": "Server is running", "databases_info": "nothing much"}), 200

app.run(port=5554, debug=True)
