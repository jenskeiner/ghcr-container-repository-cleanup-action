import { Node } from './tree'

export type MediaType =
  | 'application/vnd.oci.image.manifest.v1+json'
  | 'application/vnd.oci.image.index.v1+json'
  | 'application/vnd.docker.distribution.manifest.list.v2+json'
  | 'application/vnd.docker.distribution.manifest.v2+json'

export interface ManifestReference {
  digest: string
  mediaType: string
}

export interface Manifest {
  mediaType: MediaType
  manifests?: ManifestReference[]
  layers?: ManifestReference[]
  subject?: ManifestReference
}

export class OCIImageManifestModel implements Manifest {
  mediaType = 'application/vnd.oci.image.manifest.v1+json' as const

  constructor(data: Manifest) {
    Object.assign(this, data)
  }
}

export class OCIImageIndexModel implements Manifest {
  mediaType = 'application/vnd.oci.image.index.v1+json' as const

  constructor(data: Manifest) {
    Object.assign(this, data)
  }
}

export class DockerManifestListModel implements Manifest {
  mediaType =
    'application/vnd.docker.distribution.manifest.list.v2+json' as const

  constructor(data: Manifest) {
    Object.assign(this, data)
  }
}

export class DockerImageManifestModel implements Manifest {
  mediaType = 'application/vnd.docker.distribution.manifest.v2+json' as const

  constructor(data: Manifest) {
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

export interface PackageMetadataHolder {
  metadata: PackageVersionMetadata
}

export interface PackageVersion extends PackageMetadataHolder {
  id: number
  name: string
  url: string
  package_html_url: string
  created_at: string
  updated_at: string
  html_url: string
}

export type PackageVersionType =
  | 'multi-arch image'
  | 'single-arch image'
  | 'attestation'
  | 'unknown'

export interface ManifestHolder {
  manifest: Manifest
}

export interface PackageVersionExtProperties<T extends Node<T>>
  extends Node<T>,
    ManifestHolder {
  type: PackageVersionType
}

export interface PackageVersionExt
  extends PackageVersion,
    PackageVersionExtProperties<PackageVersionExt> {
  get is_attestation(): boolean
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

  toString(): string {
    return `{id=${this.id}, tags=${this.metadata.container.tags}}`
  }
}

export class PackageVersionExtModel
  extends PackageVersionModel
  implements PackageVersionExt
{
  children: PackageVersionExt[] = []
  parent: PackageVersionExt | null = null
  type: PackageVersionType = 'unknown'
  manifest: Manifest

  constructor(data: PackageVersion, manifest: Manifest) {
    super(data)
    this.manifest = manifest
  }

  get is_attestation(): boolean {
    return this.type === 'attestation'
  }

  toString(): string {
    return `{type=${this.type}, id=${this.id}, tags=${this.metadata.container.tags}}`
  }
}
