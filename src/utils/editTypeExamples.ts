// Examples demonstrating the type-safe edit system
import { EditHistory, EditFor, CodexData } from "../../types";
import { EditMapUtils } from "./editMapUtils";
import { EditType } from "../../types/enums";

// Example 1: Value edit (HTML string)
const valueEdit: EditFor<readonly ["value"]> = {
    editMap: EditMapUtils.value(),
    value: "<span>Hello World</span>", // TypeScript infers: string
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
    validatedBy: []
};

// Example 2: Cell label edit (string)
const labelEdit: EditFor<readonly ["metadata", "cellLabel"]> = {
    editMap: EditMapUtils.cellLabel(),
    value: "Genesis 1:1", // TypeScript infers: string
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
    validatedBy: []
};

// Example 3: Data edit (CodexData object)
const timestamps: CodexData = {
    startTime: 0,
    endTime: 1000,
};

const dataEdit: EditFor<readonly ["metadata", "data"]> = {
    editMap: EditMapUtils.data(),
    value: timestamps, // ✅ TypeScript infers: CodexData
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
    validatedBy: []
};

// Example 4: Boolean field edit
const deleteEdit: EditFor<readonly ["metadata", "data", "deleted"]> = {
    editMap: EditMapUtils.dataDeleted(),
    value: true, // ✅ TypeScript infers: boolean
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
    validatedBy: []
};

// Example 5: Number field edit
const startTimeEdit: EditFor<readonly ["metadata", "data", "startTime"]> = {
    editMap: EditMapUtils.dataStartTime(),
    value: 500, // ✅ TypeScript infers: number
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
    validatedBy: []
};

// Example 6: Generic metadata field (fallback type)
const genericEdit: EditFor<readonly ["metadata", string]> = {
    editMap: EditMapUtils.metadata("customField"),
    value: "some value", // ✅ TypeScript infers: string | number | boolean | object
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
    validatedBy: []
};

// Example 7: Array of mixed edit types
const mixedEdits: EditHistory[] = [
    {
        editMap: EditMapUtils.value(),
        value: "<span>Content</span>", // string
        author: "user1",
        timestamp: Date.now(),
        type: "user-edit" as any
    },
    {
        editMap: EditMapUtils.cellLabel(),
        value: "Chapter 1", // string
        author: "user1",
        timestamp: Date.now(),
        type: "user-edit" as any
    },
    {
        editMap: EditMapUtils.dataDeleted(),
        value: false, // boolean
        author: "user1",
        timestamp: Date.now(),
        type: "user-edit" as any
    }
];

// Type-safe filtering functions
function filterValueEdits(edits: EditHistory[]): EditFor<["value"]>[] {
    return edits.filter(edit => EditMapUtils.isValue(edit.editMap)) as EditFor<["value"]>[];
}

function filterLabelEdits(edits: EditHistory[]): EditFor<["metadata", "cellLabel"]>[] {
    return edits.filter(edit => EditMapUtils.equals(edit.editMap, ["metadata", "cellLabel"])) as EditFor<["metadata", "cellLabel"]>[];
}

// Usage example
const valueEdits = filterValueEdits(mixedEdits);
// TypeScript knows valueEdits[0].value is a string

const labelEdits = filterLabelEdits(mixedEdits);
// TypeScript knows labelEdits[0].value is a string

export { valueEdit, labelEdit, dataEdit, deleteEdit, startTimeEdit, genericEdit, mixedEdits };
