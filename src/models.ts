export type MediaType =
  | 'application/vnd.oci.image.manifest.v1+json'
  | 'application/vnd.oci.image.index.v1+json'
  | 'application/vnd.docker.distribution.manifest.list.v2+json'
  | 'application/vnd.docker.distribution.manifest.v2+json'

export interface ManifestReference {
  mediaType: string
  digest: string
}

export interface Manifest {
  mediaType: MediaType
  manifests?: ManifestReference[]
  layers?: ManifestReference[]
}

export interface ManifestExt extends Manifest {
  children: string[]
}

abstract class BaseManifest {
  children: string[]

  constructor(children: string[] = []) {
    this.children = children
  }
}

export class OCIImageManifestModel extends BaseManifest implements ManifestExt {
  mediaType = 'application/vnd.oci.image.manifest.v1+json' as const

  constructor(data: Manifest) {
    super()
    Object.assign(this, data)
  }
}

export class OCIImageIndexModel extends BaseManifest implements ManifestExt {
  mediaType = 'application/vnd.oci.image.index.v1+json' as const

  constructor(data: Manifest) {
    super(data.manifests ? data.manifests.map(manifest => manifest.digest) : [])
    Object.assign(this, data)
  }
}

export class DockerManifestListModel
  extends BaseManifest
  implements ManifestExt
{
  mediaType =
    'application/vnd.docker.distribution.manifest.list.v2+json' as const

  constructor(data: Manifest) {
    super(data.manifests ? data.manifests.map(manifest => manifest.digest) : [])
    Object.assign(this, data)
  }
}

export class DockerImageManifestModel
  extends BaseManifest
  implements ManifestExt
{
  mediaType = 'application/vnd.docker.distribution.manifest.v2+json' as const

  constructor(data: Manifest) {
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

export type PackageVersionType =
  | 'multi-arch image'
  | 'single-arch image'
  | 'attestation root'
  | 'attestation child'
  | 'Docker attestation'
  | 'unknown'

export interface PackageVersionExt extends PackageVersion {
  get is_attestation(): boolean
  children: PackageVersionExt[]
  parent: PackageVersionExt | null
  type: PackageVersionType
  manifest: ManifestExt | undefined
}

export class PackageVersionModel implements PackageVersionExt {
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
  children: PackageVersionExt[] = []
  parent: PackageVersionExt | null = null
  type: PackageVersionType = 'unknown'
  manifest: ManifestExt | undefined = undefined

  constructor(data: PackageVersion) {
    Object.assign(this, data)
  }

  get is_attestation(): boolean {
    return this.type === 'attestation root' || this.type === 'attestation child'
  }

  toString(): string {
    return `{type=${this.type}, id=${this.id}, tags=${this.metadata.container.tags}}`
  }
}
