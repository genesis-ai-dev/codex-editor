import React from "react";
import { DataTypes } from "../utils";
import TextCell from "./TextCell";
import NumberCell from "./NumberCell";
import SelectCell from "./SelectCell";
import CheckboxCell from "./CheckboxCell";
import { CellData } from "../tableTypes";

export default function Cell({
    value: initialValue,
    row: { index },
    column: { id, dataType, options },
    dataDispatch,
}: CellData) {
    function getCellElement() {
        switch (dataType) {
            case DataTypes.TEXT:
                return (
                    <TextCell
                        initialValue={initialValue}
                        rowIndex={index}
                        columnId={id}
                        dataDispatch={dataDispatch}
                    />
                );
            case DataTypes.NUMBER:
                return (
                    <NumberCell
                        initialValue={initialValue}
                        rowIndex={index}
                        columnId={id}
                        dataDispatch={dataDispatch}
                    />
                );
            case DataTypes.SELECT:
                return (
                    <SelectCell
                        initialValue={initialValue}
                        options={options}
                        rowIndex={index}
                        columnId={id}
                        dataDispatch={dataDispatch}
                    />
                );
            case DataTypes.CHECKBOX:
                return (
                    <CheckboxCell
                        initialValue={initialValue}
                        rowIndex={index}
                        columnId={id}
                        dataDispatch={dataDispatch}
                    />
                );
            default:
                return <span></span>;
        }
    }

    return getCellElement();
}
