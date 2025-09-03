// Test file to demonstrate the type system is working correctly
import { EditHistory } from "../../types";
import { EditMapUtils } from "./editMapUtils";
import { EditType } from "../../types/enums";

// This file should compile without errors, demonstrating that the type system works

// Test 1: Value edit should accept string
const valueEdit: EditHistory<["value"]> = {
    editMap: EditMapUtils.value(),
    value: "<span>test</span>", // Should be string
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// Test 2: Cell label edit should accept string
const labelEdit: EditHistory<["metadata", "cellLabel"]> = {
    editMap: EditMapUtils.cellLabel(),
    value: "Genesis 1:1", // Should be string
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// Test 3: Data edit should accept CodexData object
const dataEdit: EditHistory<["metadata", "data"]> = {
    editMap: EditMapUtils.data(),
    value: { // Should be CodexData object
        startTime: 0,
        endTime: 1000,
        deleted: false
    },
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// Test 4: Boolean edit should accept boolean
const boolEdit: EditHistory<["metadata", "data", "deleted"]> = {
    editMap: EditMapUtils.dataDeleted(),
    value: true, // Should be boolean
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// Test 5: Number edit should accept number
const numberEdit: EditHistory<["metadata", "data", "startTime"]> = {
    editMap: EditMapUtils.dataStartTime(),
    value: 500, // Should be number
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// Type-safe usage demonstration
function processValueEdit(edit: EditHistory<["value"]>) {
    // TypeScript knows edit.value is a string
    const content: string = edit.value;
    return content.toUpperCase(); // String methods work
}

function processDataEdit(edit: EditHistory<["metadata", "data"]>) {
    // TypeScript knows edit.value is a CodexData object
    const data = edit.value;
    return data.startTime; // Object properties work
}

function processBoolEdit(edit: EditHistory<["metadata", "data", "deleted"]>) {
    // TypeScript knows edit.value is a boolean
    const isDeleted: boolean = edit.value;
    return isDeleted ? "deleted" : "active";
}

// Test the functions
const content = processValueEdit(valueEdit); // Returns string
const startTime = processDataEdit(dataEdit); // Returns number
const status = processBoolEdit(boolEdit); // Returns string

export { valueEdit, labelEdit, dataEdit, boolEdit, numberEdit, content, startTime, status };
