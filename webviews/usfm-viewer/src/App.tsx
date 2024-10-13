import Scribex from "./components/Scribex";
import { ScribexContextProvider } from "./context/ScribexContext";
import { ReferenceContextProvider } from "./context/ReferenceContext";

import "./App.css";

export default function App() {
    return (
        <div className="App">
            <ScribexContextProvider>
                <ReferenceContextProvider>
                    <Scribex />
                </ReferenceContextProvider>
            </ScribexContextProvider>
        </div>
    );
}
