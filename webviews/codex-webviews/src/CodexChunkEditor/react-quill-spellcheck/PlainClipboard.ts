import Quill from "quill";
const Clipboard = Quill.import("modules/clipboard");
const Delta = Quill.import("delta");

export const specialCharacters =
    /<|>|\u00a9|\u00ae|[\u2000-\u200f]|[\u2016-\u2017]|[\u2020-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[\u1d00-\u1d7f]|[\u0250-\u02af]|[\u0100-\u017f]|\ud835[\udc00-\udfff]/g;
export default class PlainClipboard extends Clipboard {
    onPaste(e: any) {
        console.log("spell-checker-debug: PlainClipboard onPaste called", {
            e,
        });
        e.preventDefault?.();
        console.log("spell-checker-debug: this.quill", {
            "this.quill": this.quill,
        });
        const range = this.quill.getSelection?.();
        console.log("spell-checker-debug: Current selection", { range });
        const text = e.clipboardData
            .getData("text/plain")
            .normalize("NFKC")
            .replace(specialCharacters, "")
            .trim();
        console.log("spell-checker-debug: Processed pasted text", { text });
        console.log("spell-checker-debug: Delta", Delta);
        const delta = new Delta()
            .retain(range.index)
            .delete(range.length)
            .insert(text);
        console.log("spell-checker-debug: Created delta", { delta });
        const index = text.length + range.index;
        const length = 0;
        console.log("spell-checker-debug: Updating contents", { delta });
        this.quill.updateContents(delta, "user");
        console.log("spell-checker-debug: Setting selection", {
            index,
            length,
        });
        this.quill.setSelection(index, length);
        console.log("spell-checker-debug: Scrolling into view");
        this.quill.scrollIntoView();
        console.log("spell-checker-debug: PlainClipboard onPaste completed");
    }
}
