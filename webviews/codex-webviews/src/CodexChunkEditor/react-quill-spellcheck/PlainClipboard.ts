import Quill from "quill"
const Clipboard = Quill.import("modules/clipboard")
const Delta = Quill.import("delta")

export const specialCharacters =
  /<|>|\u00a9|\u00ae|[\u2000-\u200f]|[\u2016-\u2017]|[\u2020-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[\u1d00-\u1d7f]|[\u0250-\u02af]|[\u0100-\u017f]|\ud835[\udc00-\udfff]/g
export default class PlainClipboard extends Clipboard {
  onPaste(e: any) {
    e.preventDefault()
    const range = this.quill.getSelection()
    const text = e.clipboardData
      .getData("text/plain")
      .normalize("NFKC")
      .replace(specialCharacters, "")
      .trim()
    const delta = new Delta()
      .retain(range.index)
      .delete(range.length)
      .insert(text)
    const index = text.length + range.index
    const length = 0
    this.quill.updateContents(delta, 'user')
    this.quill.setSelection(index, length)
    this.quill.scrollIntoView()
  }
}
