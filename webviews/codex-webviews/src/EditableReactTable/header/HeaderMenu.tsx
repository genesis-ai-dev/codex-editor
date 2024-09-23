import React, { useEffect, useState } from "react";
import ArrowUpIcon from "../img/ArrowUp";
import ArrowDownIcon from "../img/ArrowDown";
// import ArrowLeftIcon from '../img/ArrowLeft';
// import ArrowRightIcon from '../img/ArrowRight';
// import TrashIcon from '../img/Trash';
import { grey } from "../colors";
// import TypesMenu from './TypesMenu';
// import { usePopper } from 'react-popper';
import { ActionTypes, shortId } from "../utils";
import { DataAction } from "../tableTypes";
// import DataTypeIcon from './DataTypeIcon';

interface HeaderMenuProps {
    label: string;
    dataType: string; // Assuming dataType is used elsewhere, include it here for completeness
    columnId: string;
    setSortBy: (sortBy: { id: string; desc: boolean }[]) => void;
    popper: any;
    popperRef: React.Ref<HTMLDivElement>;
    dataDispatch: React.Dispatch<DataAction>;
    setShowHeaderMenu: (show: boolean) => void;
}

export default function HeaderMenu({
    label,
    dataType,
    columnId,
    setSortBy,
    popper,
    popperRef,
    dataDispatch,
    setShowHeaderMenu,
}: HeaderMenuProps) {
    // const [inputRef] = useState(null);

    const [header, setHeader] = useState(label);

    useEffect(() => {
        setHeader(label);
    }, [label]);

    // useEffect(() => {
    //   if (inputRef) {
    //     inputRef.focus();
    //     inputRef.select();
    //   }
    // }, [inputRef]);

    const buttons = [
        {
            onClick: () => {
                dataDispatch({
                    type: ActionTypes.UPDATE_COLUMN_HEADER,
                    columnId,
                    label: header,
                });
                setSortBy([{ id: columnId, desc: false }]);
                setShowHeaderMenu(false);
            },
            icon: <ArrowUpIcon />,
            label: "Sort ascending",
        },
        {
            onClick: () => {
                dataDispatch({
                    type: ActionTypes.UPDATE_COLUMN_HEADER,
                    columnId,
                    label: header,
                });
                setSortBy([{ id: columnId, desc: true }]);
                setShowHeaderMenu(false);
            },
            icon: <ArrowDownIcon />,
            label: "Sort descending",
        },
    ];

    return (
        <div
            ref={popperRef}
            style={{ ...popper.styles.popper, zIndex: 3 }}
            {...popper.attributes.popper}
        >
            <div
                className="bg-white shadow-5 border-radius-md"
                style={{
                    width: 240,
                }}
            >
                <div
                    style={{
                        paddingTop: "0.75rem",
                        paddingLeft: "0.75rem",
                        paddingRight: "0.75rem",
                    }}
                ></div>
                <div style={{ borderTop: `2px solid ${grey(200)}` }} />
                <div className="list-padding">
                    {buttons.map((button) => (
                        <button
                            type="button"
                            className="sort-button"
                            onMouseDown={button.onClick}
                            key={shortId()}
                        >
                            <span className="svg-icon svg-text icon-margin">{button.icon}</span>
                            {button.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
