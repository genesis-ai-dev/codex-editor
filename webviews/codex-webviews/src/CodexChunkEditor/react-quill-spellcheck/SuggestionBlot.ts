import { MatchesEntity } from './types'

/**
 * Quill editor blot that represents a suggestion.
 *
 * This is added to the text to enable the suggestion to be selected and inserted.
 *
 * @param Quill Quill static instance
 * @returns Blot class that can be registered on the Quill instance
 */
export default function createSuggestionBlotForQuillInstance(Quill: any) {
  const ParentBlot = Quill.import('formats/bold')

  return class SuggestionBlot extends ParentBlot {
    static blotName = 'spck-match'
    static tagName = 'quill-spck-match'

    static create(match?: MatchesEntity) {
      let node: HTMLElement = super.create()
      if (match) {
        node.setAttribute('data-offset', match.offset?.toString())
        node.setAttribute('data-length', match.length?.toString())
        node.id=`match-${match.id}`
      }
      return node
    }

    optimize() {}
  }
}
