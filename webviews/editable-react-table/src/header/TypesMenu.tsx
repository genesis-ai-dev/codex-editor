import React from 'react';
import { 
  ActionTypes, 
  DataTypes, 
  shortId 
} from '../utils';
import DataTypeIcon from './DataTypeIcon';
import { DataAction } from '../tableTypes';

interface TypesMenuProps {
  popper: any
  popperRef: React.Ref<HTMLDivElement>;
  dataDispatch: React.Dispatch<DataAction>;
  setShowTypeMenu: (show: boolean) => void;
  onClose: () => void;
  columnId: string;
}

interface TypeOption {
  type: DataTypes;
  onClick: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  icon: JSX.Element;
  label: string;
}

function getLabel(type: DataTypes): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export default function TypesMenu({
  popper,
  popperRef,
  dataDispatch,
  setShowTypeMenu,
  onClose,
  columnId,
}: TypesMenuProps) {
  const types: TypeOption[] = [
    {
      type: DataTypes.SELECT,
      onClick: () => {
        dataDispatch({
          type: ActionTypes.UPDATE_COLUMN_TYPE,
          columnId,
          dataType: DataTypes.SELECT,
        });
        onClose();
      },
      icon: <DataTypeIcon dataType={DataTypes.SELECT} />,
      label: getLabel(DataTypes.SELECT),
    },
    {
      type: DataTypes.TEXT,
      onClick: () => {
        dataDispatch({
          type: ActionTypes.UPDATE_COLUMN_TYPE,
          columnId,
          dataType: DataTypes.TEXT,
        });
        onClose();
      },
      icon: <DataTypeIcon dataType={DataTypes.TEXT} />,
      label: getLabel(DataTypes.TEXT),
    },
    {
      type: DataTypes.NUMBER,
      onClick: () => {
        dataDispatch({
          type: ActionTypes.UPDATE_COLUMN_TYPE,
          columnId,
          dataType: DataTypes.NUMBER,
        });
        onClose();
      },
      icon: <DataTypeIcon dataType={DataTypes.NUMBER} />,
      label: getLabel(DataTypes.NUMBER),
    },
  ];

  return (
    <div
      className="shadow-5 bg-white border-radius-md list-padding"
      ref={popperRef}
      onMouseEnter={() => setShowTypeMenu(true)}
      onMouseLeave={() => setShowTypeMenu(false)}
      {...popper.attributes.popper}
      style={{
        ...popper.styles.popper,
        width: 200,
        backgroundColor: 'white',
        zIndex: 4,
      }}
    >
      {types.map(type => (
        <button className="sort-button" onClick={type.onClick} key={shortId()}>
          <span className="svg-icon svg-text icon-margin">{type.icon}</span>
          {type.label}
        </button>
      ))}
    </div>
  );
}
