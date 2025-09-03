// Type demonstration - this file shows how the type system works
// It will have TypeScript errors if uncommented lines are invalid

import { EditHistory, CodexData } from "../../types";
import { EditMapUtils } from "./editMapUtils";
import { EditType } from "../../types/enums";

// ✅ Valid: String value for cell content
const validValueEdit: EditHistory<["value"]> = {
    editMap: EditMapUtils.value(),
    value: "<span>Hello</span>", // ✅ Correctly inferred as string
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// ✅ Valid: String value for cell label
const validLabelEdit: EditHistory<["metadata", "cellLabel"]> = {
    editMap: EditMapUtils.cellLabel(),
    value: "Genesis 1:1", // ✅ Correctly inferred as string
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// ❌ Invalid examples (commented out to avoid compilation errors):

/*
// This would cause a TypeScript error because value should be string, not number:
const invalidValueEdit: EditHistory<["value"]> = {
    editMap: EditMapUtils.value(),
    value: 123, // ❌ TypeScript error: Type 'number' is not assignable to type 'string'
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// This would cause a TypeScript error because value should be boolean, not string:
const invalidBoolEdit: EditHistory<["metadata", "data", "deleted"]> = {
    editMap: EditMapUtils.dataDeleted(),
    value: "true", // ❌ TypeScript error: Type 'string' is not assignable to type 'boolean'
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// This would cause a TypeScript error because value should be CodexData, not partial object:
const invalidObjectEdit: EditHistory<["metadata", "data"]> = {
    editMap: EditMapUtils.data(),
    value: { startTime: 100 }, // ❌ TypeScript error: Missing required properties
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};
*/

// ✅ Valid: Boolean value for deleted flag
const validBoolEdit: EditHistory<["metadata", "data", "deleted"]> = {
    editMap: EditMapUtils.dataDeleted(),
    value: true, // ✅ Correctly inferred as boolean
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// ✅ Valid: Number value for timestamp
const validNumberEdit: EditHistory<["metadata", "data", "startTime"]> = {
    editMap: EditMapUtils.dataStartTime(),
    value: 1000, // ✅ Correctly inferred as number
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// ✅ Valid: Object value for data
const validObjectEdit: EditHistory<["metadata", "data"]> = {
    editMap: EditMapUtils.data(),
    value: { // ✅ Correctly inferred as CodexData
        startTime: 0,
        endTime: 1000,
        deleted: false
    } as CodexData,
    author: "test",
    timestamp: 123,
    type: EditType.USER_EDIT
};

// Type-safe usage demonstration
function processValueEdit(edit: EditHistory<["value"]>) {
    // TypeScript knows edit.value is a string
    const htmlContent: string = edit.value; // ✅ No type assertion needed
    console.log("Processing HTML:", htmlContent.toUpperCase()); // ✅ String methods available
}

function processBoolEdit(edit: EditHistory<["metadata", "data", "deleted"]>) {
    // TypeScript knows edit.value is a boolean
    const isDeleted: boolean = edit.value; // ✅ No type assertion needed
    console.log("Deleted status:", isDeleted ? "Yes" : "No"); // ✅ Boolean methods available
}

// Usage
processValueEdit(validValueEdit);
processBoolEdit(validBoolEdit);

export { validValueEdit, validLabelEdit, validBoolEdit, validNumberEdit, validObjectEdit };
