import React from "react";

interface SourceCellContextProps {
    sourceCellMap: { [k: string]: { content: string; versions: string[] } };
    setSourceCellMap: React.Dispatch<
        React.SetStateAction<{ [k: string]: { content: string; versions: string[] } }>
    >;
}

const SourceCellContext = React.createContext<SourceCellContextProps>({
    sourceCellMap: {},
    setSourceCellMap: () => {},
});

export default SourceCellContext;
