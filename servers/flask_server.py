from flask import Flask, request, jsonify
from tools.embedding2 import DataBase  # Updated import path
from enum import Enum
from typing import Dict
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins='*')  # Allow requests from any origin
databases: Dict[str, DataBase] = {}

class DatabaseName(Enum):
    """Enumeration for database names."""
    DRAFTS = 'drafts'
    USER_RESOURCES = 'user_resources'
    REFERENCE_MATERIALS = 'reference_materials'

@app.route("/start", methods=['GET'])
def initialize_databases() -> tuple:
    """
    Initializes the databases required for the application.

    Reads the work path from the request arguments, iterates over the DatabaseName enum to create
    and store DataBase instances in the global databases dictionary.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    work_path = request.args.get("data_path").replace('file://', '')
    print(work_path)
    for name in DatabaseName:
        print(work_path+'/' + name.value)
        databases[name.value] = DataBase(work_path+'/embeddings/' + name.value)
    return jsonify("Databases initialized successfully"), 200

@app.route('/upsert_codex_file', methods=['POST'])
def upsert_codex_file() -> tuple:
    """
    Upserts a codex file into the specified database.

    Expects 'db_name', 'path', and optionally 'verse_chunk_size' in the JSON payload of the request.
    If the required parameters are present, it calls the upsert_codex_file method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    data = request.json
    db_name = data.get('db_name')
    path = data.get('path')
    verse_chunk_size = data.get('verse_chunk_size', 4)
    if db_name in databases.keys() and path:
        databases[db_name].upsert_codex_file(path, verse_chunk_size)
        return jsonify({"message": "Codex file upserted"}), 200
    else:
        return jsonify({"error": "Database name and path are required"}), 400

@app.route('/upsert_data', methods=['POST'])
def upsert_data() -> tuple:
    """
    Upserts text data into the specified database.

    Expects 'db_name', 'text', 'uri', and optionally 'metadata', 'book', 'chapter', 'verse' in the JSON payload of the request.
    If the required parameters are present, it calls the upsert_data method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
        
    Example:
        {
            "db_name": "drafts",
            "text": "This is a test.",
            "uri": "test.md",
            "metadata": {"author": "John Doe"},
            "book": "Genesis",
            "chapter": 1,
            "verse": "1"
        }
    """
    data = request.json
    db_name = data.get('db_name')
    text = data.get('text')
    uri = data.get('uri', defualt="", type=str)
    metadata = data.get('metadata', {})
    book = data.get('book', "")
    chapter = data.get('chapter', -1)
    verse = data.get('verse', "")
    if db_name and db_name in databases.keys() and text:
        databases[db_name].upsert_data(text, uri, metadata, book, chapter, verse)
        return jsonify({"message": "Data upserted into database"}), 200
    else:
        return jsonify({"error": "Database name, text, are required"}), 400

@app.route('/search', methods=['GET'])
def search() -> tuple:
    """
    Searches for a query in the specified database.

    Expects 'db_name', 'query', and optionally 'limit', 'min_score' in the request arguments.
    If the required parameters are present, it calls the simple_search method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    db_name = request.args.get('db_name')
    query = request.args.get('query')
    limit = request.args.get('limit', default=5, type=int)
    min_score = request.args.get('min_score', default=None, type=float)
    print(databases)
    if db_name in databases.keys() and query:
        results = databases[db_name].simple_search(query, limit, min_score)
        return jsonify(results), 200
    else:
        database_names_string = ', '.join(databases.keys())
        return jsonify({"error": "Database name and query are required", "databases": f'{database_names_string}'}), 400

@app.route('/save', methods=['POST'])
def save() -> tuple:
    """
    Saves the current state of the specified database.

    Expects 'db_name' in the JSON payload of the request.
    If the required parameter is present, it calls the save method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    db_name = request.json.get('db_name')
    if db_name and db_name in databases:
        databases[db_name].save()
        return jsonify({"message": f"Database '{db_name}' state saved"}), 200
    else:
        return jsonify({"error": "Database name is required"}), 400

@app.route('/heartbeat', methods=['GET'])
def heartbeat() -> tuple:
    """
    Returns a simple JSON response to indicate that the server is running.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    database_names_string = ', '.join(databases.keys())
    return jsonify({"message": "Server is running", "databases": f'{database_names_string}'}), 200

if __name__ == "__main__":
    app.run(port=5554, debug=False)
