import { vscode } from './utilities/vscode';
import React, { useEffect, useReducer } from 'react';
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

function reducer(state: any, action: any) {
  console.log({ action });
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
      return {
        ...state,
        data: action.data,
        columns: action.columns,
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
  const [state, dispatch] = useReducer(reducer, {
    columns: [],
    data: [],
    skipReset: false,
  });

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
      });
      console.log('Data changed and sent back');
    }
  }, [state.data, state.columns, state.dictionary]);

  useEffect(() => {
    //once was function, not const
    // function handleReceiveMessage(event: any) {
    const handleReceiveMessage = (event: MessageEvent) => {
      console.log('Received event:');
      console.log({ event });
      const message = event.data; // The JSON data our extension sent
      switch (message.command) {
        case 'sendData': {
          // const dictionary = JSON.parse(message.data);
          const dictionary: Dictionary = message.data;
          console.log('Dictionary before transformation:');
          console.log({ dictionary });
          const tableData = transformToTableData(dictionary);
          dispatch({
            type: ActionTypes.LOAD_DATA,
            data: tableData.data,
            columns: tableData.columns,
            dictionary: dictionary,
          });
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
    });
  };
  const deleteOptionShouldShow = !state.data.some(
    (row: any) => row[Constants.CHECKBOX_COLUMN_ID]
  );
  return (
    <div
      className="overflow-hidden"
      style={{
        width: '100vw',
        height: '100vh',
        padding: 10,

        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ marginBottom: 40, marginTop: 40 }}>
        <h1>Dictionary</h1>
      </div>

      <div className="app-container">
        <div className="table-container">
          {deleteOptionShouldShow && (
            <button
              onClick={removeCheckedRows}
              // disabled={!state.data.some((row: any) => row[Constants.CHECKBOX_COLUMN_ID])}
              className="remove-button" // Add a class for styling
              title="Remove selected rows" // Tooltip for the button
            >
              <Trash />
            </button>
          )}
          <Table
            columns={state.columns}
            data={state.data}
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
