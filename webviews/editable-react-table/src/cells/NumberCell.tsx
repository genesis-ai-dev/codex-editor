import React, { useEffect, useState } from 'react';
import ContentEditable from 'react-contenteditable';
import { ActionTypes } from '../utils';

export default function NumberCell({
  initialValue,
  columnId,
  rowIndex,
  dataDispatch,
}: CellTypeData) {
  const [value, setValue] = useState<ValueState>({ value: initialValue, update: false });

  const onChange = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setValue({ value: target.innerText, update: false });
  }

  const onBlur = () => {
    setValue(old => ({ ...old, update: true }));
  }

  useEffect(() => {
    setValue({ value: initialValue, update: false });
  }, [initialValue]);

  useEffect(() => {
    if (value.update) {
      dataDispatch({
        type: ActionTypes.UPDATE_CELL,
        columnId,
        rowIndex,
        value: value.value,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.update, columnId, rowIndex]);

  return (
    <ContentEditable
      html={(value.value && value.value.toString()) || ''}
      onChange={onChange}
      onBlur={onBlur}
      className="data-input text-align-right"
    />
  );
}
