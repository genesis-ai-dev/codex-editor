# API Reference for Flask Server

This document serves as a reference for the API endpoints provided by the Flask server defined in `servers/flask_server.py`. The server offers a set of endpoints to interact with different databases through a web interface.

## Endpoints

### 1. Initialize Databases

- **Endpoint**: `/start`
- **Method**: [GET]
- **Description**: Initializes the databases required for the application by reading the work path from the request arguments and creating DataBase instances.
- **Query Parameters**:
  - [data_path]: The path where the databases are located.
- **Responses**:
  - **200 OK**: Returns a message indicating successful initialization of databases.
  - **Example**:
    ```json
    "Databases initialized successfully"
    ```

### 2. Upsert Codex File

- **Endpoint**: `/upsert_codex_file`
- **Method**: `POST`
- **Description**: Inserts or updates a codex file into the specified database.
- **JSON Payload**:
  - `db_name` (required): The name of the database to upsert the codex file into.
  - `path` (required): The file path of the codex file.
  - `verse_chunk_size` (optional): The size of the verse chunks, defaults to 4 if not provided.
- **Responses**:
  - **200 OK**: Returns a message indicating the codex file was upserted successfully.
  - **400 Bad Request**: Returns an error if the database name or path is not provided.
  - **Example**:
    ```json
    {"message": "Codex file upserted"}
    ```

### 3. Search

- **Endpoint**: `/search`
- **Method**: `GET` (subject to Change (this is the one part of the docs I wrote haha))
- **Description**: Searches for a query in the specified database.
- **Query Parameters**:
  - `db_name` (required): The name of the database to perform the search in.
  - `query` (required): The search query.
  - `limit` (optional): The maximum number of results to return, defaults to 1 if not provided.
- **Responses**:
  - **200 OK**: Returns the search results.
  - **400 Bad Request**: Returns an error if the database name or query is not provided.
  - **Example**:
    ```json
    [{"result": "Search result here"}]
    ```

### 4. Save Database State

- **Endpoint**: `/save`
- **Method**: `POST`
- **Description**: Saves the current state of the specified database.
- **JSON Payload**:
  - `db_name` (required): The name of the database to save the state of.
- **Responses**:
  - **200 OK**: Returns a message indicating the database state was saved successfully.
  - **400 Bad Request**: Returns an error if the database name is not provided.
  - **Example**:
    ```json
    {"message": "Database 'database_name' state saved"}
    ```

## Running the Server

To start the server, ensure you are in the directory containing `flask_server.py` and execute the following command:

```sh
python flask_server.py
```

The server will start on port `5554` unless modified in the code.

## Notes

- All endpoints return a JSON response along with the appropriate HTTP status code.
- The server expects the `DataBase` class to be defined in `tools/embedding_tools` with the necessary methods (`upsert_codex_file`, `search`, and `save`) implemented.
- The `DatabaseName` enum is used to define the names of the databases that can be interacted with through the API.