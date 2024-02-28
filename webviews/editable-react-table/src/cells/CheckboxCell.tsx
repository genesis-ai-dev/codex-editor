import React, { useState } from 'react';
import { ActionTypes } from '../utils';
import { CellTypeData } from '../tableTypes';

export default function CheckboxCell({
  initialValue,
  columnId,
  rowIndex,
  dataDispatch,
}: CellTypeData) {
  const [checked, setChecked] = useState(initialValue);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChecked(e.target.checked);
    if (dataDispatch)
      dataDispatch({
        type: ActionTypes.UPDATE_CELL,
        columnId,
        rowIndex,
        value: e.target.checked,
      });
  };

  return (
    <div className="checkbox-container">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        className="checkbox-large"
      />
    </div>
  );
}
