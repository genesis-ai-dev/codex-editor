import * as vscode from 'vscode';
import MiniSearch from 'minisearch';

// Define the structure of your TSV records
interface TSVRecord {
  id: string;
  field1: string;
  field2: string;
  // Add more fields as needed based on your TSV structure
}

export async function createTSVIndex(): Promise<MiniSearch<TSVRecord>> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    throw new Error('No workspace folder found');
  }
  const workspaceUri = workspaceFolders[0].uri;

  // Find all TSV files in the project
  const tsvFiles = await vscode.workspace.findFiles('**/*.tsv');

  // Initialize MiniSearch
  const tsvIndex = new MiniSearch<TSVRecord>({
    fields: ['field1', 'field2'], // Fields to index for full-text search
    storeFields: ['id', 'field1', 'field2'], // Fields to return with search results
    idField: 'id', // Unique identifier for each record
  });

  // Read and index each TSV file
  for (const uri of tsvFiles) {
    const records = await parseTSVFile(uri);
    tsvIndex.addAll(records);
  }

  return tsvIndex;
}

// Function to read and parse a TSV file
async function parseTSVFile(uri: vscode.Uri): Promise<TSVRecord[]> {
  const document = await vscode.workspace.openTextDocument(uri);
  const content = document.getText();

  const records: TSVRecord[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim() === '') continue; // Skip empty lines

    const fields = line.split('\t');
    if (fields.length < 2) continue; // Adjust based on your TSV structure

    const record: TSVRecord = {
      id: generateUniqueId(uri.fsPath, fields), // Generate a unique ID
      field1: fields[0].trim(),
      field2: fields[1].trim(),
      // Map additional fields as needed
    };

    records.push(record);
  }

  return records;
}

// Function to generate a unique ID for each record
function generateUniqueId(filePath: string, fields: string[]): string {
  // You can use a combination of file path and field values
  return `${filePath}:${fields[0]}`;
}

// Example usage
(async () => {
  try {
    const tsvIndex = await createTSVIndex();

    // Now you can perform searches on the index
    const results = tsvIndex.search('search query');
    console.log('Search results:', results);
  } catch (error) {
    console.error('Error creating TSV index:', error);
  }
})();