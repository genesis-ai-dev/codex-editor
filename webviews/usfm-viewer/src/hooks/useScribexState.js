import { useContext } from "react";
import { useProskomma, useImport, useCatalog } from "proskomma-react-hooks";
import { useDeepCompareEffect } from "use-deep-compare";

import usePerf from "./usePerf";
// import useScribexReducer from "./useScribexReducer";
import htmlMap from "../data/htmlmap";
import { ScribexContext } from '@/context/ScribexContext';

const _documents = [
  // {
  //   selectors: { org: 'bcs', lang: 'hi', abbr: 'irv' },
  //   bookCode: 'tit',
  //   url: '/bcs-hi_irv.tit.usfm',
  // },
  {
    selectors: { org: "unfoldingWord", lang: "en", abbr: "ult" },
    bookCode: "psa",
    url: "/unfoldingWord-en_ult.psa-short.usfm",
  },
];

export default function useScribexState() {
  const { state, actions } = useContext(ScribexContext);
  const { verbose } = state;

  const { proskomma, stateId, newStateId } = useProskomma({ verbose });
  const { done } = useImport({
    proskomma,
    stateId,
    newStateId,
    documents: _documents,
  });

  const { catalog } = useCatalog({ proskomma, stateId });

  const { id: docSetId, documents } = (done && catalog.docSets[0]) || {};
  const { bookCode } = (documents && documents[0]) || {};
  const {h:bookName} = (documents && documents[0]) || {};
  const ready = (docSetId && bookCode) || false;
  const isLoading = !done || !ready;

  const { state: perfState, actions: perfActions } = usePerf({
    proskomma,
    ready,
    docSetId,
    bookCode,
    verbose,
    htmlMap, //uncomment if pasing custom classes.
    // proskomma, ready, docSetId, bookCode, verbose
  });
  const { htmlPerf } = perfState;
  

  useDeepCompareEffect(() => {
    if (htmlPerf && htmlPerf.mainSequenceId !== state.sequenceIds[0]) {
      actions.setSequenceIds([htmlPerf?.mainSequenceId]);
    }
  }, [htmlPerf, state.sequenceIds]);

  return {
    state: { ...state, ...perfState, isLoading ,bookName},
    actions: { ...actions, ...perfActions },
  };
}
