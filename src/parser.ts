import * as core from '@actions/core'
import { manifestSchema, packageVersionSchema, PackageVersion } from './schemas'
import {
  OCIImageIndexModel,
  OCIImageManifestModel,
  DockerImageManifestModel,
  DockerManifestListModel,
  PackageVersionModel
} from './models'

export function parseManifest(
  jsonString: string
):
  | OCIImageIndexModel
  | OCIImageManifestModel
  | DockerImageManifestModel
  | DockerManifestListModel {
  // Input validation
  if (typeof jsonString !== 'string') {
    throw new Error('Invalid JSON data')
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (error) {
    core.info(
      `JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    core.info(`Input: ${jsonString}`)
    throw new Error('Invalid JSON data')
  }

  // Validate with Zod
  const result = manifestSchema.safeParse(parsed)

  if (!result.success) {
    // Enhanced error logging with Zod's detailed errors
    core.info(`Validation errors: ${JSON.stringify(result.error.format())}`)
    core.info(`Input: ${jsonString}`)
    throw new Error('Invalid JSON data')
  }

  const data = result.data

  // Discriminated union handling
  // mediaType is guaranteed by Zod validation to be one of the enum values
  switch (data.mediaType) {
    case 'application/vnd.oci.image.manifest.v1+json':
      return new OCIImageManifestModel(data)
    case 'application/vnd.oci.image.index.v1+json':
      return new OCIImageIndexModel(data)
    case 'application/vnd.docker.distribution.manifest.list.v2+json':
      return new DockerManifestListModel(data)
    case 'application/vnd.docker.distribution.manifest.v2+json':
      return new DockerImageManifestModel(data)
  }
}

export function parsePackageVersion(jsonString: string): PackageVersion {
  // Input validation
  if (typeof jsonString !== 'string') {
    throw new Error('Invalid JSON data')
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (error) {
    core.info(
      `JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    core.info(`Input: ${jsonString}`)
    throw new Error('Invalid JSON data')
  }

  // Validate with Zod
  const result = packageVersionSchema.safeParse(parsed)

  if (!result.success) {
    // Enhanced error logging with Zod's detailed errors
    core.info(`Validation errors: ${JSON.stringify(result.error.format())}`)
    core.info(`Input: ${jsonString}`)
    throw new Error('Invalid JSON data')
  }

  return new PackageVersionModel(result.data)
}
