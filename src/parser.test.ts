import { parseManifest, parsePackageVersion } from './parser'
import {
  OCIImageIndexModel,
  OCIImageManifestModel,
  DockerImageManifestModel,
  DockerManifestListModel,
  PackageVersionModel
} from './models'

describe('parseManifest', () => {
  test('should parse OCI Image Manifest', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: 'sha256:1234567890abcdef',
        size: 1000
      },
      layers: [
        {
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest: 'sha256:0987654321fedcba',
          size: 2000
        }
      ]
    })
    const result = parseManifest(input)
    expect(result).toBeInstanceOf(OCIImageManifestModel)
    expect(result.mediaType).toBe('application/vnd.oci.image.manifest.v1+json')
  })

  test('should parse OCI Image Index', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [
        {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: 'sha256:1234567890abcdef',
          size: 1000
        }
      ]
    })
    const result = parseManifest(input)
    expect(result).toBeInstanceOf(OCIImageIndexModel)
    expect(result.mediaType).toBe('application/vnd.oci.image.index.v1+json')
  })

  test('should parse Docker Manifest List', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
      manifests: [
        {
          mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
          digest: 'sha256:1234567890abcdef',
          size: 1000
        }
      ]
    })
    const result = parseManifest(input)
    expect(result).toBeInstanceOf(DockerManifestListModel)
    expect(result.mediaType).toBe(
      'application/vnd.docker.distribution.manifest.list.v2+json'
    )
  })

  test('should parse Docker Image Manifest', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      config: {
        mediaType: 'application/vnd.docker.container.image.v1+json',
        digest: 'sha256:1234567890abcdef',
        size: 1000
      },
      layers: [
        {
          mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
          digest: 'sha256:0987654321fedcba',
          size: 2000
        }
      ]
    })
    const result = parseManifest(input)
    expect(result).toBeInstanceOf(DockerImageManifestModel)
    expect(result.mediaType).toBe(
      'application/vnd.docker.distribution.manifest.v2+json'
    )
  })

  test('should throw error for invalid JSON', () => {
    expect(() => parseManifest('invalid json')).toThrow('Invalid JSON data')
  })

  test('should throw error for unknown media type', () => {
    const input = JSON.stringify({
      mediaType: 'application/unknown'
    })
    expect(() => parseManifest(input)).toThrow('Invalid JSON data')
  })

  test('should throw error for empty string', () => {
    expect(() => parseManifest('')).toThrow('Invalid JSON data')
  })

  test('should throw error for undefined input', () => {
    expect(() => parseManifest(undefined as any)).toThrow('Invalid JSON data')
  })

  test('should throw error for null input', () => {
    expect(() => parseManifest(null as any)).toThrow('Invalid JSON data')
  })
})

describe('parsePackageVersion', () => {
  test('should parse valid package version', () => {
    const input = JSON.stringify({
      id: 1,
      name: 'package-1.0.0',
      url: 'https://example.com/package-1.0.0',
      package_html_url: 'https://example.com/package',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com/package-1.0.0',
      metadata: {
        package_type: 'container',
        container: {
          tags: ['latest', '1.0.0']
        }
      }
    })
    const result = parsePackageVersion(input)
    expect(result).toBeInstanceOf(PackageVersionModel)
    expect(result.id).toBe(1)
    expect(result.name).toBe('package-1.0.0')
    expect(result.metadata.container.tags).toEqual(['latest', '1.0.0'])
  })

  test('should parse package version with minimal required fields', () => {
    const input = JSON.stringify({
      id: 1,
      name: 'package-1.0.0',
      url: 'https://example.com/package-1.0.0',
      package_html_url: 'https://example.com/package',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com/package-1.0.0',
      metadata: {
        package_type: 'container',
        container: {
          tags: []
        }
      }
    })
    const result = parsePackageVersion(input)
    expect(result).toBeInstanceOf(PackageVersionModel)
    expect(result.id).toBe(1)
    expect(result.name).toBe('package-1.0.0')
    expect(result.metadata.container.tags).toEqual([])
  })

  test('should throw error for invalid JSON', () => {
    expect(() => parsePackageVersion('invalid json')).toThrow(
      'Invalid JSON data'
    )
  })

  test('should throw error for missing required fields', () => {
    const input = JSON.stringify({
      id: 1,
      name: 'package-1.0.0'
    })
    expect(() => parsePackageVersion(input)).toThrow('Invalid JSON data')
  })

  test('should throw error for empty string', () => {
    expect(() => parsePackageVersion('')).toThrow('Invalid JSON data')
  })

  test('should throw error for undefined input', () => {
    expect(() => parsePackageVersion(undefined as any)).toThrow(
      'Invalid JSON data'
    )
  })

  test('should throw error for null input', () => {
    expect(() => parsePackageVersion(null as any)).toThrow('Invalid JSON data')
  })
})

describe('parseManifest - Zod specific', () => {
  test('should handle additional properties correctly', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      layers: [],
      customField: 'should be preserved'
    })
    const result = parseManifest(input)
    expect((result as any).customField).toBe('should be preserved')
  })

  test('should validate mediaType enum strictly', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.custom.type+json',
      layers: []
    })
    expect(() => parseManifest(input)).toThrow('Invalid JSON data')
  })

  test('should preserve additional properties in nested objects', () => {
    const input = JSON.stringify({
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [
        {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: 'sha256:1234567890abcdef',
          customNestedField: 'preserved'
        }
      ],
      customTopLevel: 'also preserved'
    })
    const result = parseManifest(input)
    expect((result as any).customTopLevel).toBe('also preserved')
    const manifests = (result as any).manifests
    expect(manifests[0].customNestedField).toBe('preserved')
  })
})

describe('parsePackageVersion - Zod specific', () => {
  test('should validate id is integer', () => {
    const input = JSON.stringify({
      id: 1.5, // float instead of int
      name: 'package-1.0.0',
      url: 'https://example.com',
      package_html_url: 'https://example.com',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com',
      metadata: {
        package_type: 'container',
        container: { tags: [] }
      }
    })
    expect(() => parsePackageVersion(input)).toThrow('Invalid JSON data')
  })

  test('should validate nested container.tags is array', () => {
    const input = JSON.stringify({
      id: 1,
      name: 'package-1.0.0',
      url: 'https://example.com',
      package_html_url: 'https://example.com',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com',
      metadata: {
        package_type: 'container',
        container: { tags: 'not-an-array' }
      }
    })
    expect(() => parsePackageVersion(input)).toThrow('Invalid JSON data')
  })

  test('should handle additional properties correctly', () => {
    const input = JSON.stringify({
      id: 1,
      name: 'package-1.0.0',
      url: 'https://example.com',
      package_html_url: 'https://example.com',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com',
      metadata: {
        package_type: 'container',
        container: { tags: [], customField: 'preserved' }
      },
      customTopLevel: 'also preserved'
    })
    const result = parsePackageVersion(input)
    expect((result as any).customTopLevel).toBe('also preserved')
    expect((result.metadata.container as any).customField).toBe('preserved')
  })

  test('should reject non-integer id values', () => {
    const input = JSON.stringify({
      id: '1', // string instead of number
      name: 'package-1.0.0',
      url: 'https://example.com',
      package_html_url: 'https://example.com',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com',
      metadata: {
        package_type: 'container',
        container: { tags: [] }
      }
    })
    expect(() => parsePackageVersion(input)).toThrow('Invalid JSON data')
  })

  test('should reject non-array tags', () => {
    const input = JSON.stringify({
      id: 1,
      name: 'package-1.0.0',
      url: 'https://example.com',
      package_html_url: 'https://example.com',
      created_at: '2023-05-01T12:00:00Z',
      updated_at: '2023-05-01T12:00:00Z',
      html_url: 'https://example.com',
      metadata: {
        package_type: 'container',
        container: { tags: null }
      }
    })
    expect(() => parsePackageVersion(input)).toThrow('Invalid JSON data')
  })
})
