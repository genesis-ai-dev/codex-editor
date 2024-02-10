import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopper } from 'react-popper';
import Badge from '../Badge';
import { grey } from '../colors';
import PlusIcon from '../img/Plus';
import { ActionTypes, randomColor } from '../utils';

export default function SelectCell({
  initialValue,
  options,
  columnId,
  rowIndex,
  dataDispatch,
}: CellTypeData) {
  const [selectRef, setSelectRef] = useState<HTMLDivElement | null>(null);
  const [selectPop, setSelectPop] = useState<HTMLDivElement | null>(null);
  const [showSelect, setShowSelect] = useState<boolean>(false);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [addSelectRef, setAddSelectRef] = useState<HTMLInputElement | null>(null);
  const { styles, attributes } = usePopper(selectRef, selectPop, {
    placement: 'bottom-start',
    strategy: 'fixed',
  });
  const [value, setValue] = useState({ value: initialValue, update: false });

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
  }, [value, columnId, rowIndex]);

  useEffect(() => {
    if (addSelectRef && showAdd) {
      addSelectRef.focus();
    }
  }, [addSelectRef, showAdd]);

  function getColor() {
    let match = options?.find(option => option.label === value.value);
    return (match?.backgroundColor) ?? grey(200);
  }

  function handleAddOption() {
    setShowAdd(true);
  }

  function handleOptionKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const target = e.target as HTMLInputElement;
      if (target.value !== '') {
        dataDispatch({
          type: ActionTypes.ADD_OPTION_TO_COLUMN,
          option: target.value,
          backgroundColor: randomColor(),
          columnId,
        });
      }
      setShowAdd(false);
    }
  }

  function handleOptionBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (e.target.value !== '') {
      dataDispatch({
        type: ActionTypes.ADD_OPTION_TO_COLUMN,
        option: e.target.value,
        backgroundColor: randomColor(),
        columnId,
      });
    }
    setShowAdd(false);
  }

  function handleOptionClick(option: any) {
    setValue({ value: option.label, update: true });
    setShowSelect(false);
  }

  useEffect(() => {
    if (addSelectRef && showAdd) {
      addSelectRef.focus();
    }
  }, [addSelectRef, showAdd]);

  return (
    <>
      <div
        ref={setSelectRef}
        className="cell-padding d-flex cursor-default align-items-center flex-1"
        onClick={() => setShowSelect(true)}
      >
        {value.value && (
          <Badge value={value.value} backgroundColor={getColor()} />
        )}
      </div>
      {showSelect && (
        <div className="overlay" onClick={() => setShowSelect(false)} />
      )}
      {showSelect &&
        createPortal(
          <div
            className="shadow-5 bg-white border-radius-md"
            ref={setSelectPop}
            {...attributes.popper}
            style={{
              ...styles.popper,
              zIndex: 4,
              minWidth: 200,
              maxWidth: 320,
              maxHeight: 400,
              padding: '0.75rem',
              overflow: 'auto',
            }}
          >
            <div
              className="d-flex flex-wrap-wrap"
              style={{ marginTop: '-0.5rem' }}
            >
              {options?.map(option => (
                <div
                  className="cursor-pointer mr-5 mt-5"
                  onClick={() => handleOptionClick(option)}
                >
                  <Badge
                    value={option.label}
                    backgroundColor={option.backgroundColor}
                  />
                </div>
              ))}
              {showAdd && (
                <div
                  className="mr-5 mt-5 bg-grey-200 border-radius-sm"
                  style={{
                    width: 120,
                    padding: '2px 4px',
                  }}
                >
                  <input
                    type="text"
                    className="option-input"
                    onBlur={handleOptionBlur}
                    ref={setAddSelectRef}
                    onKeyDown={handleOptionKeyDown}
                  />
                </div>
              )}
              <div
                className="cursor-pointer mr-5 mt-5"
                onClick={handleAddOption}
              >
                <Badge
                  value={
                    <span className="svg-icon-sm svg-text">
                      <PlusIcon />
                    </span>
                  }
                  backgroundColor={grey(200)}
                />
              </div>
            </div>
          </div>,
          document.querySelector('#popper-portal') as Element
        )}
    </>
  );
}
