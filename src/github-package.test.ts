import {
  ManifestHolder,
  ManifestReference,
  MediaType,
  PackageMetadataHolder
} from './models'
import {
  getManifestChildren,
  discoverAndLinkManifestChildren,
  discoverAndLinkReferrers,
  discoverAndLinkReferrerTags
} from './github-package'
import { Node } from './tree'

describe('getManifestChildren', () => {
  it('should return an empty array for a manifest without manifests property', () => {
    const version: ManifestHolder = {
      manifest: {
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json'
      }
    }
    expect(getManifestChildren(version)).toEqual([])
  })

  it('should return an array of digests for a manifest with manifests property', () => {
    const version: ManifestHolder = {
      manifest: {
        mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
        manifests: [
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:abc123'
          },
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:def456'
          }
        ]
      }
    }
    expect(getManifestChildren(version)).toEqual([
      'sha256:abc123',
      'sha256:def456'
    ])
  })

  it('should return an empty array for a manifest with empty manifests array', () => {
    const version: ManifestHolder = {
      manifest: {
        mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
        manifests: []
      }
    }
    expect(getManifestChildren(version)).toEqual([])
  })

  it('should handle manifests with missing digest property', () => {
    const version: ManifestHolder = {
      manifest: {
        mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
        manifests: [
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:abc123'
          },
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json'
          } as ManifestReference,
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:def456'
          }
        ]
      }
    }
    expect(getManifestChildren(version)).toEqual([
      'sha256:abc123',
      undefined,
      'sha256:def456'
    ])
  })

  it('should handle manifests with null or undefined digest values', () => {
    const version: ManifestHolder = {
      manifest: {
        mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
        manifests: [
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: null as any
          },
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: undefined as any
          },
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:ghi789'
          }
        ]
      }
    }
    expect(getManifestChildren(version)).toEqual([
      null,
      undefined,
      'sha256:ghi789'
    ])
  })

  it('should handle a manifest with manifests containing non-object elements', () => {
    const version: ManifestHolder = {
      manifest: {
        mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
        manifests: [
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:abc123'
          },
          'not an object' as any,
          {
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            digest: 'sha256:def456'
          }
        ]
      }
    }
    expect(getManifestChildren(version)).toEqual([
      'sha256:abc123',
      undefined,
      'sha256:def456'
    ])
  })
})

// Mock implementation of ManifestHolder & Node
interface TestNode extends ManifestHolder, Node<TestNode> {
  id: string
  manifest: {
    mediaType: MediaType
    manifests?: { mediaType: string; digest: string }[]
  }
  children: TestNode[]
  parent: TestNode | null
}

describe('discoverAndLinkManifestChildren', () => {
  // Helper function to create a test node
  const createTestNode = (
    id: string,
    childDigests: string[] = []
  ): TestNode => ({
    id,
    manifest: {
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      manifests: childDigests.map(digest => ({ mediaType: 'foo', digest }))
    },
    children: [],
    parent: null
  })

  // Helper function to create a getVersion function
  const createGetVersion = (nodes: TestNode[]) => (key: string | number) =>
    nodes.find(node => node.id === key)

  test('empty set of versions', () => {
    const versions = new Set<TestNode>()
    const getVersion = createGetVersion([])
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toEqual([])
  })

  test('single version with no children', () => {
    const node = createTestNode('1')
    const versions = new Set([node])
    const getVersion = createGetVersion([node])
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toEqual([])
  })

  test('single version with children', () => {
    const parent = createTestNode('1', ['2', '3'])
    const child1 = createTestNode('2')
    const child2 = createTestNode('3')
    const versions = new Set([parent, child1, child2])
    const getVersion = createGetVersion([parent, child1, child2])
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toHaveLength(2)
    expect(result).toContain(child1)
    expect(result).toContain(child2)
    expect(parent.children).toEqual([child1, child2])
    expect(child1.parent).toBe(parent)
    expect(child2.parent).toBe(parent)
  })

  test('multiple versions with no children', () => {
    const node1 = createTestNode('1')
    const node2 = createTestNode('2')
    const versions = new Set([node1, node2])
    const getVersion = createGetVersion([node1, node2])
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toEqual([])
  })

  test('multiple versions with children', () => {
    const parent1 = createTestNode('1', ['3', '4'])
    const parent2 = createTestNode('2', ['5', '6'])
    const child1 = createTestNode('3')
    const child2 = createTestNode('4')
    const child3 = createTestNode('5')
    const child4 = createTestNode('6')
    const versions = new Set([parent1, parent2, child1, child2, child3, child4])
    const getVersion = createGetVersion([
      parent1,
      parent2,
      child1,
      child2,
      child3,
      child4
    ])
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toHaveLength(4)
    expect(result).toContain(child1)
    expect(result).toContain(child2)
    expect(result).toContain(child3)
    expect(result).toContain(child4)
    expect(parent1.children).toEqual([child1, child2])
    expect(parent2.children).toEqual([child3, child4])
    expect(child1.parent).toBe(parent1)
    expect(child2.parent).toBe(parent1)
    expect(child3.parent).toBe(parent2)
    expect(child4.parent).toBe(parent2)
  })

  test('versions with circular references', () => {
    const node1 = createTestNode('1', ['2'])
    const node2 = createTestNode('2', ['1'])
    const versions = new Set([node1, node2])
    const getVersion = createGetVersion([node1, node2])
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toHaveLength(2)
    expect(result).toContain(node1)
    expect(result).toContain(node2)
    expect(node1.children).toEqual([node2])
    expect(node2.children).toEqual([node1])
    expect(node1.parent).toBe(node2)
    expect(node2.parent).toBe(node1)
  })

  test('versions with missing children', () => {
    const parent = createTestNode('1', ['2', '3'])
    const child = createTestNode('2')
    const versions = new Set([parent, child])
    const getVersion = createGetVersion([parent, child]) // '3' is missing
    const result = discoverAndLinkManifestChildren(versions, getVersion)
    expect(result).toHaveLength(1)
    expect(result).toContain(child)
    expect(parent.children).toEqual([child])
    expect(child.parent).toBe(parent)
  })
})

// Mock type for testing
interface TestVersion extends ManifestHolder, Node<TestVersion> {
  id: string
  manifest: {
    mediaType: MediaType
    subject?: { mediaType: string; digest: string }
  }
  children: TestVersion[]
  parent: TestVersion | null
}

describe('discoverAndLinkReferrers', () => {
  // Helper function to create a test version
  const createTestVersion = (
    id: string,
    subjectDigest?: string
  ): TestVersion => ({
    id,
    manifest: {
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      subject: subjectDigest
        ? { mediaType: 'foo', digest: subjectDigest }
        : undefined
    },
    children: [],
    parent: null
  })

  it('should return an empty array for an empty set of versions', () => {
    const versions = new Set<TestVersion>()
    const getVersion = jest.fn()

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual([])
    expect(getVersion).not.toHaveBeenCalled()
  })

  it('should not link versions without subjects', () => {
    const v1 = createTestVersion('v1')
    const v2 = createTestVersion('v2')
    const versions = new Set([v1, v2])
    const getVersion = jest.fn()

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual([])
    expect(getVersion).not.toHaveBeenCalled()
    expect(v1.parent).toBeNull()
    expect(v2.parent).toBeNull()
  })

  it('should not link versions with non-existent subjects', () => {
    const v1 = createTestVersion('v1', 'non-existent')
    const versions = new Set([v1])
    const getVersion = jest.fn().mockReturnValue(undefined)

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual([])
    expect(getVersion).toHaveBeenCalledWith('non-existent')
    expect(v1.parent).toBeNull()
  })

  it('should link versions with existing subjects', () => {
    const v1 = createTestVersion('v1', 'subject1')
    const v2 = createTestVersion('v2')
    const versions = new Set([v1, v2])
    const getVersion = jest.fn().mockReturnValue(v2)

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual([v1])
    expect(getVersion).toHaveBeenCalledWith('subject1')
    expect(v1.parent).toBe(v2)
    expect(v2.children).toContain(v1)
  })

  it('should handle multiple versions with the same subject', () => {
    const v1 = createTestVersion('v1', 'subject1')
    const v2 = createTestVersion('v2', 'subject1')
    const v3 = createTestVersion('v3')
    const versions = new Set([v1, v2, v3])
    const getVersion = jest.fn().mockReturnValue(v3)

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toContain(v1)
    expect(result).toContain(v2)
    expect(getVersion).toHaveBeenCalledTimes(2)
    expect(v1.parent).toBe(v3)
    expect(v2.parent).toBe(v3)
    expect(v3.children).toContain(v1)
    expect(v3.children).toContain(v2)
  })

  it('should handle circular references', () => {
    const v1 = createTestVersion('v1', 'v2')
    const v2 = createTestVersion('v2', 'v1')
    const versions = new Set([v1, v2])
    const getVersion = jest
      .fn()
      .mockImplementation(id => (id === 'v1' ? v1 : v2))

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toContain(v1)
    expect(result).toContain(v2)
    expect(getVersion).toHaveBeenCalledTimes(2)
    expect(v1.parent).toBe(v2)
    expect(v2.parent).toBe(v1)
    expect(v1.children).toContain(v2)
    expect(v2.children).toContain(v1)
  })

  it('should handle complex scenarios with multiple links', () => {
    const v1 = createTestVersion('v1', 'v2')
    const v2 = createTestVersion('v2', 'v3')
    const v3 = createTestVersion('v3', 'v4')
    const v4 = createTestVersion('v4')
    const v5 = createTestVersion('v5', 'v4')
    const versions = new Set([v1, v2, v3, v4, v5])
    const getVersion = jest.fn().mockImplementation(id => {
      switch (id) {
        case 'v1':
          return v1
        case 'v2':
          return v2
        case 'v3':
          return v3
        case 'v4':
          return v4
        case 'v5':
          return v5
      }
    })

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual(expect.arrayContaining([v1, v2, v3, v5]))
    expect(getVersion).toHaveBeenCalledTimes(4)
    expect(v1.parent).toBe(v2)
    expect(v2.parent).toBe(v3)
    expect(v3.parent).toBe(v4)
    expect(v4.parent).toBeNull()
    expect(v5.parent).toBe(v4)
    expect(v2.children).toContain(v1)
    expect(v3.children).toContain(v2)
    expect(v4.children).toContain(v3)
    expect(v4.children).toContain(v5)
  })
})

// Mock implementation of PackageMetadataHolder & Node
class MockVersion implements PackageMetadataHolder, Node<MockVersion> {
  digest: string // Holds the digest which in realityis stored in the manifest.
  metadata: { package_type: string; container: { tags: string[] } }
  parent: MockVersion | null = null
  children: MockVersion[] = []

  constructor(digest: string, tags: string[]) {
    this.digest = digest
    this.metadata = { package_type: 'container', container: { tags } }
  }
}

describe('discoverAndLinkReferrerTags', () => {
  let versions: Set<MockVersion>
  let getVersion: (key: string | number) => MockVersion | undefined

  beforeEach(() => {
    versions = new Set()
    getVersion = (key: string | number) => {
      return Array.from(versions).find(
        v =>
          v.digest === key || v.metadata.container.tags.includes(key as string)
      )
    }
  })

  test('should link referrer tags correctly', () => {
    const v1 = new MockVersion('sha256:1cf72a3e3336', ['v1', 'latest'])
    const v2 = new MockVersion('sha256:ea39069f7c2b', ['v2'])
    const v3 = new MockVersion('sha256:8e309f129fd1', [
      'v3',
      'sha256-1cf72a3e3336'
    ])
    versions.add(v1)
    versions.add(v2)
    versions.add(v3)

    const result = discoverAndLinkReferrerTags(versions, getVersion)

    expect(result).toHaveLength(1)
    expect(v1.children).toContain(v3)
    expect(v3.parent).toBe(v1)
  })

  test('should not link to self', () => {
    const v1 = new MockVersion('sha256:1cf72a3e3336', [
      'v1',
      'sha256-1cf72a3e3336'
    ])
    versions.add(v1)

    const result = discoverAndLinkReferrerTags(versions, getVersion)

    expect(result).toHaveLength(0)
    expect(v1.children).toHaveLength(0)
    expect(v1.parent).toBeNull()
  })

  test('should handle multiple referrers', () => {
    const v1 = new MockVersion('sha256:1cf72a3e3336', ['v1'])
    const v2 = new MockVersion('sha256:ea39069f7c2b', [
      'v2',
      'sha256-1cf72a3e3336'
    ])
    const v3 = new MockVersion('sha256:8e309f129fd1', [
      'v3',
      'sha256-1cf72a3e3336'
    ])
    versions.add(v1)
    versions.add(v2)
    versions.add(v3)

    const result = discoverAndLinkReferrerTags(versions, getVersion)

    expect(result).toHaveLength(2)
    expect(v1.children).toContain(v2)
    expect(v1.children).toContain(v3)
    expect(v2.parent).toBe(v1)
    expect(v3.parent).toBe(v1)
  })

  test('should handle versions not in the set', () => {
    const v1 = new MockVersion('sha256:1cf72a3e3336', ['v1'])
    const v2 = new MockVersion('sha256:ea39069f7c2b', [
      'v2',
      'sha256-8e309f129fd1'
    ])
    versions.add(v1)
    versions.add(v2)

    const result = discoverAndLinkReferrerTags(versions, getVersion)

    expect(result).toHaveLength(0)
    expect(v1.children).toHaveLength(0)
    expect(v2.children).toHaveLength(0)
    expect(v1.parent).toBeNull()
    expect(v2.parent).toBeNull()
  })

  test('should handle empty set of versions', () => {
    const result = discoverAndLinkReferrerTags(versions, getVersion)

    expect(result).toHaveLength(0)
  })

  test('should handle versions with no tags', () => {
    const v1 = new MockVersion('sha256:1cf72a3e3336', [])
    const v2 = new MockVersion('sha256:ea39069f7c2b', [])
    versions.add(v1)
    versions.add(v2)

    const result = discoverAndLinkReferrerTags(versions, getVersion)

    expect(result).toHaveLength(0)
    expect(v1.children).toHaveLength(0)
    expect(v2.children).toHaveLength(0)
    expect(v1.parent).toBeNull()
    expect(v2.parent).toBeNull()
  })
})
