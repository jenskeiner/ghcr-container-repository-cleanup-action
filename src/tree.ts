type NodeRenderer<T> = (node: T, prefix: string) => void
type ChildrenGetter<T> = (node: T) => T[] | undefined

export function renderTree<T>(
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
