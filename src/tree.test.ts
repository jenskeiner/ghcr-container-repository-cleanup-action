import { renderTree } from './tree'

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
