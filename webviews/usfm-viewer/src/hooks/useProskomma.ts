import { Proskomma } from "proskomma-core";
export const usfm2perf = (usfm: string) => {
  let perf, docSetId, id;

  try {
    const pk = new Proskomma();
    pk.importDocument(
      { lang: "xxx", abbr: "XXX" }, // doesn't matter...
      "usfm",
      usfm
    );
    const perfResultDocument = pk.gqlQuerySync(
      "{documents {id docSetId perf} }"
    ).data.documents[0];
    perf = JSON.parse(perfResultDocument.perf);
    id = perfResultDocument.id;
    docSetId = perfResultDocument.docSetId;
  } catch (e) {
    console.log(e);
    perf = null;
  }
  return { perf, docSetId, id };
};
