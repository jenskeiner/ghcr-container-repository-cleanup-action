export interface Node<T extends Node<T>> {
  children: T[]
  parent: T | null
}

type NodeRenderer<T extends Node<T>> = (node: T, prefix: string) => void
type ChildrenGetter<T extends Node<T>> = (node: T) => T[] | undefined

export function renderTree<T extends Node<T>>(
  root: T,
  getChildren: ChildrenGetter<T>,
  renderNode: NodeRenderer<T>
): void {
  function renderSubtree(
    node: T,
    thisPrefix: string,
    nextPrefix: string
  ): void {
    // Render the current node
    renderNode(node, thisPrefix)

    // Get children of the current node
    const children = getChildren(node)

    if (children) {
      // Iterate through children
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        const isLastChild = i === children.length - 1

        // Prepare the prefix for the child
        const childPrefix = nextPrefix + (isLastChild ? ' └─' : ' ├─')
        const childNextPrefix = nextPrefix + (isLastChild ? '   ' : ' │ ')

        // Recursively render the child's subtree
        renderSubtree(child, childPrefix, childNextPrefix)
      }
    }
  }

  // Start rendering from the root
  renderSubtree(root, '', '')
}

export function linkVersions<T extends Node<T>>(parent: T, child: T): T {
  if (parent === child) {
    throw new Error('Cannot link a node to itself.')
  }
  if (child.parent) {
    if (child.parent === parent) {
      return child
    } else {
      throw new Error('Child already has a parent.')
    }
  }
  child.parent = parent
  if (!parent.children.includes(child)) {
    parent.children.push(child)
  }
  return child
}

export function visit<T extends Node<T>>(node: T, fn: (v: T) => void): void {
  // Visit version.
  fn(node)

  // Visit children.
  for (const child of node.children) {
    visit(child, fn)
  }
}
