import React, { CSSProperties, useMemo } from "react";
import { useTable, useFlexLayout, useResizeColumns, useSortBy, TableOptions } from "react-table";
import Cell from "./cells/Cell";
import Header from "./header/Header";
import PlusIcon from "./img/Plus";
import { ActionTypes } from "./utils";
import { TableColumn, TableData, TableEntry } from "./tableTypes";
interface CustomTableOptions<T extends object> extends TableOptions<T> {
    dataDispatch?: React.Dispatch<any>;
}
const defaultColumn: TableColumn = {
    minWidth: 50,
    width: 150,
    maxWidth: 400,
    Cell: Cell,
    Header: Header,
    sortType: "alphanumericFalsyLast",
};

export default function Table({ columns, data, dispatch: dataDispatch, skipReset }: TableData) {
    const sortTypes = useMemo(
        () => ({
            alphanumericFalsyLast(rowA: any, rowB: any, columnId: string, desc?: boolean) {
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

    const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow, totalColumnsWidth } =
        useTable<TableEntry>(
            {
                columns,
                data,
                defaultColumn,
                dataDispatch,
                autoResetSortBy: !skipReset,
                autoResetFilters: !skipReset,
                autoResetRowState: !skipReset,
                sortTypes,
            } as CustomTableOptions<TableEntry>,
            useFlexLayout /*Block 888*/,
            useResizeColumns,
            useSortBy
        );

    const RenderRow = React.useCallback(
        ({ index, style }: { index: number; style: React.CSSProperties }) => {
            const row = rows[index];
            prepareRow(row);
            return (
                <div {...row?.getRowProps?.({ style })} className="tr">
                    {row.cells.map((cell: any, cellIndex: number) => (
                        <div
                            {...cell.getCellProps()}
                            key={cellIndex}
                            className="td"
                            style={{ width: `${cell.column.width}px` }}
                        >
                            {cell.render("Cell")}
                        </div>
                    ))}
                </div>
            );
        },
        [prepareRow, rows]
    );

    const Rows: React.FC = () => (
        <div>
            {rows.map((row, index: number) => {
                return RenderRow({
                    index,
                    style: row?.getRowProps?.().style as CSSProperties,
                });
            })}
        </div>
    );

    return (
        <div style={{ maxWidth: "100vw", overflow: "auto" }}>
            <div
                // {...getTableProps()}
                className={"table-header"}
            >
                <div>
                    {headerGroups.map((headerGroup: any, index: number) => (
                        <div {...headerGroup.getHeaderGroupProps()} key={index} className="tr">
                            {headerGroup.headers.map((column: any, columnIndex: number) => (
                                <div {...column.getHeaderProps()} key={columnIndex} className="th">
                                    {column.render("Header")}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
            <div
                // {...getTableProps()}
                className={"table"}
            >
                <div>
                    <div {...getTableBodyProps()}>
                        <Rows />
                    </div>
                </div>

                <div
                    className="tr add-row"
                    onClick={() => dataDispatch && dataDispatch({ type: ActionTypes.ADD_ROW })}
                    style={{
                        marginTop: 30,
                        width: "fit-content",
                        minWidth: "90px",
                    }}
                >
                    <span className="svg-icon svg-gray icon-margin">
                        <PlusIcon />
                    </span>
                    New
                </div>
            </div>
        </div>
    );
}
