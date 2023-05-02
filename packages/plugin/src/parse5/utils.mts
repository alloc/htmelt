import parse5, { ChildNode, Element, Node, ParentNode, TextNode } from 'parse5'
import adapter from 'parse5/lib/tree-adapters/default.js'

const DEFAULT_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const REGEXP_IS_HTML_DOCUMENT = /^\s*<(!doctype|html|head|body)\b/i

export function createElement(
  tagName: string,
  attrs: Record<string, string> = {},
  namespaceURI: string = DEFAULT_NAMESPACE
): Element {
  const attrsArray = Object.entries(attrs).map(([name, value]) => ({
    name,
    value,
  }))
  return adapter.createElement(tagName, namespaceURI, attrsArray)
}

/**
 * Creates a script element.
 */
export function createScript(attrs = {}, code = undefined) {
  const element = createElement('script', attrs)
  if (code) {
    setTextContent(element, code)
  }
  return element
}

export function isHtmlFragment(html: string) {
  let htmlWithoutComments = html.replace(/<!--.*?-->/gs, '')
  return !REGEXP_IS_HTML_DOCUMENT.test(htmlWithoutComments)
}

export function getAttributes(element: Element) {
  const attrsArray = adapter.getAttrList(element)
  const attrsObj: Record<string, string> = {}
  for (const e of attrsArray) {
    attrsObj[e.name] = e.value
  }
  return attrsObj
}

export function getAttribute(element: Element, name: string) {
  const attrList = adapter.getAttrList(element)
  if (!attrList) {
    return null
  }

  const attr = attrList.find(a => a.name == name)
  if (attr) {
    return attr.value
  }
}

export function hasAttribute(element: Element, name: string) {
  return getAttribute(element, name) != null
}

export function setAttribute(element: Element, name: string, value: string) {
  const attrs = adapter.getAttrList(element)
  const existing = attrs.find(a => a.name === name)

  if (existing) {
    existing.value = value
  } else {
    attrs.push({ name, value })
  }
}

export function setAttributes(
  element: Element,
  attributes: Record<string, string | undefined>
) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      setAttribute(element, name, value)
    }
  }
}

export function removeAttribute(element: Element, name: string) {
  const attrs = adapter.getAttrList(element)
  element.attrs = attrs.filter(attr => attr.name !== name)
}

export function getTextContent(node: Node): string {
  if (adapter.isCommentNode(node)) {
    return node.data || ''
  }
  if (adapter.isTextNode(node)) {
    return node.value || ''
  }
  const subtree = findNodes(node, n => adapter.isTextNode(n))
  return subtree.map(getTextContent).join('')
}

export function setTextContent(node: Node, value: string) {
  if (adapter.isCommentNode(node)) {
    node.data = value
  } else if (adapter.isTextNode(node)) {
    node.value = value
  } else {
    const parentNode = node as ParentNode
    const textNode = {
      nodeName: '#text',
      value: value,
      parentNode: node,
      attrs: [],
      __location: undefined,
    }
    parentNode.childNodes = [textNode as TextNode]
  }
}

/**
 * Removes element from the AST.
 */
export function remove(node: ChildNode) {
  const parent = node.parentNode
  if (parent && parent.childNodes) {
    const idx = parent.childNodes.indexOf(node)
    parent.childNodes.splice(idx, 1)
  }
  node.parentNode = undefined!
}

/**
 * Looks for a child node which passes the given test
 */
export function findNode(
  nodes: Node[] | Node,
  test: (node: Node) => boolean
): Node | null {
  const n = Array.isArray(nodes) ? nodes.slice() : [nodes]

  while (n.length > 0) {
    const node = n.shift()
    if (!node) {
      continue
    }
    if (test(node)) {
      return node
    }
    const children = adapter.getChildNodes(node as ParentNode)
    if (Array.isArray(children)) {
      n.unshift(...children)
    }
  }
  return null
}

/**
 * Looks for all child nodes which passes the given test
 */
export function findNodes(
  nodes: Node | Node[],
  test: (node: Node) => boolean
): Node[] {
  const n = Array.isArray(nodes) ? nodes.slice() : [nodes]
  const found: Node[] = []

  while (n.length) {
    const node = n.shift()
    if (!node) {
      continue
    }
    if (test(node)) {
      found.push(node)
    }
    const children = adapter.getChildNodes(node as ParentNode)
    if (Array.isArray(children)) {
      n.unshift(...children)
    }
  }
  return found
}

/**
 * Looks for a child element which passes the given test
 */
export function findElement(
  nodes: Node[] | Node,
  test: (node: Element) => boolean
): Element | null {
  return findNode(nodes, n => adapter.isElementNode(n) && test(n as any)) as any
}

/**
 * Looks for all child elements which passes the given test
 */
export function findElements(
  nodes: Node | Node[],
  test: (node: Element) => boolean
): Element[] {
  return findNodes(nodes, n => adapter.isElementNode(n) && test(n)) as any
}

export function prepend(parent: ParentNode, node: ChildNode) {
  parent.childNodes.unshift(node)
  node.parentNode = parent
}

/**
 * Prepends HTML snippet to the given html document. The document must
 * have either a <body> or <head> element.
 */
export function prependToDocument(
  document: string,
  appendedHtml: string
): string | null {
  const documentAst = parse5.parse(document, { sourceCodeLocationInfo: true })
  let appendNode = findElement(
    documentAst,
    node => adapter.getTagName(node) === 'head'
  )
  if (
    !appendNode ||
    !appendNode.sourceCodeLocation ||
    !appendNode.sourceCodeLocation.startTag
  ) {
    // the original code did not contain a head
    appendNode = findElement(
      documentAst,
      node => adapter.getTagName(node) === 'body'
    )
    if (
      !appendNode ||
      !appendNode.sourceCodeLocation ||
      !appendNode.sourceCodeLocation.startTag
    ) {
      // the original code did not contain a head or body, so we go with the generated AST
      const head = findElement(
        documentAst,
        node => adapter.getTagName(node) === 'head'
      )
      if (!head) throw new Error('parse5 did not generated a head element')
      const fragment = parse5.parseFragment(appendedHtml)
      for (const node of adapter.getChildNodes(fragment).reverse()) {
        prepend(head, node)
      }
      return parse5.serialize(documentAst)
    }
  }

  // the original source contained a head or body element, use string
  // manipulation to preserve original code formatting
  const { endOffset } = appendNode.sourceCodeLocation.startTag
  const start = document.substring(0, endOffset)
  const end = document.substring(endOffset)
  return `${start}${appendedHtml}${end}`
}

/**
 * Append HTML snippet to the given html document. The document must
 * have either a <body> or <head> element.
 */
export function appendToDocument(document: string, appendedHtml: string) {
  const documentAst = parse5.parse(document, { sourceCodeLocationInfo: true })
  let appendNode = findElement(
    documentAst,
    node => adapter.getTagName(node) === 'body'
  )
  if (
    !appendNode ||
    !appendNode.sourceCodeLocation ||
    !appendNode.sourceCodeLocation.endTag
  ) {
    // there is no body node in the source, use the head instead
    appendNode = findElement(
      documentAst,
      node => adapter.getTagName(node) === 'head'
    )
    if (
      !appendNode ||
      !appendNode.sourceCodeLocation ||
      !appendNode.sourceCodeLocation.endTag
    ) {
      // the original code did not contain a head or body, so we go with the generated AST
      const body = findElement(
        documentAst,
        node => adapter.getTagName(node) === 'body'
      )
      if (!body) throw new Error('parse5 did not generated a body element')
      const fragment = parse5.parseFragment(appendedHtml)
      for (const node of adapter.getChildNodes(fragment)) {
        adapter.appendChild(body, node)
      }
      return parse5.serialize(documentAst)
    }
  }

  // the original source contained a head or body element, use string manipulation
  // to preserve original code formatting
  const { startOffset } = appendNode.sourceCodeLocation.endTag
  const start = document.substring(0, startOffset)
  const end = document.substring(startOffset)
  return `${start}${appendedHtml}${end}`
}

export const createDocument = adapter.createDocument
export const createDocumentFragment = adapter.createDocumentFragment
export const createCommentNode = adapter.createCommentNode
export const appendChild = adapter.appendChild
export const insertBefore = adapter.insertBefore
export const setTemplateContent = adapter.setTemplateContent
export const getTemplateContent = adapter.getTemplateContent
export const setDocumentType = adapter.setDocumentType
export const setDocumentMode = adapter.setDocumentMode
export const getDocumentMode = adapter.getDocumentMode
export const detachNode = adapter.detachNode
export const insertText = adapter.insertText
export const insertTextBefore = adapter.insertTextBefore
export const adoptAttributes = adapter.adoptAttributes
export const getFirstChild = adapter.getFirstChild
export const getChildNodes = adapter.getChildNodes
export const getParentNode = adapter.getParentNode
export const getAttrList = adapter.getAttrList
export const getTagName = adapter.getTagName
export const getNamespaceURI = adapter.getNamespaceURI
export const getTextNodeContent = adapter.getTextNodeContent
export const getCommentNodeContent = adapter.getCommentNodeContent
export const getDocumentTypeNodeName = adapter.getDocumentTypeNodeName
export const getDocumentTypeNodePublicId = adapter.getDocumentTypeNodePublicId
export const getDocumentTypeNodeSystemId = adapter.getDocumentTypeNodeSystemId
export const isTextNode = adapter.isTextNode
export const isCommentNode = adapter.isCommentNode
export const isDocumentTypeNode = adapter.isDocumentTypeNode
export const isElementNode = adapter.isElementNode
export const setNodeSourceCodeLocation = adapter.setNodeSourceCodeLocation
export const getNodeSourceCodeLocation = adapter.getNodeSourceCodeLocation
