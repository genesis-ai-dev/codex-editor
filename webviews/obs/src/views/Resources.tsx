import ResourcesTable from "../components/ResourcesTable";
import { renderToPage } from "../utilities/main-vscode";

const Resources = () => {
    return (
        <div>
            <ResourcesTable />
        </div>
    );
};

renderToPage(<Resources />);
