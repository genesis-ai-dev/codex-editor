import React, { CSSProperties, useMemo } from 'react';
import clsx from 'clsx';
import {
  useTable,
  useBlockLayout,
  useResizeColumns,
  useSortBy,
  TableOptions,
} from 'react-table';
import Cell from './cells/Cell';
import Header from './header/Header';
import PlusIcon from './img/Plus';
import { ActionTypes } from './utils';
import { FixedSizeList } from 'react-window';
import scrollbarWidth from './scrollbarWidth';
interface CustomTableOptions<T extends object> extends TableOptions<T> {
  dataDispatch?: React.Dispatch<any>; // Adjust the type according to your dispatch function
}
const defaultColumn: TableColumn = {
  minWidth: 50,
  width: 150,
  maxWidth: 400,
  Cell: Cell,
  Header: Header,
  sortType: 'alphanumericFalsyLast',
};

export default function Table({
  columns,
  data,
  dispatch: dataDispatch,
  skipReset,
}: TableData) {
  // export const Table: React.FC<TableData> = ({ columns, data, dispatch: dataDispatch, skipReset }) => {

  const sortTypes = useMemo(
    () => ({
      alphanumericFalsyLast(
        rowA: any,
        rowB: any,
        columnId: string,
        desc?: boolean
      ) {
        if (!rowA.values[columnId] && !rowB.values[columnId]) {
          return 0;
        }

        if (!rowA.values[columnId]) {
          return desc ? -1 : 1;
        }

        if (!rowB.values[columnId]) {
          return desc ? 1 : -1;
        }

        return isNaN(rowA.values[columnId])
          ? rowA.values[columnId].localeCompare(rowB.values[columnId])
          : rowA.values[columnId] - rowB.values[columnId];
      },
    }),
    []
  );

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    rows,
    prepareRow,
    totalColumnsWidth,
  } = useTable<TableEntry>(
    {
      columns,
      data,
      defaultColumn,
      dataDispatch, // Now correctly recognized as part of the configuration
      autoResetSortBy: !skipReset,
      autoResetFilters: !skipReset,
      autoResetRowState: !skipReset,
      sortTypes,
    } as CustomTableOptions<TableEntry>, // Cast to your custom interface
    useBlockLayout,
    useResizeColumns,
    useSortBy
  );
  const RenderRow = React.useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const row = rows[index];
      prepareRow(row);
      return (
        <div {...row.getRowProps({ style })} className="tr">
          {row.cells.map((cell: any, cellIndex: number) => (
            <div {...cell.getCellProps()} key={cellIndex} className="td">
              {cell.render('Cell')}
            </div>
          ))}
        </div>
      );
    },
    [prepareRow, rows]
  );

  // function isTableResizing(): boolean {
  //   for (let headerGroup of headerGroups) {
  //     for (let column of headerGroup.headers) {
  //       if (column.isResizing) {
  //         return true;
  //       }
  //     }
  //   }

  //   return false;
  // }

  const Rows: React.FC = () => (
    <div>
      {rows.map((row, index: number) =>
        RenderRow({ index, style: row.getRowProps().style as CSSProperties })
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: '100vw', overflow: 'auto' }}>
      <div {...getTableProps()} className={'table'}>
        <div>
          {headerGroups.map((headerGroup: any, index: number) => (
            <div
              {...headerGroup.getHeaderGroupProps()}
              key={index}
              className="tr"
            >
              {headerGroup.headers.map((column: any) =>
                column.render('Header', { key: column.id })
              )}
            </div>
          ))}
        </div>
        <div {...getTableBodyProps()}>
          <FixedSizeList
            height={480}
            itemCount={rows.length}
            itemSize={40}
            // width={totalColumnsWidth + scrollbarWidth}
          >
            {RenderRow}
          </FixedSizeList>
          <Rows />
          <div
            className="tr add-row"
            onClick={() =>
              dataDispatch && dataDispatch({ type: ActionTypes.ADD_ROW })
            }
          >
            <span className="svg-icon svg-gray icon-margin">
              <PlusIcon />
            </span>
            New
          </div>
        </div>
      </div>
    </div>
  );
}
