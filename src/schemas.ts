/**
 * Zod schemas for validating GitHub Container Registry API responses.
 *
 * All schemas use `.passthrough()` to allow additional properties for forward compatibility.
 */

import { z } from 'zod'

/**
 * Manifest reference used in multi-architecture images and OCI referrers to link manifests.
 */
export const manifestReferenceSchema = z
  .object({
    mediaType: z.string(),
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]+$/, 'Invalid SHA256 digest format')
  })
  .passthrough()

/**
 * Container image manifest supporting both OCI and Docker registry formats.
 *
 * The `mediaType` enum enables discriminated union handling in the parser.
 * - Single-arch images use `layers`
 * - Multi-arch images use `manifests`
 * - OCI 1.1 referrers use `subject`
 */
export const manifestSchema = z
  .object({
    mediaType: z.enum(
      [
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.docker.distribution.manifest.v2+json'
      ],
      'Invalid or unsupported media type'
    ),
    manifests: z.array(manifestReferenceSchema).optional(),
    layers: z.array(manifestReferenceSchema).optional(),
    subject: manifestReferenceSchema.optional()
  })
  .passthrough()

/**
 * Package version metadata from GitHub Packages API.
 */
export const packageVersionMetadataSchema = z
  .object({
    package_type: z.string(),
    container: z
      .object({
        tags: z.array(z.string())
      })
      .passthrough()
  })
  .passthrough()

/**
 * Complete package version from GitHub Packages API.
 */
export const packageVersionSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    url: z.string().url(),
    package_html_url: z.string().url(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    html_url: z.string().url(),
    metadata: packageVersionMetadataSchema
  })
  .passthrough()

// Types inferred from schemas ensure runtime validation and static types stay in sync
export type ManifestReference = z.infer<typeof manifestReferenceSchema>
export type Manifest = z.infer<typeof manifestSchema>
export type PackageVersionMetadata = z.infer<
  typeof packageVersionMetadataSchema
>
export type PackageVersion = z.infer<typeof packageVersionSchema>
