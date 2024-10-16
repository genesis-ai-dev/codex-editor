import React, { useEffect, useState, useCallback, useRef } from "react";
import { Table, Input, Button, Popconfirm, Tooltip, ConfigProvider, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { vscode } from "./utilities/vscode";
// import "./style.css";
import { Dictionary, DictionaryEntry } from "codex-types";
import { DictionaryPostMessages, DictionaryReceiveMessages } from "../../../../types";
import debounce from "lodash.debounce";
import { isEqual } from "lodash";

interface DataType {
    key: React.Key;
    [key: string]: any;
}

interface EditableCellProps {
    value: string;
    recordKey: React.Key;
    dataIndex: string;
    onChange: (key: React.Key, dataIndex: string, value: any) => void;
}

const EditableCell: React.FC<EditableCellProps> = ({ value, recordKey, dataIndex, onChange }) => {
    const [editingValue, setEditingValue] = useState(value);

    useEffect(() => {
        setEditingValue(value);
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditingValue(e.target.value);
    };

    const handleBlur = () => {
        if (editingValue !== value) {
            onChange(recordKey, dataIndex, editingValue);
        }
    };

    return <Input value={editingValue} onChange={handleChange} onBlur={handleBlur} />;
};

const App: React.FC = () => {
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

    const debouncedUpdateDictionary = useRef(
        debounce(() => {
            const updatedDictionary: Dictionary = {
                ...dictionaryRef.current,
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                entries: dataSourceRef.current.map(({ key, ...rest }) => rest as DictionaryEntry),
            };

            if (!isEqual(updatedDictionary, lastSentDataRef.current)) {
                setDictionary(updatedDictionary);
                vscode.postMessage({
                    command: "webviewTellsProviderToUpdateData",
                    data: updatedDictionary,
                } as DictionaryPostMessages);
                lastSentDataRef.current = updatedDictionary;
            }
        }, 500)
    ).current;

    useEffect(() => {
        debouncedUpdateDictionary();
    }, [dataSource, debouncedUpdateDictionary]);

    const handleCellChange = useCallback((key: React.Key, dataIndex: string, value: any) => {
        setDataSource((prevDataSource) =>
            prevDataSource.map((item) => {
                if (item.key === key) {
                    return { ...item, [dataIndex]: value };
                }
                return item;
            })
        );
    }, []);

    const handleDelete = useCallback((key: React.Key) => {
        setDataSource((prevDataSource) => prevDataSource.filter((item) => item.key !== key));
    }, []);

    const handleAdd = useCallback(() => {
        setDataSource((prevDataSource) => {
            const newKey = prevDataSource.length
                ? Math.max(...prevDataSource.map((item) => Number(item.key))) + 1
                : 0;
            const newEntry: DataType = { key: newKey };
            columnNames.forEach((key) => {
                newEntry[key] = "";
            });
            return [...prevDataSource, newEntry];
        });
    }, [columnNames]);

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
            .filter((key) => key !== "id") // Hide the 'id' column
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
                render: (text: string, record: DataType) => (
                    <EditableCell
                        value={text}
                        recordKey={record.key}
                        dataIndex={key}
                        onChange={handleCellChange}
                    />
                ),
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
                <Popconfirm
                    title="Sure to delete?"
                    onConfirm={() => handleDelete(record.key)}
                    icon={<span className="codicon codicon-trash"></span>}
                >
                    <Button type="text" icon={<span className="codicon codicon-trash"></span>} />
                </Popconfirm>
            ),
        };

        return [...dataColumns, actionColumn];
    }, [columnNames, handleCellChange, handleDelete, getColumnIcon]);

    useEffect(() => {
        const handleReceiveMessage = (event: MessageEvent<DictionaryReceiveMessages>) => {
            const message = event.data;
            if (message.command === "providerTellsWebviewToUpdateData") {
                let newDictionary: Dictionary = message.data;

                if (!newDictionary.entries) {
                    newDictionary = {
                        ...newDictionary,
                        entries: [],
                    };
                }

                setDictionary(newDictionary);

                const newDataSource = newDictionary.entries.map((entry, index) => ({
                    key: index,
                    ...entry,
                }));
                setDataSource(newDataSource);

                // Extract column names from the first entry
                if (newDataSource.length > 0) {
                    const newColumnNames = Object.keys(newDataSource[0]).filter(
                        (key) => key !== "key"
                    );
                    setColumnNames(newColumnNames);
                }
            }
        };

        window.addEventListener("message", handleReceiveMessage);

        return () => {
            window.removeEventListener("message", handleReceiveMessage);
        };
    }, []);

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(event.target.value);
    };

    const filteredData = dataSource.filter((row: DataType) => {
        return Object.values(row).some(
            (value) =>
                typeof value === "string" && value.toLowerCase().includes(searchQuery.toLowerCase())
        );
    });

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
                style={{
                    width: "100vw",
                    height: "100vh",
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "20px",
                    }}
                >
                    <h1>Dictionary</h1>
                </div>

                <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    style={{ marginBottom: "16px" }}
                    prefix={<span className="codicon codicon-search"></span>}
                />

                <Button
                    onClick={handleAdd}
                    type="primary"
                    style={{ marginBottom: "16px", alignSelf: "flex-start" }}
                    icon={<span className="codicon codicon-add"></span>}
                >
                    Add a row
                </Button>

                <Table
                    dataSource={filteredData}
                    columns={columns}
                    bordered
                    pagination={false}
                    rowKey="key"
                    scroll={{ x: "max-content", y: "calc(100vh - 200px)" }}
                    style={{ flexGrow: 1, overflow: "auto" }}
                />
            </div>
        </ConfigProvider>
    );
};

export default App;
