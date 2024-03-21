/* eslint-disable no-unused-vars */
import { useState, useTransition } from 'react';
import {
  useDeepCompareCallback,
  useDeepCompareEffect,
  useDeepCompareMemo,
} from 'use-deep-compare';
import isEqual from 'lodash.isequal';
import EpiteleteHtml from 'epitelete-html';
import { saveToFile } from './saveToFile';

export default function usePerf({
  proskomma,
  ready,
  docSetId,
  bookCode,
  htmlMap,
  refName,
}) {
  const [isSaving, startSaving] = useTransition();
  const [htmlPerf, setHtmlPerf] = useState();
  const [usfmText, setUsfmText] = useState();

  const epiteleteHtml = useDeepCompareMemo(
    () => ready
      && new EpiteleteHtml({
        proskomma,
        docSetId,
        htmlMap,
        options: { historySize: 100 },
      }),
    [proskomma, ready, docSetId, refName],
  );

  useDeepCompareEffect(() => {
    if (epiteleteHtml) {
      epiteleteHtml.readHtml(bookCode, { cloning: false }, htmlMap).then((_htmlPerf) => {
        // remove htmlMap for default classes
        setHtmlPerf(_htmlPerf);
      });
    }
  }, [epiteleteHtml, bookCode]);

  // exports perf to usfm and writes to file.
  const exportUsfm = async (bookCode) => {
    const usfmString = await epiteleteHtml?.readUsfm(bookCode);
    setUsfmText(usfmString);
    saveToFile(usfmString, bookCode);
    epiteleteHtml?.readHtml(bookCode, { cloning: false }, htmlMap).then((_htmlPerf) => { // remove htmlMap for default classes
      setHtmlPerf(_htmlPerf);
    });
  };

  const saveHtmlPerf = useDeepCompareCallback(
    (_htmlPerf, { sequenceId }) => {
      if (!isEqual(htmlPerf, _htmlPerf)) { setHtmlPerf(_htmlPerf); }

      startSaving(async () => {
        const newHtmlPerf = await epiteleteHtml?.writeHtml(
          bookCode,
          sequenceId,
          _htmlPerf,
          { insertSequences: true },
        );
        if (!isEqual(htmlPerf, newHtmlPerf)) { setHtmlPerf(newHtmlPerf); }
        exportUsfm(bookCode);
      });
    },
    [htmlPerf, bookCode],
  );

  const insertNewGraft = useDeepCompareCallback(
    (_htmlPerf, { sequenceId }) => {
      if (!isEqual(htmlPerf, _htmlPerf)) { setHtmlPerf(_htmlPerf); }

      startSaving(async () => {
        const newHtmlPerf = await epiteleteHtml?.writeHtml(
          bookCode,
          sequenceId,
          _htmlPerf,
          { insertSequences: true },
        );

        if (!isEqual(htmlPerf, newHtmlPerf)) { setHtmlPerf(newHtmlPerf); }
        exportUsfm(bookCode);
      });
    },
    [htmlPerf, bookCode],
  );

  const undo = async () => {
    const newPerfHtml = await epiteleteHtml?.undoHtml(bookCode);
    setHtmlPerf(newPerfHtml);
  };

  const redo = async () => {
    const newPerfHtml = await epiteleteHtml?.redoHtml(bookCode);
    setHtmlPerf(newPerfHtml);
  };

  const canUndo = (epiteleteHtml?.canUndo && epiteleteHtml?.canUndo(bookCode)) || false;
  const canRedo = (epiteleteHtml?.canRedo && epiteleteHtml?.canRedo(bookCode)) || false;

  const state = {
    bookCode,
    htmlPerf,
    canUndo,
    canRedo,
    isSaving,
    usfmText,
  };

  const actions = {
    insertNewGraft,
    saveHtmlPerf,
    exportUsfm,
    undo,
    redo,
  };

  return { state, actions };
}
