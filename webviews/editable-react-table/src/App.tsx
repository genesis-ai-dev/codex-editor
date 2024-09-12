import { vscode } from './utilities/vscode';
import React, { useEffect, useReducer, useState } from 'react';
import './style.css';
import Table from './Table';
import {
  randomColor,
  shortId,
  transformToTableData,
  transformToDictionaryFormat,
  ActionTypes,
  DataTypes,
  Constants,
} from './utils';
import update from 'immutability-helper';
import { Dictionary } from 'codex-types';
import Trash from './img/Trash';
import { DictionaryPostMessages } from '../../../types';
import { TableColumn, TableData, TableEntry } from './tableTypes';
import debounce from 'lodash/debounce';

function reducer(state: any, action: any) {
  console.log('Reducer action:', action);
  switch (action.type) {
    case ActionTypes.ADD_OPTION_TO_COLUMN:
      const optionIndex = state.columns.findIndex(
        (column: any) => column.id === action.columnId
      );
      return update(state, {
        skipReset: { $set: true },
        columns: {
          [optionIndex]: {
            options: {
              $push: [
                {
                  label: action.option,
                  backgroundColor: action.backgroundColor,
                },
              ],
            },
          },
        },
      });

    case ActionTypes.ADD_ROW:
      const newId = generateUniqueId(state.data);
      console.log('New state after ADD_ROW:', state);
      return update(state, {
        skipReset: { $set: true },
        data: { $push: [{ id: newId }] },
      });

    case ActionTypes.UPDATE_COLUMN_TYPE:
      const typeIndex = state.columns.findIndex(
        (column: any) => column.id === action.columnId
      );
      switch (action.dataType) {
        case DataTypes.NUMBER:
          if (state.columns[typeIndex].dataType === DataTypes.NUMBER) {
            return state;
          } else {
            return update(state, {
              skipReset: { $set: true },
              columns: { [typeIndex]: { dataType: { $set: action.dataType } } },
              data: {
                $apply: (data: any) =>
                  data.map((row: any) => ({
                    ...row,
                    [action.columnId]: isNaN(row[action.columnId])
                      ? ''
                      : Number.parseInt(row[action.columnId]),
                  })),
              },
            });
          }
        case DataTypes.SELECT:
          if (state.columns[typeIndex].dataType === DataTypes.SELECT) {
            return state;
          } else {
            let options: any = [];
            state.data.forEach((row: any) => {
              if (row[action.columnId]) {
                options.push({
                  label: row[action.columnId],
                  backgroundColor: randomColor(),
                });
              }
            });
            return update(state, {
              skipReset: { $set: true },
              columns: {
                [typeIndex]: {
                  dataType: { $set: action.dataType },
                  options: { $push: options },
                },
              },
            });
          }
        case DataTypes.TEXT:
          if (state.columns[typeIndex].dataType === DataTypes.TEXT) {
            return state;
          } else if (state.columns[typeIndex].dataType === DataTypes.SELECT) {
            return update(state, {
              skipReset: { $set: true },
              columns: { [typeIndex]: { dataType: { $set: action.dataType } } },
            });
          } else {
            return update(state, {
              skipReset: { $set: true },
              columns: { [typeIndex]: { dataType: { $set: action.dataType } } },
              data: {
                $apply: (data: any) =>
                  data.map((row: any) => ({
                    ...row,
                    [action.columnId]: row[action.columnId] + '',
                  })),
              },
            });
          }
        default:
          return state;
      }

    case ActionTypes.UPDATE_COLUMN_HEADER:
      const index = state.columns.findIndex(
        (column: any) => column.id === action.columnId
      );
      return update(state, {
        skipReset: { $set: true },
        columns: { [index]: { label: { $set: action.label } } },
      });

    case ActionTypes.UPDATE_CELL:
      return update(state, {
        skipReset: { $set: true },
        data: {
          [action.rowIndex]: { [action.columnId]: { $set: action.value } },
        },
      });

    case ActionTypes.ADD_COLUMN_TO_LEFT:
      const leftIndex = state.columns.findIndex(
        (column: any) => column.id === action.columnId
      );
      let leftId = shortId();
      return update(state, {
        skipReset: { $set: true },
        columns: {
          $splice: [
            [
              leftIndex,
              0,
              {
                id: leftId,
                label: 'Column',
                accessor: leftId,
                dataType: DataTypes.TEXT,
                created: action.focus && true,
                options: [],
              },
            ],
          ],
        },
      });

    case ActionTypes.ADD_COLUMN_TO_RIGHT:
      const rightIndex = state.columns.findIndex(
        (column: any) => column.id === action.columnId
      );
      const rightId = shortId();
      return update(state, {
        skipReset: { $set: true },
        columns: {
          $splice: [
            [
              rightIndex + 1,
              0,
              {
                id: rightId,
                label: 'Column',
                accessor: rightId,
                dataType: DataTypes.TEXT,
                created: action.focus && true,
                options: [],
              },
            ],
          ],
        },
      });

    case ActionTypes.DELETE_COLUMN:
      const deleteIndex = state.columns.findIndex(
        (column: any) => column.id === action.columnId
      );
      return update(state, {
        skipReset: { $set: true },
        columns: { $splice: [[deleteIndex, 1]] },
      });

    case ActionTypes.ENABLE_RESET:
      return update(state, { skipReset: { $set: true } });

    case ActionTypes.LOAD_DATA:
      let columns = action.columns.map((column: TableColumn) => {
        // Set visibility for specific columns
        if (
          column.id &&
          [
            'headWord',
            'definition',
            'translationEquivalents',
            'checkbox_column',
            'notes',
          ].includes(column.id)
        ) {
          return { ...column, visible: true };
        } else {
          return { ...column, visible: false };
        }
      });

      return {
        ...state,
        data: action.data,
        columns: columns,
        // skipReset: false,
        dictionary: action.dictionary,
      };

    case ActionTypes.REMOVE_CHECKED_ROWS:
      return {
        ...state,
        data: state.data.filter(
          (row: any) => !row[Constants.CHECKBOX_COLUMN_ID]
        ),
      };

    case ActionTypes.RESIZE_COLUMN_WIDTHS:
      console.log('Resizing columns to', action.minWidth);
      return {
        ...state,
        columns: state.columns.map((column: any) =>
          column.dataType !== DataTypes.CHECKBOX
            ? { ...column, width: action.minWidth }
            : column
        ),
      };

    default:
      return state;
  }
}

function generateUniqueId(data: any) {
  let newId: string;
  do {
    newId = shortId();
  } while (data.some((row: { id: string }) => row.id === newId));
  return newId;
}

function App() {
  interface AppState {
    columns: TableColumn[];
    data: TableEntry[]; // Assuming data is an array of any objects, specify further if possible
    skipReset: boolean;
    dictionary: Dictionary;
  }
  interface Action {
    type: string;
    data?: TableEntry[]; // Assuming data is an array of any objects, specify further if possible
    columns?: TableColumn[];
    dictionary?: Dictionary;
    minWidth?: number;
  }

  const initialState: AppState = {
    columns: [],
    data: [],
    skipReset: false,
    dictionary: {
      id: '',
      label: '',
      entries: [],
      metadata: {},
    },
  };

  const [state, dispatch] = useReducer<React.Reducer<AppState, Action>>(
    reducer,
    initialState
  );

  const [searchBarWidth, setSearchBarWidth] = useState(window.innerWidth - 20);

  useEffect(() => {
    dispatch({ type: ActionTypes.ENABLE_RESET });
    console.log('Data changed');
  }, [state.data, state.columns]);

  useEffect(() => {
    if (state.data.length > 0 && state.columns.length > 0) {
      const tableData: TableData = { data: state.data, columns: state.columns }; // Adjust according to the actual structure
      const dictionaryData: Dictionary = transformToDictionaryFormat(
        tableData,
        state.dictionary
      );
      vscode.postMessage({
        command: 'updateData',
        data: dictionaryData,
      } as DictionaryPostMessages);
      console.log(
        'Something in data, columns, or dict changed. New count:',
        state.data.length
      );
    }
  }, [state.data, state.columns, state.dictionary]);

  useEffect(() => {
    // Define a debounced version of a function that dispatches a resize action
    const calculateNewMinWidth = (windowWidth: number) => {
      const numColumns = state.columns.filter(column => column.visible).length;
      return (windowWidth - 60) / (numColumns - 1);
    };

    const handleResize = debounce(() => {
      const newMinWidth = calculateNewMinWidth(window.innerWidth);
      dispatch({
        type: ActionTypes.RESIZE_COLUMN_WIDTHS,
        minWidth: newMinWidth,
      });
      setSearchBarWidth(window.innerWidth - 20);
    }, 100);

    // Set initial width for search bar
    setSearchBarWidth(window.innerWidth - 20);

    // Add the event listener when the component mounts
    window.addEventListener('resize', handleResize);

    // Return a cleanup function that removes the event listener when the component unmounts
    return () => {
      handleResize.cancel();
      window.removeEventListener('resize', handleResize);
    };
  }, [dispatch, state.columns.length]); // Only re-run the effect if `dispatch` changes

  useEffect(() => {
    //once was function, not const
    // function handleReceiveMessage(event: any) {
    const handleReceiveMessage = (event: MessageEvent) => {
      console.log('Received event:');
      console.log({ event });
      const message: DictionaryPostMessages = event.data; // The JSON data our extension sent
      switch (message.command) {
        case 'sendData': {
          // const dictionary = JSON.parse(message.data);
          let dictionary: Dictionary = message.data;

          if (!dictionary.entries) {
            dictionary = {
              ...dictionary,
              entries: [],
            };
          }

          console.log('Dictionary before transformation:');
          console.log({ dictionary });
          const tableData = transformToTableData(dictionary);
          dispatch({
            type: ActionTypes.LOAD_DATA,
            data: tableData.data,
            columns: tableData.columns,
            dictionary: dictionary,
          });
          // Trigger window resize event manually to size columns correctly
          window.dispatchEvent(new Event('resize'));
          break;
        }
        case 'removeConfirmed':
          dispatch({ type: ActionTypes.REMOVE_CHECKED_ROWS });
          break;
      }
    };
    window.addEventListener('message', handleReceiveMessage);

    // Make sure to clean up the event listener when the component is unmounted
    return () => {
      window.removeEventListener('message', handleReceiveMessage);
    };
  }, []);

  const removeCheckedRows = () => {
    const checkedRowsCount = state.data.filter(
      (row: any) => row[Constants.CHECKBOX_COLUMN_ID]
    ).length;
    vscode.postMessage({
      command: 'confirmRemove',
      count: checkedRowsCount,
    } as DictionaryPostMessages);
  };
  const deleteOptionShouldShow = state.data.some(
    (row: any) => row[Constants.CHECKBOX_COLUMN_ID]
  );
  // console.log({ state });

  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const filteredData = state.data.filter((row: any) => {
    return Object.values(row).some(
      value =>
        typeof value === 'string' &&
        value.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div
      // className="overflow-hidden"
      style={{
        width: '100%',
        height: '100%',
        padding: 10,

        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 40,
          marginTop: 40,
          minHeight: '60px',
        }}
      >
        <h1>Dictionary</h1>
        {deleteOptionShouldShow && (
          <button
            onClick={removeCheckedRows}
            className="remove-button"
            title="Remove selected rows"
          >
            <Trash />
          </button>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="search-bar"
          style={{ width: searchBarWidth }}
        />
      </div>

      <div className="app-container">
        <div className="table-container">
          <Table
            columns={state.columns.filter(column => column.visible)}
            // data={state.data} 888
            data={filteredData}
            dispatch={dispatch}
            skipReset={state.skipReset}
          />
        </div>
        <div id="popper-portal"></div>
      </div>
    </div>
  );
}

export default App;
