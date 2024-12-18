import React, { useState } from "react";
import { Modal, Form, Input, Button } from "antd";
import { DictionaryPostMessages } from "../../../../types";
import { vscode } from "./utilities/vscode";

interface AddWordProps {
    visible: boolean;
    onCancel: () => void;
}

const AddWordForm: React.FC<AddWordProps> = ({ visible, onCancel }) => {
    const [form] = Form.useForm();

    const handleSubmit = () => {
        form.validateFields().then((values) => {
            // Send message to add new word
            vscode.postMessage({
                command: "webviewTellsProviderToUpdateData",
                operation: "add",
                entry: {
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
                    <span className="codicon codicon-add"></span> Add New Word
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
                        Add
                    </Button>
                </div>,
            ]}
        >
            <Form form={form} layout="vertical">
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

export default AddWordForm;
