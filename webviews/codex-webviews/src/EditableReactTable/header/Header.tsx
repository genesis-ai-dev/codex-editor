import React, { useState, useEffect } from "react";
import { usePopper } from "react-popper";
import { Constants } from "../utils";
import AddColumnHeader from "./AddColumnHeader";
import DataTypeIcon from "./DataTypeIcon";
import HeaderMenu from "./HeaderMenu";
import { DataTypes } from "../utils"; //Unsure about importing this

interface DataAction {
    type: string; // More specific action types as string literals
    payload?: any; // Be as specific as possible with the payload
}

interface Column {
    id: string | number;
    created?: boolean;
    label: string;
    dataType: string; // You might want to use a specific union type or enum if you have a finite set of data types
    getResizerProps: () => any; // Specify the correct return type if possible
    getHeaderProps: () => any; // Specify the correct return type if possible
}

interface HeaderProps {
    column: Column;
    setSortBy: (criteria: any) => void; // Specify the correct parameter type based on your sorting logic
    dataDispatch: React.Dispatch<DataAction>;
}

export default function Header({
    column: { id, created, label, dataType, getResizerProps, getHeaderProps },
    setSortBy,
    dataDispatch,
}: HeaderProps) {
    const [showHeaderMenu, setShowHeaderMenu] = useState<boolean>(created || false);
    const [headerMenuAnchorRef, setHeaderMenuAnchorRef] = useState<HTMLDivElement | null>(null);
    const [headerMenuPopperRef, setHeaderMenuPopperRef] = useState<HTMLDivElement | null>(null);
    const headerMenuPopper = usePopper(headerMenuAnchorRef, headerMenuPopperRef, {
        placement: "bottom",
        strategy: "absolute",
    });

    /* when the column is newly created, set it to open */
    useEffect(() => {
        if (created) {
            setShowHeaderMenu(true);
        }
    }, [created]);

    function getHeader() {
        if (id === Constants.ADD_COLUMN_ID) {
            return <AddColumnHeader dataDispatch={dataDispatch} getHeaderProps={getHeaderProps} />;
        } else if (id === Constants.CHECKBOX_COLUMN_ID) {
            // Handle the checkbox column header specifically
            // For example, return a simple header without the add column functionality
            return (
                <div {...getHeaderProps()} className="th noselect d-inline-block">
                    <div className="th-content">{label}</div>
                </div>
            );
        }

        return (
            <>
                <div {...getHeaderProps()} className="th noselect d-inline-block">
                    <div
                        className="th-content"
                        onClick={() => setShowHeaderMenu(true)}
                        ref={setHeaderMenuAnchorRef}
                    >
                        <span className="svg-icon svg-gray icon-margin">
                            <DataTypeIcon
                                dataType={DataTypes[dataType as keyof typeof DataTypes]}
                            />
                        </span>
                        {label}
                    </div>
                    <div {...getResizerProps()} className="resizer" />
                </div>
                {showHeaderMenu && (
                    <div className="overlay" onClick={() => setShowHeaderMenu(false)} />
                )}
                {showHeaderMenu && (
                    <HeaderMenu
                        label={label}
                        dataType={dataType}
                        popper={headerMenuPopper}
                        popperRef={setHeaderMenuPopperRef}
                        dataDispatch={dataDispatch}
                        setSortBy={setSortBy}
                        columnId={id.toString()}
                        setShowHeaderMenu={setShowHeaderMenu}
                    />
                )}
            </>
        );
    }

    return getHeader();
}
