export function shortId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

export function randomColor() {
  return `hsl(${Math.floor(Math.random() * 360)}, 95%, 90%)`;
}


export function transformToTableData(dictionary) {
  // const data = dictionary.entries;
  const data = dictionary.entries.map(entry => ({
    ...entry,
    metadata: typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata) // Only stringify if not already a string
  }));

  let columns = [];
  let checkboxColumn = {
    // id: Constants.ADD_COLUMN_ID,
    id: Constants.CHECKBOX_COLUMN_ID,
    label: ' ',
    accessor: 'checkbox_column',
    minWidth: 20,
    // disableResizing: true,
    dataType: DataTypes.CHECKBOX,
  };

  // Create columns in required format and according to the first entry in the data
  if (data.length > 0) {
    const firstEntry = data[0];
    columns = Object.keys(firstEntry).map(key => ({
      id: key,
      label: key.charAt(0).toUpperCase() + key.slice(1), // Capitalize the first letter
      accessor: key,
      minWidth: 100,
      dataType: DataTypes.TEXT, // Default to TEXT, adjust based on your needs
      options: []
    }));
    // Add the scroll column
    columns.push(checkboxColumn);
  }

  return { columns, data, skipReset: false };
}

export function transformToDictionaryFormat(tableData, dictionary) {
  // Place row entries back into the dictionary
  // dictionary.entries = tableData.data;
  // Modify here to remove checkbox data from tableData.data
  dictionary.entries = tableData.data.map(row => {
    const newRow = { ...row };
    delete newRow[Constants.CHECKBOX_COLUMN_ID]; // Assuming this is the key for checkbox data
    return newRow;
  });
  return dictionary;
}

export const ActionTypes = Object.freeze({
  ADD_OPTION_TO_COLUMN: 'add_option_to_column',
  ADD_ROW: 'add_row',
  UPDATE_COLUMN_TYPE: 'update_column_type',
  UPDATE_COLUMN_HEADER: 'update_column_header',
  UPDATE_CELL: 'update_cell',
  ADD_COLUMN_TO_LEFT: 'add_column_to_left',
  ADD_COLUMN_TO_RIGHT: 'add_column_to_right',
  DELETE_COLUMN: 'delete_column',
  ENABLE_RESET: 'enable_reset',
  LOAD_DATA: 'loaddata',
  REMOVE_CHECKED_ROWS: 'remove_checked_rows',
});

export const DataTypes = Object.freeze({
  NUMBER: 'number',
  TEXT: 'text',
  SELECT: 'select',
  CHECKBOX: 'checkbox',
});

export const Constants = Object.freeze({
  ADD_COLUMN_ID: 999999,
  CHECKBOX_COLUMN_ID: 'checkbox_column',
});
