import React, { useEffect, useState, useCallback, useRef } from "react";
import { Table, Input, Button, Popconfirm, Tooltip, ConfigProvider, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { vscode } from "./utilities/vscode";
import {
    DictionaryPostMessages,
    DictionaryReceiveMessages,
    Dictionary,
    DictionaryEntry,
} from "../../../../types";
import { useMeasure } from "@uidotdev/usehooks";
import AddWordForm from "./AddWordForm";
import EditWordForm from "./EditWordForm";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

interface DataType {
    key: React.Key;
    [key: string]: any;
}

const App: React.FC = () => {
    const [outerContainer, { height: outerContainerHeight }] = useMeasure();
    const [tableRef, { height: tableHeight }] = useMeasure();
    const [inputRef, { height: inputHeight }] = useMeasure();
    const [buttonRef, { height: buttonHeight }] = useMeasure();
    const [addWordVisible, setAddWordVisible] = useState(false);
    const [entryToEdit, setEntryToEdit] = useState<DictionaryEntry | null>(null);

    const [dataSource, setDataSource] = useState<DataType[]>([]);
    const [columnNames, setColumnNames] = useState<string[]>([]);
    const [dictionary, setDictionary] = useState<Dictionary>({
        id: "",
        label: "",
        entries: [],
        metadata: {},
    });
    const [searchQuery, setSearchQuery] = useState("");
    const [vsCodeTheme, setVsCodeTheme] = useState({});
    const [pagination, setPagination] = useState({
        current: 1,
        pageSize: 10,
        total: 0,
    });

    const dataSourceRef = useRef(dataSource);
    const dictionaryRef = useRef(dictionary);
    const lastSentDataRef = useRef<Dictionary | null>(null);

    useEffect(() => {
        dataSourceRef.current = dataSource;
    }, [dataSource]);

    useEffect(() => {
        dictionaryRef.current = dictionary;
    }, [dictionary]);

    useEffect(() => {
        // Get the VS Code theme variables
        const style = getComputedStyle(document.documentElement);
        const themeColors = {
            colorPrimary: style.getPropertyValue("--vscode-button-background").trim(),
            colorPrimaryHover: style.getPropertyValue("--vscode-button-hoverBackground").trim(),
            colorPrimaryActive: style.getPropertyValue("--vscode-button-background").trim(),
            colorBgContainer: style.getPropertyValue("--vscode-editor-background").trim(),
            colorBgElevated: style.getPropertyValue("--vscode-editor-background").trim(),
            colorText: style.getPropertyValue("--vscode-editor-foreground").trim(),
            colorTextSecondary: style.getPropertyValue("--vscode-descriptionForeground").trim(),
            colorTextTertiary: style.getPropertyValue("--vscode-disabledForeground").trim(),
            colorTextQuaternary: style.getPropertyValue("--vscode-disabledForeground").trim(),
            colorBorder: style.getPropertyValue("--vscode-input-border").trim(),
            colorBorderSecondary: style.getPropertyValue("--vscode-input-border").trim(),
            colorFill: style.getPropertyValue("--vscode-input-background").trim(),
            colorFillSecondary: style.getPropertyValue("--vscode-input-background").trim(),
            colorFillTertiary: style.getPropertyValue("--vscode-input-background").trim(),
            colorFillQuaternary: style.getPropertyValue("--vscode-input-background").trim(),
            colorBgLayout: style.getPropertyValue("--vscode-editor-background").trim(),
            colorWarning: style.getPropertyValue("--vscode-inputValidation-warningBorder").trim(),
            colorError: style.getPropertyValue("--vscode-inputValidation-errorBorder").trim(),
            colorInfo: style.getPropertyValue("--vscode-inputValidation-infoBorder").trim(),
            colorSuccess: style.getPropertyValue("--vscode-inputValidation-infoBorder").trim(),
            colorLink: style.getPropertyValue("--vscode-textLink-foreground").trim(),
            colorLinkHover: style.getPropertyValue("--vscode-textLink-activeForeground").trim(),
            colorLinkActive: style.getPropertyValue("--vscode-textLink-activeForeground").trim(),
            // Table styles
            colorTableBackground: style.getPropertyValue("--vscode-editor-background").trim(),
            colorTableHeaderBackground: style.getPropertyValue("--vscode-editor-background").trim(),
            colorTableHeaderText: style.getPropertyValue("--vscode-editor-foreground").trim(),
            colorTableCellBackground: style.getPropertyValue("--vscode-editor-background").trim(),
            colorTableCellText: style.getPropertyValue("--vscode-editor-foreground").trim(),
            colorTableFixedCellBackground: style
                .getPropertyValue("--vscode-editor-background")
                .trim(),
        };
        setVsCodeTheme(themeColors);
    }, []);

    const handleDelete = useCallback((key: React.Key) => {
        setDataSource((prevDataSource) => {
            const itemToDelete = prevDataSource.find((item) => item.key === key);
            if (itemToDelete) {
                vscode.postMessage({
                    command: "webviewTellsProviderToUpdateData",
                    operation: "delete",
                    entry: {
                        id: itemToDelete.id,
                    },
                } as DictionaryPostMessages);
            }
            return prevDataSource.filter((item) => item.key !== key);
        });
    }, []);

    // const handleAdd = useCallback(() => {
    //     setDataSource((prevDataSource) => {
    //         const newKey = prevDataSource.length
    //             ? Math.max(...prevDataSource.map((item) => Number(item.key))) + 1
    //             : 0;
    //         const newEntry: DataType = {
    //             key: newKey,
    //             headWord: "",
    //             definition: "",
    //         };

    //         vscode.postMessage({
    //             command: "webviewTellsProviderToUpdateData",
    //             operation: "add",
    //             entry: {
    //                 headWord: newEntry.headWord,
    //                 definition: newEntry.definition,
    //             },
    //         } as DictionaryPostMessages);

    //         return [...prevDataSource, newEntry];
    //     });
    // }, []);

    const getColumnIcon = useCallback((columnName: string): JSX.Element => {
        const iconMap: { [key: string]: string } = {
            headWord: "symbol-keyword",
            headForm: "symbol-text",
            variantForms: "symbol-array",
            definition: "book",
            translationEquivalents: "symbol-string",
            links: "link",
            linkedEntries: "references",
            notes: "note",
            metadata: "json",
            hash: "symbol-key",
        };
        const iconName = iconMap[columnName] || "symbol-field";
        return <span className={`codicon codicon-${iconName}`}></span>;
    }, []);

    const columns: ColumnsType<DataType> = React.useMemo(() => {
        if (columnNames.length === 0) {
            return [];
        }

        const dataColumns = columnNames
            .filter((key) => key !== "id")
            .filter((key) => key !== "isUserEntry")
            .filter((key) => key !== "authorId")
            .map((key) => ({
                title: (
                    <Tooltip title={key}>
                        <span>
                            {getColumnIcon(key)} {key}
                        </span>
                    </Tooltip>
                ),
                dataIndex: key,
                key: key,
                render: (text: string) => <span>{text}</span>,
                fixed: key === columnNames[0] ? ("left" as const) : undefined,
            }));

        const actionColumn = {
            title: (
                <Tooltip title="Actions">
                    <span className="codicon codicon-gear"></span>
                </Tooltip>
            ),
            key: "action",
            fixed: "right" as const,
            width: 100,
            render: (_: any, record: DataType) => (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "10px",
                        flexWrap: "nowrap",
                    }}
                >
                    <ConfirmDeleteButton onConfirm={() => handleDelete(record.key)} />
                    <Button
                        onClick={() => {
                            setEntryToEdit(record as unknown as DictionaryEntry);
                        }}
                        icon={<span className="codicon codicon-edit"></span>}
                    />
                </div>
            ),
        };

        return [...dataColumns, actionColumn];
    }, [columnNames, handleDelete, getColumnIcon]);

    // Function to fetch page data
    const fetchPageData = useCallback((page: number, pageSize: number, search?: string) => {
        vscode.postMessage({
            command: "webviewTellsProviderToUpdateData",
            operation: "fetchPage",
            pagination: {
                page,
                pageSize,
                searchQuery: search,
            },
        } as DictionaryPostMessages);
    }, []);

    // Handle table pagination change
    const handleTableChange = (newPagination: any) => {
        setPagination((prev) => ({
            ...prev,
            current: newPagination.current,
            pageSize: newPagination.pageSize,
        }));
        fetchPageData(newPagination.current, newPagination.pageSize, searchQuery);
    };

    // Update the search handler to reset pagination
    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = event.target.value;
        setSearchQuery(newQuery);
        setPagination((prev) => ({ ...prev, current: 1 }));
        fetchPageData(1, pagination.pageSize, newQuery);
    };

    // Update the message handler
    useEffect(() => {
        const handleReceiveMessage = (event: MessageEvent<DictionaryReceiveMessages>) => {
            const message = event.data;
            if (message.command === "providerTellsWebviewToUpdateData") {
                const { entries, total, page, pageSize } = message.data;
                console.log("entries in app", entries);
                const newDataSource = entries.map((entry, index) => ({
                    key: (page - 1) * pageSize + index,
                    ...entry,
                }));

                setDataSource(newDataSource);
                setPagination((prev) => ({
                    ...prev,
                    total,
                    current: page,
                    pageSize,
                }));

                if (entries.length > 0) {
                    const newColumnNames = Object.keys(entries[0]).filter((key) => key !== "key");
                    setColumnNames(newColumnNames);
                }
            }
        };

        window.addEventListener("message", handleReceiveMessage);
        // Initial data fetch
        fetchPageData(pagination.current, pagination.pageSize);

        return () => {
            window.removeEventListener("message", handleReceiveMessage);
        };
    }, []);

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.defaultAlgorithm,
                token: {
                    ...vsCodeTheme,
                    // You can override or add more token values here
                },
                components: {
                    // Customize specific component styles if needed
                },
            }}
        >
            <div
                ref={outerContainer}
                style={{
                    width: "100vw",
                    height: "100vh",
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div ref={inputRef}>
                    <Input
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        style={{ marginBottom: "16px" }}
                        prefix={<span className="codicon codicon-search"></span>}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "10px",
                        justifyContent: "flex-end",
                    }}
                >
                    <Button
                        ref={buttonRef}
                        onClick={() =>
                            vscode.postMessage({
                                command: "callCommand",
                                vscodeCommandName: "extension.importWiktionaryJSONL",
                                args: [],
                            } as DictionaryPostMessages)
                        }
                        type="primary"
                        style={{ marginBottom: "16px", alignSelf: "flex-start" }}
                        icon={<span className="codicon codicon-replace-all"></span>}
                    ></Button>
                    <Button
                        ref={buttonRef}
                        onClick={() => setAddWordVisible(true)}
                        type="primary"
                        style={{ marginBottom: "16px", alignSelf: "flex-start" }}
                        icon={<span className="codicon codicon-replace"></span>}
                    ></Button>
                </div>

                <AddWordForm visible={addWordVisible} onCancel={() => setAddWordVisible(false)} />
                {entryToEdit && (
                    <EditWordForm
                        entry={entryToEdit}
                        visible={entryToEdit !== null}
                        onCancel={() => setEntryToEdit(null)}
                    />
                )}
                <div ref={tableRef}>
                    <Table
                        dataSource={dataSource}
                        columns={columns}
                        bordered
                        pagination={{
                            ...pagination,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total) => `Total ${total} items`,
                        }}
                        onChange={handleTableChange}
                        scroll={{
                            x: "max-content",
                            y: `calc(${
                                (outerContainerHeight || 0) -
                                (inputHeight || 0) -
                                (buttonHeight || 0)
                            }px - 180px)`,
                        }}
                        style={{ flexGrow: 1, overflow: "auto" }}
                    />
                </div>
            </div>
        </ConfigProvider>
    );
};

export default App;
