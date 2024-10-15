import React, { useEffect, useState, useCallback, useRef } from "react";
import { Table, Input, Button, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { vscode } from "./utilities/vscode";
import "./style.css";
import { Dictionary, DictionaryEntry } from "codex-types";
import { DictionaryPostMessages, DictionaryReceiveMessages } from "../../../../types";
import debounce from "lodash.debounce";

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

function App() {
    const [dataSource, setDataSource] = useState<DataType[]>([]);
    const [columnNames, setColumnNames] = useState<string[]>([]);
    const [dictionary, setDictionary] = useState<Dictionary>({
        id: "",
        label: "",
        entries: [],
        metadata: {},
    });
    const [searchQuery, setSearchQuery] = useState("");

    const dataSourceRef = useRef(dataSource);
    const dictionaryRef = useRef(dictionary);

    useEffect(() => {
        dataSourceRef.current = dataSource;
    }, [dataSource]);

    useEffect(() => {
        dictionaryRef.current = dictionary;
    }, [dictionary]);

    const debouncedUpdateDictionary = useRef(
        debounce(() => {
            const updatedDictionary: Dictionary = {
                ...dictionaryRef.current,
                entries: dataSourceRef.current.map(({ key, ...rest }) => rest as DictionaryEntry),
            };
            setDictionary(updatedDictionary);
            vscode.postMessage({
                command: "webviewTellsProviderToUpdateData",
                data: updatedDictionary,
            } as DictionaryPostMessages);
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

    const columns: ColumnsType<DataType> = React.useMemo(() => {
        if (columnNames.length > 0) {
            const dataColumns = columnNames.map((key) => ({
                title: key,
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
            }));

            dataColumns.push({
                title: "Action",
                key: "action",
                render: (_, record) => (
                    <Popconfirm title="Sure to delete?" onConfirm={() => handleDelete(record.key)}>
                        <a>Delete</a>
                    </Popconfirm>
                ),
            });

            return dataColumns;
        }
        return [];
    }, [columnNames, handleCellChange, handleDelete]);

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
        <div
            style={{
                width: "100%",
                height: "100%",
                padding: 10,
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 40,
                    marginTop: 40,
                    minHeight: "60px",
                }}
            >
                <h1>Dictionary</h1>
            </div>

            <div style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
                <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    style={{ width: "100%", marginBottom: 16 }}
                />
            </div>

            <Button onClick={handleAdd} type="primary" style={{ marginBottom: 16 }}>
                Add a row
            </Button>

            <Table
                dataSource={filteredData}
                columns={columns}
                bordered
                pagination={false}
                rowKey="key"
            />
        </div>
    );
}

export default App;
