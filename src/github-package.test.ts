import {
  ManifestHolder,
  ManifestReference,
  MediaType,
  PackageMetadataHolder,
  PackageVersionExt,
  Manifest
} from './models'
import {
  getManifestChildren,
  discoverAndLinkManifestChildren,
  discoverAndLinkReferrers,
  discoverAndLinkReferrerTags,
  getArtifactType,
  scanRoots,
  GithubPackageRepo
} from './github-package'
import { Node } from './tree'
import axios, { AxiosInstance, AxiosStatic } from 'axios'
import axiosRetry, { IAxiosRetryConfig } from 'axios-retry'
import { Config } from './config'

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
    children: []
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
    children: []
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
  })

  it('should not link versions with non-existent subjects', () => {
    const v1 = createTestVersion('v1', 'non-existent')
    const versions = new Set([v1])
    const getVersion = jest.fn().mockReturnValue(undefined)

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual([])
    expect(getVersion).toHaveBeenCalledWith('non-existent')
  })

  it('should link versions with existing subjects', () => {
    const v1 = createTestVersion('v1', 'subject1')
    const v2 = createTestVersion('v2')
    const versions = new Set([v1, v2])
    const getVersion = jest.fn().mockReturnValue(v2)

    const result = discoverAndLinkReferrers(versions, getVersion)

    expect(result).toEqual([v1])
    expect(getVersion).toHaveBeenCalledWith('subject1')
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
  })
})

describe('getArtifactType', () => {
  // Helper function to create a basic PackageVersionExt object
  const createPackageVersionExt = (
    manifest: Partial<Manifest>,
    tags: string[] = []
  ): PackageVersionExt =>
    ({
      manifest: manifest as Manifest,
      metadata: {
        container: {
          tags
        }
      }
    }) as PackageVersionExt

  test('should return "single-arch image" for manifest with layers', () => {
    const version = createPackageVersionExt({
      layers: [
        {
          mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
          digest: 'sha256:1234567890abcdef'
        }
      ]
    })
    expect(getArtifactType(version)).toBe('single-arch image')
  })

  test('should return "multi-arch image" for manifest with child manifests', () => {
    const version = createPackageVersionExt({
      manifests: [
        {
          digest: 'sha256:1234567890abcdef',
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json'
        },
        {
          digest: 'sha256:abcdef1234567890',
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json'
        }
      ]
    })
    expect(getArtifactType(version)).toBe('multi-arch image')
  })

  test('should return "attestation" for manifest with all layers of type application/vnd.in-toto+json', () => {
    const version = createPackageVersionExt({
      layers: [
        {
          mediaType: 'application/vnd.in-toto+json',
          digest: 'sha256:1234567890abcdef'
        },
        {
          mediaType: 'application/vnd.in-toto+json',
          digest: 'sha256:abcdef1234567890'
        }
      ]
    })
    expect(getArtifactType(version)).toBe('attestation')
  })

  test('should return "attestation" for manifest with subject', () => {
    const version = createPackageVersionExt({
      subject: {
        digest: 'sha256:1234567890abcdef',
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json'
      }
    })
    expect(getArtifactType(version)).toBe('attestation')
  })

  test('should return "attestation" for version with referrer tag schema', () => {
    const version = createPackageVersionExt({}, [
      'sha256-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    ])
    expect(getArtifactType(version)).toBe('attestation')
  })

  test('should return "unknown" for manifest without layers, manifests, subject, or referrer tag schema', () => {
    const version = createPackageVersionExt({})
    expect(getArtifactType(version)).toBe('unknown')
  })

  test('should return "single-arch image" for manifest with mixed layer types', () => {
    const version = createPackageVersionExt({
      layers: [
        {
          mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
          digest: 'sha256:1234567890abcdef'
        },
        {
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest: 'sha256:abcdef1234567890'
        }
      ]
    })
    expect(getArtifactType(version)).toBe('single-arch image')
  })

  test('should prioritize attestation check over single-arch image', () => {
    const version = createPackageVersionExt({
      layers: [
        {
          mediaType: 'application/vnd.in-toto+json',
          digest: 'sha256:1234567890abcdef'
        },
        {
          mediaType: 'application/vnd.in-toto+json',
          digest: 'sha256:abcdef1234567890'
        }
      ],
      subject: {
        digest: 'sha256:1234567890abcdef',
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json'
      }
    })
    expect(getArtifactType(version)).toBe('attestation')
  })

  test('should return "unknown" for empty manifest', () => {
    const version = createPackageVersionExt({
      manifests: []
    })
    expect(getArtifactType(version)).toBe('unknown')
  })
})

describe('scanRoots', () => {
  // Helper function to create a basic PackageVersionExt object
  const createPackageVersionExt = (
    id: number,
    name: string,
    manifest: Partial<Manifest>,
    tags: string[] = []
  ): PackageVersionExt =>
    ({
      id,
      name,
      manifest: manifest as Manifest,
      metadata: {
        package_type: 'container',
        container: {
          tags
        }
      },
      children: [],
      parent: null,
      type: 'unknown',
      package_html_url: '',
      created_at: '',
      updated_at: '',
      html_url: '',
      url: '',
      is_attestation: false
    }) as PackageVersionExt

  let uniqueVersions: Set<PackageVersionExt>
  let getVersion: jest.Mock

  beforeEach(() => {
    uniqueVersions = new Set()
    getVersion = jest.fn()
  })

  test('should return empty set when no versions are provided', () => {
    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(0)
  })

  test('should correctly identify root versions', () => {
    const version1 = createPackageVersionExt(1, 'v1', {
      layers: [{ mediaType: 'application/layer', digest: 'foo' }]
    })
    const version2 = createPackageVersionExt(2, 'v2', {
      layers: [{ mediaType: 'application/layer', digest: 'bar' }]
    })

    uniqueVersions.add(version1)
    uniqueVersions.add(version2)

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(2)
    expect(result.has(version1)).toBe(true)
    expect(result.has(version2)).toBe(true)
  })

  test('should correctly link manifest children', () => {
    const parent = createPackageVersionExt(1, 'parent', {
      manifests: [{ digest: 'child', mediaType: 'foo' }]
    })
    const child = createPackageVersionExt(2, 'child', {
      layers: [{ digest: 'bar', mediaType: 'application/layer' }]
    })

    uniqueVersions.add(parent)
    uniqueVersions.add(child)
    getVersion.mockImplementation(key => (key === 'child' ? child : undefined))

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(1)
    expect(result.has(parent)).toBe(true)
    expect(parent.children).toContain(child)
  })

  test('should correctly link referrers', () => {
    const subject = createPackageVersionExt(1, 'subject', {
      layers: [{ mediaType: 'application/layer', digest: 'foo' }]
    })
    const referrer = createPackageVersionExt(2, 'referrer', {
      subject: { digest: 'subject', mediaType: 'foo' }
    })

    uniqueVersions.add(subject)
    uniqueVersions.add(referrer)
    getVersion.mockImplementation(key =>
      key === 'subject' ? subject : undefined
    )

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(1)
    expect(result.has(subject)).toBe(true)
    expect(subject.children).toContain(referrer)
  })

  test('should correctly link referrer tags', () => {
    const target = createPackageVersionExt(
      1,
      'target',
      { layers: [{ mediaType: 'application/layer', digest: 'foo' }] },
      ['target-tag']
    )
    const referrer = createPackageVersionExt(
      2,
      'referrer',
      {
        layers: [{ mediaType: 'application/vnd.in-toto+json', digest: 'foo' }]
      },
      ['sha256-1234567890abcdef']
    )

    uniqueVersions.add(target)
    uniqueVersions.add(referrer)
    getVersion.mockImplementation(key =>
      key === 'sha256:1234567890abcdef' ? target : undefined
    )

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(1)
    expect(result.has(target)).toBe(true)
    expect(target.children).toContain(referrer)
  })

  test('should correctly set artifact types', () => {
    const singleArch = createPackageVersionExt(1, 'single', {
      layers: [{ mediaType: 'application/layer', digest: 'foo' }]
    })
    const multiArch = createPackageVersionExt(2, 'multi', {
      manifests: [{ digest: 'child', mediaType: 'foo' }]
    })
    const attestation = createPackageVersionExt(3, 'attest', {
      layers: [{ mediaType: 'application/vnd.in-toto+json', digest: 'foo' }]
    })

    uniqueVersions.add(singleArch)
    uniqueVersions.add(multiArch)
    uniqueVersions.add(attestation)

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(3)
    expect(singleArch.type).toBe('single-arch image')
    expect(multiArch.type).toBe('multi-arch image')
    expect(attestation.type).toBe('attestation')
  })

  test('should handle complex hierarchies', () => {
    const root = createPackageVersionExt(1, 'root', {
      manifests: [
        { digest: 'child1', mediaType: 'foo' },
        { digest: 'child2', mediaType: 'foo' }
      ]
    })
    const child1 = createPackageVersionExt(2, 'child1', {
      layers: [{ digest: 'bar', mediaType: 'application/layer' }]
    })
    const child2 = createPackageVersionExt(3, 'child2', {
      layers: [{ digest: 'baz', mediaType: 'application/layer' }]
    })
    const attestation = createPackageVersionExt(4, 'attestation', {
      subject: { digest: 'root', mediaType: 'foo' },
      layers: [{ mediaType: 'application/vnd.in-toto+json', digest: 'qux' }]
    })

    uniqueVersions.add(root)
    uniqueVersions.add(child1)
    uniqueVersions.add(child2)
    uniqueVersions.add(attestation)

    getVersion.mockImplementation(key => {
      switch (key) {
        case 'child1':
          return child1
        case 'child2':
          return child2
        case 'root':
          return root
        default:
          return undefined
      }
    })

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(1)
    expect(result.has(root)).toBe(true)
    expect(root.children).toContain(child1)
    expect(root.children).toContain(child2)
    expect(root.children).toContain(attestation)
  })

  test('should handle orphaned versions', () => {
    const root = createPackageVersionExt(1, 'root', {
      manifests: [{ digest: 'child', mediaType: 'foo' }]
    })
    const child = createPackageVersionExt(2, 'child', {
      layers: [{ digest: 'bar', mediaType: 'application/layer' }]
    })
    const orphan = createPackageVersionExt(3, 'orphan', {
      layers: [{ digest: 'baz', mediaType: 'application/layer' }]
    })

    uniqueVersions.add(root)
    uniqueVersions.add(child)
    uniqueVersions.add(orphan)

    getVersion.mockImplementation(key => (key === 'child' ? child : undefined))

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(2)
    expect(result.has(root)).toBe(true)
    expect(result.has(orphan)).toBe(true)
    expect(root.children).toContain(child)
  })

  test('should handle versions with multiple parents', () => {
    const parent1 = createPackageVersionExt(1, 'parent1', {
      manifests: [{ digest: 'child', mediaType: 'foo' }]
    })
    const parent2 = createPackageVersionExt(2, 'parent2', {
      manifests: [{ digest: 'child', mediaType: 'foo' }]
    })
    const child = createPackageVersionExt(3, 'child', {
      layers: [{ digest: 'bar', mediaType: 'application/layer' }]
    })

    uniqueVersions.add(parent1)
    uniqueVersions.add(parent2)
    uniqueVersions.add(child)

    getVersion.mockImplementation(key => (key === 'child' ? child : undefined))

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(2)
    expect(result.has(parent1)).toBe(true)
    expect(result.has(parent2)).toBe(true)
    expect(parent1.children).toContain(child)
    expect(parent2.children).toContain(child)
  })

  test('should handle long chains of versions', () => {
    const versions = Array.from({ length: 100 }, (_, i) =>
      createPackageVersionExt(
        i + 1,
        `v${i + 1}`,
        i === 99
          ? { layers: [{ digest: 'foo', mediaType: 'application/layer' }] }
          : { manifests: [{ digest: `v${i + 2}`, mediaType: 'foo' }] }
      )
    )

    for (const v of versions) uniqueVersions.add(v)

    getVersion.mockImplementation(key => versions.find(v => v.name === key))

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(1)
    expect(result.has(versions[0])).toBe(true)

    // Check that the chain is correctly linked
    for (let i = 0; i < 99; i++) {
      expect(versions[i].children).toContain(versions[i + 1])
    }
  })

  test('should handle mixed artifact types in hierarchy', () => {
    const root = createPackageVersionExt(1, 'root', {
      manifests: [
        { digest: 'child1', mediaType: 'foo' },
        { digest: 'child2', mediaType: 'foo' }
      ]
    })
    const child1 = createPackageVersionExt(2, 'child1', {
      layers: [{ digest: 'bar', mediaType: 'application/layer' }]
    })
    const child2 = createPackageVersionExt(3, 'child2', {
      manifests: [{ digest: 'grandchild', mediaType: 'foo' }]
    })
    const grandchild = createPackageVersionExt(4, 'grandchild', {
      layers: [{ digest: 'baz', mediaType: 'application/layer' }]
    })
    const attestation = createPackageVersionExt(5, 'attestation', {
      subject: { digest: 'root', mediaType: 'foo' },
      layers: [{ mediaType: 'application/vnd.in-toto+json', digest: 'qux' }]
    })

    uniqueVersions.add(root)
    uniqueVersions.add(child1)
    uniqueVersions.add(child2)
    uniqueVersions.add(grandchild)
    uniqueVersions.add(attestation)

    getVersion.mockImplementation(key => {
      switch (key) {
        case 'child1':
          return child1
        case 'child2':
          return child2
        case 'grandchild':
          return grandchild
        case 'root':
          return root
        default:
          return undefined
      }
    })

    const result = scanRoots(uniqueVersions, getVersion)
    expect(result.size).toBe(1)
    expect(result.has(root)).toBe(true)
    expect(root.children).toContain(child1)
    expect(root.children).toContain(child2)
    expect(root.children).toContain(attestation)
    expect(child2.children).toContain(grandchild)

    expect(root.type).toBe('multi-arch image')
    expect(child1.type).toBe('single-arch image')
    expect(child2.type).toBe('multi-arch image')
    expect(grandchild.type).toBe('single-arch image')
    expect(attestation.type).toBe('attestation')
  })
})

jest.mock('axios')
jest.mock('axios-retry')

const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedAxiosRetry = axiosRetry as jest.MockedFunction<typeof axiosRetry>

describe('GithubPackageRepo', () => {
  let githubPackageRepo: GithubPackageRepo
  let mockConfig: Config
  let mockAxiosInstance: jest.Mocked<typeof axios>

  beforeEach(() => {
    mockConfig = {
      token: 'mock-token',
      owner: 'mock-owner',
      package: 'mock-package'
    } as Config

    mockAxiosInstance = {
      create: jest.fn(),
      get: jest.fn(),
      defaults: {
        headers: {
          common: {}
        }
      },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    } as unknown as jest.Mocked<typeof axios>

    mockedAxios.create.mockReturnValue(mockAxiosInstance)
    mockedAxiosRetry.mockImplementation(
      (
        _axiosInstance: AxiosStatic | AxiosInstance,
        _axiosRetryConfig?: IAxiosRetryConfig | undefined
      ) => {
        return {
          interceptors: {
            request: { use: jest.fn() },
            response: { use: jest.fn() }
          },
          requestInterceptorId: 0,
          responseInterceptorId: 1
        }
      }
    )

    githubPackageRepo = new GithubPackageRepo(mockConfig)
  })

  describe('handleAuthenticationChallenge', () => {
    it('should handle a valid authentication challenge and return a token', async () => {
      const mockChallenge =
        'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/repo:pull"'
      const mockToken = 'mock-access-token'

      const mockAuthAxios = {
        get: jest.fn().mockResolvedValue({ data: { token: mockToken } })
      }
      ;(axios.create as jest.Mock).mockReturnValueOnce(mockAuthAxios)

      const result = await (
        githubPackageRepo as any
      ).handleAuthenticationChallenge(mockChallenge)

      expect(mockAuthAxios.get).toHaveBeenCalledWith(
        'https://ghcr.io/token?service=ghcr.io&scope=repository:user/repo:pull',
        {
          auth: {
            username: 'token',
            password: 'mock-token'
          }
        }
      )
      expect(result).toBe(mockToken)
    })

    it('should throw an error for an invalid authentication challenge', async () => {
      const invalidChallenge = 'Invalid challenge'

      await expect(
        (githubPackageRepo as any).handleAuthenticationChallenge(
          invalidChallenge
        )
      ).rejects.toThrow('invalid www-authenticate challenge Invalid challenge')
    })

    it('should throw an error when login fails', async () => {
      const mockChallenge =
        'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/repo:pull"'

      const mockAuthAxios = {
        get: jest.fn().mockResolvedValue({ data: {} })
      }
      ;(axios.create as jest.Mock).mockReturnValueOnce(mockAuthAxios)

      await expect(
        (githubPackageRepo as any).handleAuthenticationChallenge(mockChallenge)
      ).rejects.toThrow('ghcr.io login failed: [object Object]')
    })

    it('should throw an error when the token request fails', async () => {
      const mockChallenge =
        'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/repo:pull"'
      const mockError = new Error('Request failed')

      const mockAuthAxios = {
        get: jest.fn().mockRejectedValue(mockError)
      }
      ;(axios.create as jest.Mock).mockReturnValueOnce(mockAuthAxios)

      await expect(
        (githubPackageRepo as any).handleAuthenticationChallenge(mockChallenge)
      ).rejects.toThrow('Request failed')
    })
  })
})
