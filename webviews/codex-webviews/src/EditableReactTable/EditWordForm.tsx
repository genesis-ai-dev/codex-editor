import React, { useState } from "react";
import { Modal, Form, Input, Button } from "antd";
import { DictionaryEntry, DictionaryPostMessages } from "../../../../types";
import { vscode } from "./utilities/vscode";

interface EditWordProps {
    visible: boolean;
    onCancel: () => void;
    entry: DictionaryEntry;
}

const EditWordForm: React.FC<EditWordProps> = ({ visible, onCancel, entry }) => {
    const [form] = Form.useForm();

    // Reset form with entry values when modal becomes visible
    React.useEffect(() => {
        if (visible) {
            form.setFieldsValue({
                headWord: entry.headWord,
                definition: entry.definition,
            });
        }
    }, [visible, entry, form]);

    const handleSubmit = () => {
        form.validateFields().then((values) => {
            // Send message to add new word
            vscode.postMessage({
                command: "webviewTellsProviderToUpdateData",
                operation: "update",
                entry: {
                    id: entry.id,
                    headWord: values.headWord,
                    definition: values.definition || "",
                },
            } as DictionaryPostMessages);

            form.resetFields();
            onCancel();
        });
    };

    return (
        <Modal
            title={
                <span>
                    <span className="codicon codicon-edit"></span> Edit Word
                </span>
            }
            open={visible}
            onCancel={onCancel}
            footer={[
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "10px",
                        flexWrap: "nowrap",
                    }}
                >
                    <Button key="cancel" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button key="submit" type="primary" onClick={handleSubmit}>
                        Save
                    </Button>
                </div>,
            ]}
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    headWord: entry.headWord,
                    definition: entry.definition,
                }}
            >
                <Form.Item
                    name="headWord"
                    label="Word"
                    rules={[{ required: true, message: "Please input the word" }]}
                >
                    <Input placeholder="Enter word" style={{ border: "1px solid #424242" }} />
                </Form.Item>

                <Form.Item
                    name="definition"
                    label="Definition"
                    rules={[{ required: false, message: "Please input the definition" }]}
                >
                    <Input.TextArea placeholder="Enter definition" rows={4} />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default EditWordForm;
