import React, { useState } from 'react';
import { ActionTypes } from '../utils';

export default function CheckboxCell({
  initialValue,
  columnId,
  rowIndex,
  dataDispatch,
}) {
  const [checked, setChecked] = useState(initialValue);

  const handleChange = (e) => {
    setChecked(e.target.checked);
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