import { ActionTypes } from "./utils";

type TableColumn = {
    id?:
        | "headWord"
        | "id"
        | "hash"
        | "definition"
        | "translationEquivalents"
        | "links"
        | "linkedEntries"
        | "metadata"
        | "notes"
        | "extra"
        | "checkbox_column";
    label?: string;
    accessor?: string;
    minWidth?: number;
    width?: number;
    maxWidth?: number;
    dataType?: string; // Could be more specific if there are only certain values allowed
    options?: any[]; // Define this more specifically if possible
    Cell?: any;
    Header?: any;
    sortType?: string;
    visible?: boolean;
};
// type DictionaryTableColumn = TableColumn & {
//   id:
//     | 'headWord'
//     | 'id'
//     | 'hash'
//     | 'definition'
//     | 'translationEquivalents'
//     | 'links'
//     | 'linkedEntries'
//     | 'metadata'
//     | 'notes'
//     | 'extra'
//     | 'checkbox_column';
// };

type TableEntry = {
    metadata: string | Record<string, any>; // Assuming metadata can be string or object
    dataDispatch?: React.Dispatch<any> | undefined;
    [key: string]: any; // For additional properties
};

type TableData = {
    columns: TableColumn[];
    data: TableEntry[];
    dispatch?: React.Dispatch<any>;
    skipReset?: boolean;
};

type CellData = {
    value: any;
    row: RowData;
    column: ColumnData;
    dataDispatch: React.Dispatch<any>;
};

type CellTypeData = {
    initialValue: any;
    options?: { label: string; backgroundColor: string }[]; // For SelectCell
    rowIndex: number;
    columnId: string;
    dataDispatch?: React.Dispatch<DataAction>;
    // dataDispatch: React.Dispatch<any>;
};

interface DataAction {
    type: ActionTypes;
    columnId: string;
    label?: string;
    rowIndex?: number;
    value?: any;
    dataType?: any;
    option?: any;
    backgroundColor?: string;
}

// enum DataTypes {
//   NUMBER = 'number',
//   TEXT = 'text',
//   SELECT = 'select',
//   CHECKBOX = 'checkbox',
// };

type RowData = {
    index: number;
};

type ColumnData = {
    id: string;
    dataType: string;
    options: any[];
};

type ValueState = {
    value: any;
    update: boolean;
};

// declare module 'react-table' {
//   export const useTable: any;
//   export const useBlockLayout: any;
//   export const useResizeColumns: any;
//   export const useSortBy: any;
//   // Add other exports as needed
// }

// declare module 'react-window' {
//   export const FixedSizeList: any;
// }
