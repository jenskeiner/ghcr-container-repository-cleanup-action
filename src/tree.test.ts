import { visit, linkVersions, renderTree, Node } from './tree'

describe('visit function', () => {
  class TestNode implements Node<TestNode> {
    id: number
    name: string
    children: TestNode[]
    parent: TestNode | null

    constructor(
      id: number,
      name: string,
      children: TestNode[] = [],
      parent: TestNode | null = null
    ) {
      this.id = id
      this.name = name
      this.children = children
      this.parent = parent
    }
  }

  const createNode = (
    id: number,
    name: string,
    children: TestNode[] = [],
    parent: TestNode | null = null
  ): TestNode => ({
    id,
    name,
    children,
    parent
  })

  it('should visit all nodes in a simple tree', () => {
    const root = createNode(1, 'root', [
      createNode(2, 'child1'),
      createNode(3, 'child2')
    ])

    const visited: number[] = []
    visit(root, v => visited.push(v.id))

    expect(visited).toEqual([1, 2, 3])
  })

  it('should visit all nodes in a complex tree', () => {
    const root = createNode(1, 'root', [
      createNode(2, 'child1', [
        createNode(4, 'grandchild1'),
        createNode(5, 'grandchild2')
      ]),
      createNode(3, 'child2', [createNode(6, 'grandchild3')])
    ])

    const visited: number[] = []
    visit(root, v => visited.push(v.id))

    expect(visited).toEqual([1, 2, 4, 5, 3, 6])
  })

  it('should handle a tree with a single node', () => {
    const root = createNode(1, 'root')

    const visited: number[] = []
    visit(root, v => visited.push(v.id))

    expect(visited).toEqual([1])
  })

  it('should call the provided function for each node', () => {
    const root = createNode(1, 'root', [
      createNode(2, 'child1'),
      createNode(3, 'child2')
    ])

    const mockFn = jest.fn()
    visit(root, mockFn)

    expect(mockFn).toHaveBeenCalledTimes(3)
    expect(mockFn).toHaveBeenCalledWith(root)
    expect(mockFn).toHaveBeenCalledWith(root.children[0])
    expect(mockFn).toHaveBeenCalledWith(root.children[1])
  })
})

describe('renderTree', () => {
  // Helper function to capture console.log output
  function captureConsoleLog(fn: () => void): string[] {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (message: string) => logs.push(message)
    fn()
    console.log = originalLog
    return logs
  }

  test('renders a tree with single root and no children', () => {
    const root = { value: 'Root' }
    const getChildren = (_node: any): any[] => []
    const renderNode = (node: any, prefix: string): void =>
      console.log(`${prefix}${node.value}`)

    const output = captureConsoleLog(() =>
      renderTree(root, getChildren, renderNode)
    )

    expect(output).toEqual(['Root'])
  })

  test('renders a tree with root and multiple children', () => {
    const root = {
      value: 'Root',
      children: [{ value: 'Child 1' }, { value: 'Child 2' }]
    }
    const getChildren = (node: any): any[] => node.children
    const renderNode = (node: any, prefix: string): void =>
      console.log(`${prefix}${node.value}`)

    const output = captureConsoleLog(() =>
      renderTree(root, getChildren, renderNode)
    )

    expect(output).toEqual(['Root', ' ├─Child 1', ' └─Child 2'])
  })

  test('renders a tree with multiple levels of nesting', () => {
    const root = {
      value: 'Root',
      children: [
        {
          value: 'Child 1',
          children: [{ value: 'Grandchild 1.1' }, { value: 'Grandchild 1.2' }]
        },
        { value: 'Child 2' }
      ]
    }
    const getChildren = (node: any): any[] => node.children
    const renderNode = (node: any, prefix: string): void =>
      console.log(`${prefix}${node.value}`)

    const output = captureConsoleLog(() =>
      renderTree(root, getChildren, renderNode)
    )

    expect(output).toEqual([
      'Root',
      ' ├─Child 1',
      ' │  ├─Grandchild 1.1',
      ' │  └─Grandchild 1.2',
      ' └─Child 2'
    ])
  })

  test('renders an empty tree (edge case)', () => {
    const root = null
    const getChildren = (_node: any): any[] => []
    const renderNode = (node: any, prefix: string): void =>
      console.log(`${prefix}${node}`)

    const output = captureConsoleLog(() =>
      renderTree(root, getChildren, renderNode)
    )

    expect(output).toEqual(['null'])
  })

  test('renders a tree with custom node rendering', () => {
    const getChildren = (node: any): any[] => node.children
    const renderNode = (node: any, prefix: string): void =>
      console.log(`${prefix}[${node.id}] ${node.name}`)

    const tree = {
      id: 1,
      name: 'Root',
      children: [
        { id: 2, name: 'Child 1' },
        {
          id: 3,
          name: 'Child 2',
          children: [{ id: 4, name: 'Grandchild 2.1' }]
        }
      ]
    }

    const output = captureConsoleLog(() =>
      renderTree(tree, getChildren, renderNode)
    )

    expect(output).toEqual([
      '[1] Root',
      ' ├─[2] Child 1',
      ' └─[3] Child 2',
      '    └─[4] Grandchild 2.1'
    ])
  })
})

// Define a simple Node implementation for testing
class TestNode implements Node<TestNode> {
  children: TestNode[] = []
  parent: TestNode | null = null
  constructor(public value: string) {}
}

// Define another Node implementation with additional properties
class ExtendedNode implements Node<ExtendedNode> {
  children: ExtendedNode[] = []
  parent: ExtendedNode | null = null
  constructor(
    public id: number,
    public name: string
  ) {}
}

describe('linkVersions', () => {
  it('should link a child to a parent with no existing children', () => {
    const parent = new TestNode('parent')
    const child = new TestNode('child')

    const result = linkVersions(parent, child)

    expect(child.parent).toBe(parent)
    expect(parent.children).toContain(child)
    expect(parent.children.length).toBe(1)
    expect(result).toBe(child)
  })

  it('should link a child to a parent with existing children', () => {
    const parent = new TestNode('parent')
    const existingChild = new TestNode('existing')
    parent.children.push(existingChild)
    existingChild.parent = parent

    const newChild = new TestNode('new')

    const result = linkVersions(parent, newChild)

    expect(newChild.parent).toBe(parent)
    expect(parent.children).toContain(newChild)
    expect(parent.children.length).toBe(2)
    expect(parent.children).toContain(existingChild)
    expect(result).toBe(newChild)
  })

  it('should link multiple children to the same parent', () => {
    const parent = new TestNode('parent')
    const child1 = new TestNode('child1')
    const child2 = new TestNode('child2')
    const child3 = new TestNode('child3')

    linkVersions(parent, child1)
    linkVersions(parent, child2)
    linkVersions(parent, child3)

    expect(child1.parent).toBe(parent)
    expect(child2.parent).toBe(parent)
    expect(child3.parent).toBe(parent)
    expect(parent.children).toContain(child1)
    expect(parent.children).toContain(child2)
    expect(parent.children).toContain(child3)
    expect(parent.children.length).toBe(3)
  })

  it('should return the child node', () => {
    const parent = new TestNode('parent')
    const child = new TestNode('child')

    const result = linkVersions(parent, child)

    expect(result).toBe(child)
  })

  it('should not affect other properties of parent or child', () => {
    const parent = new TestNode('parent')
    const child = new TestNode('child')

    linkVersions(parent, child)

    expect(parent.value).toBe('parent')
    expect(child.value).toBe('child')
  })

  it('should throw an error when trying to link a node to itself', () => {
    const node = new TestNode('self')

    expect(() => linkVersions(node, node)).toThrow(
      'Cannot link a node to itself.'
    )
  })

  it('should throw an error when the child already has a different parent', () => {
    const parent1 = new TestNode('parent1')
    const parent2 = new TestNode('parent2')
    const child = new TestNode('child')

    linkVersions(parent1, child)

    expect(() => linkVersions(parent2, child)).toThrow(
      'Child already has a parent.'
    )
  })

  it('should return the child when trying to link a child to its existing parent', () => {
    const parent = new TestNode('parent')
    const child = new TestNode('child')

    linkVersions(parent, child)
    const result = linkVersions(parent, child)

    expect(result).toBe(child)
    expect(parent.children.length).toBe(1) // Ensure child is not added twice
  })

  it("should not add the child to parent's children array if it's already there", () => {
    const parent = new TestNode('parent')
    const child = new TestNode('child')

    linkVersions(parent, child)
    linkVersions(parent, child)

    expect(parent.children.length).toBe(1)
    expect(parent.children[0]).toBe(child)
  })

  it('should work with different types that extend Node<T>', () => {
    const parent = new ExtendedNode(1, 'parent')
    const child = new ExtendedNode(2, 'child')

    const result = linkVersions(parent, child)

    expect(child.parent).toBe(parent)
    expect(parent.children).toContain(child)
    expect(parent.children.length).toBe(1)
    expect(result).toBe(child)
    expect(parent.id).toBe(1)
    expect(parent.name).toBe('parent')
    expect(child.id).toBe(2)
    expect(child.name).toBe('child')
  })
})
