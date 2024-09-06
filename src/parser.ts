import * as core from '@actions/core'
import AjvModule from 'ajv/dist/jtd.js'
import { manifestSchema, packageVersionSchema } from './schemas'
import {
  Manifest,
  OCIImageIndexModel,
  OCIImageManifestModel,
  DockerImageManifestModel,
  DockerManifestListModel,
  PackageVersionModel,
  PackageVersionExt,
  PackageVersion
} from './models'

const Ajv = (AjvModule as any).default || AjvModule
const ajv = new Ajv()

const parseManifest0 = ajv.compileParser(manifestSchema)

export function parseManifest(
  jsonString: string
):
  | OCIImageIndexModel
  | OCIImageManifestModel
  | DockerImageManifestModel
  | DockerManifestListModel {
  if (typeof jsonString !== 'string') {
    throw new Error('Invalid JSON data')
  }

  const data = parseManifest0(jsonString) as Manifest

  if (data === undefined) {
    core.info(`${parseManifest0.position}`)
    core.info(`${parseManifest0.message}`)
    core.info(`${jsonString}`)
    throw new Error('Invalid JSON data')
  }

  if (!data.mediaType) {
    throw new Error('Unknown media type')
  }

  switch (data.mediaType) {
    case 'application/vnd.oci.image.manifest.v1+json':
      return new OCIImageManifestModel(data)
    case 'application/vnd.oci.image.index.v1+json':
      return new OCIImageIndexModel(data)
    case 'application/vnd.docker.distribution.manifest.list.v2+json':
      return new DockerManifestListModel(data)
    case 'application/vnd.docker.distribution.manifest.v2+json':
      return new DockerImageManifestModel(data)
    default:
      throw new Error('Unknown media type')
  }
}

const parsePackageVersion0 = ajv.compileParser(packageVersionSchema)

export function parsePackageVersion(jsonString: string): PackageVersionExt {
  if (typeof jsonString !== 'string') {
    throw new Error('Invalid JSON data')
  }

  const data = parsePackageVersion0(jsonString) as PackageVersion

  if (data === undefined) {
    throw new Error('Invalid JSON data')
  }

  return new PackageVersionModel(data)
}
