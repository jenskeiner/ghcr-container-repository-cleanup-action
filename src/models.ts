const mediaTypes = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json'
]

export function isValidMediaType(value: unknown): value is MediaType {
  return mediaTypes.includes(value as MediaType)
}

export type MediaType =
  | 'application/vnd.oci.image.manifest.v1+json'
  | 'application/vnd.oci.image.index.v1+json'
  | 'application/vnd.docker.distribution.manifest.list.v2+json'
  | 'application/vnd.docker.distribution.manifest.v2+json'

// export type MediaType = (typeof mediaTypes)[number]

export interface ManifestSchemaInterface {
  mediaType: MediaType
}

export enum ManifestType {
  SingleArchitecture,
  MultiArchitecture
}

export interface Manifest extends ManifestSchemaInterface {
  get type(): ManifestType
}

abstract class BaseSingleArchitectureManifest {
  get type(): ManifestType {
    return ManifestType.SingleArchitecture
  }
}

abstract class BaseMultiArchitectureManifest {
  get type(): ManifestType {
    return ManifestType.MultiArchitecture
  }
}

export class OCIImageManifestModel
  extends BaseSingleArchitectureManifest
  implements Manifest
{
  mediaType = 'application/vnd.oci.image.manifest.v1+json' as const

  constructor(data: ManifestSchemaInterface) {
    super()
    Object.assign(this, data)
  }
}

export class OCIImageIndexModel
  extends BaseMultiArchitectureManifest
  implements Manifest
{
  mediaType = 'application/vnd.oci.image.index.v1+json' as const

  constructor(data: ManifestSchemaInterface) {
    super()
    Object.assign(this, data)
  }
}

export class DockerManifestListModel
  extends BaseMultiArchitectureManifest
  implements Manifest
{
  mediaType =
    'application/vnd.docker.distribution.manifest.list.v2+json' as const

  constructor(data: ManifestSchemaInterface) {
    super()
    Object.assign(this, data)
  }
}

export class DockerImageManifestModel
  extends BaseSingleArchitectureManifest
  implements Manifest
{
  mediaType = 'application/vnd.docker.distribution.manifest.v2+json' as const

  constructor(data: ManifestSchemaInterface) {
    super()
    Object.assign(this, data)
  }
}

export interface PackageVersionMetadata {
  package_type: string
  container: {
    tags: string[]
  }
}

export class PackageVersionMetadataModel implements PackageVersionMetadata {
  package_type: string = 'container' as const
  container: {
    tags: string[]
  } = {
    tags: []
  }

  constructor(data: PackageVersionMetadata) {
    Object.assign(this, data)
  }
}

export interface PackageVersion {
  id: number
  name: string
  url: string
  package_html_url: string
  created_at: string
  updated_at: string
  html_url: string
  metadata: PackageVersionMetadata
}

export class PackageVersionModel implements PackageVersion {
  id = 0
  name = ''
  url = ''
  package_html_url = ''
  created_at = ''
  updated_at = ''
  html_url = ''
  metadata: PackageVersionMetadata = new PackageVersionMetadataModel({
    package_type: 'container',
    container: {
      tags: []
    }
  })

  constructor(data: PackageVersion) {
    Object.assign(this, data)
  }
}
