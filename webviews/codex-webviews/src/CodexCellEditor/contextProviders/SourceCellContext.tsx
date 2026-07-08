import React from "react";
import type { SourceCellMap } from "../../../../types";

interface SourceCellContextProps {
    sourceCellMap: SourceCellMap;
    setSourceCellMap: React.Dispatch<React.SetStateAction<SourceCellMap>>;
}

const SourceCellContext = React.createContext<SourceCellContextProps>({
    sourceCellMap: {},
    setSourceCellMap: () => {},
});

export default SourceCellContext;
