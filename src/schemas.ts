import { JTDSchemaType } from 'ajv/dist/jtd.js'
import {
  ManifestReference,
  Manifest,
  PackageVersionMetadata,
  PackageVersion
} from './models.js'

export const manifestReferenceSchema: JTDSchemaType<ManifestReference> = {
  properties: {
    mediaType: { type: 'string' },
    digest: { type: 'string' }
  },
  additionalProperties: true
}

export const manifestSchema: JTDSchemaType<Manifest> = {
  properties: {
    mediaType: {
      enum: [
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.docker.distribution.manifest.v2+json'
      ]
    }
  },
  optionalProperties: {
    manifests: {
      elements: manifestReferenceSchema
    },
    layers: {
      elements: manifestReferenceSchema
    }
  },
  additionalProperties: true
}

export const packageVersionMetadataSchema: JTDSchemaType<PackageVersionMetadata> =
  {
    properties: {
      package_type: { type: 'string' },
      container: {
        properties: {
          tags: { elements: { type: 'string' } }
        },
        additionalProperties: true
      }
    },
    additionalProperties: true
  }

export const packageVersionSchema: JTDSchemaType<PackageVersion> = {
  properties: {
    id: { type: 'int32' },
    name: { type: 'string' },
    url: { type: 'string' },
    package_html_url: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
    html_url: { type: 'string' },
    metadata: packageVersionMetadataSchema
  },
  additionalProperties: true
}
