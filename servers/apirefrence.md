# Flask Server for Embedding Database Operations

This Flask server provides a RESTful API for managing and interacting with embedding databases. It supports upserting data and codex files, searching, and saving the current state of databases. The initialization of databases is handled automatically by the language server, so users do not need to manually start the databases.

## Setup

Before running the server, ensure you have Flask installed in your Python environment. You can install Flask using pip:

```bash
pip install -r --break-system-packages requirements.txt
```

The server will automatically start with the extension.

The server will start on port 5554.

Here are the valid databases:
```python
class DatabaseName(Enum):
    """Enumeration for database names."""
    DRAFTS = 'drafts'
    USER_RESOURCES = 'user_resources'
    REFERENCE_MATERIALS = 'reference_materials'
```

## Endpoints

### 1. Upsert Codex File (`/upsert_codex_file`)

- **Method:** POST
- **Description:** Upserts a codex file into the specified embedding database.
- **Payload Parameters:**
  - `db_name` (string): The name of the database.
  - `path` (string): The path to the .codex file.
- **Returns:** A JSON response indicating success or error and an HTTP status code.

### 2. Upsert Data (`/upsert_data`)

- **Method:** POST
- **Description:** Upserts text data into the specified embedding database.
- **Payload Parameters:**
  - `db_name` (string): The name of the database.
  - `text` (string): The text data to upsert.
  - `uri` (string, optional): The URI of the data. Defaults to an empty string.
  - `metadata` (dictionary, optional): Metadata associated with the data. Defaults to an empty dictionary.
  - `book` (string, optional): The book name. Defaults to an empty string.
  - `chapter` (integer, optional): The chapter number. Defaults to -1.
  - `verse` (string, optional): The verse. Defaults to an empty string.
- **Returns:** A JSON response indicating success or error and an HTTP status code.

### 3. Search (`/search`)

- **Method:** GET
- **Description:** Searches for a query in the specified embedding database.
- **Parameters:**
  - `db_name` (string): The name of the database to search in.
  - `query` (string): The search query.
  - `limit` (integer, optional): The maximum number of results to return. Defaults to 5.
  - `min_score` (float, optional): The minimum score of results to return. Defaults to None.
- **Returns:** A JSON response containing the search results or an error message and an HTTP status code.

### 4. Save Database State (`/save`)

- **Method:** POST
- **Description:** Saves the current state of the specified embedding database.
- **Payload Parameters:**
  - `db_name` (string): The name of the database to save.
- **Returns:** A JSON response indicating success or error and an HTTP status code.

## Usage

To use the API, send HTTP requests to the endpoints described above. For POST requests, include a JSON payload. For example, to upsert data:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"db_name": "drafts", "text": "Sample text"}' "http://localhost:5554/upsert_data"
```

## Note

Ensure that the `DataBase` class and its methods (`upsert_codex_file`, `upsert_data`, `simple_search`, `save`) are correctly implemented in the `tools.embedding2` module as these are crucial for the server's functionality.