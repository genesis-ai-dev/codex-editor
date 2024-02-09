from flask import Flask, request, jsonify
from tools.embedding_tools import DataBase
from enum import Enum
from typing import Dict

app = Flask(__name__)
databases: Dict[str, DataBase] = {}

class DatabaseName(Enum):
    """Enumeration for database names."""
    DRAFTS = 'database'
    USER_RESOURCES = 'userresources'
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
    work_path = request.args.get("data_path")
    print(work_path)
    for name in DatabaseName:
        print(work_path+'/' + name.value)
        databases[name.value] = DataBase(work_path+'/' + name.value)
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
    if db_name and db_name in databases and path:
        databases[db_name].upsert_codex_file(path, verse_chunk_size)
        return jsonify({"message": "Codex file upserted"}), 200
    else:
        return jsonify({"error": "Database name and path are required"}), 400

@app.route('/search', methods=['GET'])
def search() -> tuple:
    """
    Searches for a query in the specified database.

    Expects 'db_name', 'query', and optionally 'limit' in the request arguments.
    If the required parameters are present, it calls the search method of the DataBase instance.

    Returns:
        A tuple containing a JSON response and an HTTP status code.
    """
    db_name = request.args.get('db_name')
    query = request.args.get('query')
    limit = request.args.get('limit', default=1, type=int)
    if db_name and db_name in databases and query:
        results = databases[db_name].search(query, limit)
        return jsonify(results), 200
    else:
        return jsonify({"error": "Database name and query are required"}), 400

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

if __name__ == "__main__":
    app.run(port=5554, debug=False)

    