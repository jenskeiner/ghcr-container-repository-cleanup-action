import * as core from '@actions/core'
import { Config } from './config.js'

import axios, { AxiosInstance, isAxiosError, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { isValidChallenge, parseChallenge } from './utils.js'
import { parseManifest, parsePackageVersion } from './parser.js'
import {
  OCIImageIndexModel,
  OCIImageManifestModel,
  DockerImageManifestModel,
  DockerManifestListModel,
  Manifest,
  PackageVersionExt,
  ManifestExt
} from './models.js'

function visit(
  version: PackageVersionExt,
  fn: (v: PackageVersionExt) => void
): void {
  // Visit version.
  fn(version)

  // Visit children.
  for (const child of version.children) {
    visit(child, fn)
  }
}

export function scanRoots(
  uniqueVersions: Set<PackageVersionExt>,
  getVersion: (key: string | number) => PackageVersionExt | undefined
): Set<PackageVersionExt> {
  // Holds versions known to not be roots.
  const nonRoots = new Set<PackageVersionExt>()

  for (const v of uniqueVersions) {
    v.children = []
    v.parent = null
    v.type = 'unknown'
  }

  // Loop over all versions.
  for (const v of uniqueVersions) {
    // Manifest should have been initialized.
    if (v.manifest) {
      // Loop over all digests of child manifests.
      for (const child_digest of v.manifest.children) {
        // Get the version for the child digest.
        const child = getVersion(child_digest)

        // Check if the child actually exists.
        if (child && uniqueVersions.has(child)) {
          // Add child to v's children.
          v.children.push(child)

          // The child is not a root version, as per definition.
          nonRoots.add(child)

          // Add backward reference from child to parent.
          child.parent = v
        }
      }
    }
  }

  // Determine roots.
  const roots = new Set(uniqueVersions)
  for (const v of nonRoots) {
    roots.delete(v)
  }

  // Set the type for each version.
  for (const v of uniqueVersions) {
    if (v.children.length > 0) {
      v.type = 'multi-arch image'
      continue
    }

    const m = v.manifest
    if (m) {
      if (
        m.layers &&
        m.layers.length === 1 &&
        m.layers[0].mediaType === 'application/vnd.in-toto+json'
      ) {
        v.type = 'Docker attestation'
      } else {
        v.type = 'single-arch image'
      }
    } else {
      v.type = 'unknown'
    }
  }

  // Up to here, we have ignored GitHub attestation versions. They are linked to the version
  // they attest via a tag that is equivalent to the digest of the attested version. Each attestation
  // version should be removed from the roots and added to the children of the attested version.
  // Also, the type should be adjusted for the attestation version and its children.

  nonRoots.clear()

  // Loop over all roots.
  for (const r of roots) {
    // Loop over all tags for the root.
    for (const t of r.metadata.container.tags) {
      // Replace - with : in the tag. If the version is an attestation,
      // this would be the digest of the attested version.
      const d = t.replace('-', ':')

      // Get the version for the potential digest.
      const v = getVersion(d)

      // If the version exists and is not identical to r, then r is a GitHub attestation.
      if (v && v !== r && uniqueVersions.has(v)) {
        // Recursively set the is_attestation property to true.
        visit(r, v0 => {
          v0.type = 'attestation child'
        })
        r.type = 'attestation root'
        r.parent = v

        // Add attestation r to children of v.
        v.children.push(r)

        // Add r to non-roots.
        nonRoots.add(r)
      }
    }
  }

  // Remove GitHub attestations from root.
  for (const v of nonRoots) {
    roots.delete(v)
  }

  return roots
}

/**
 * Provides access to a package via the GitHub Packages REST API.
 */
export class GithubPackageRepo {
  // The action configuration
  config: Config

  // The type of repository (User or Organization)
  repoType = 'Organization'

  // Maps digest, tag, or id to version.
  versions = new Map<string | number, PackageVersionExt>()

  // Collection of tags.
  tags = new Set<string>()

  // Collection of digests.
  digests = new Set<string>()

  // Collection of unique versions.
  uniqueVersions = new Set<PackageVersionExt>()

  // Collection of root versions.
  roots = new Set<PackageVersionExt>()

  // HTTP client.
  axios: AxiosInstance

  /**
   * Constructor.
   *
   * @param config The action configuration
   */
  constructor(config: Config) {
    this.config = config

    // Create HTTP client.
    this.axios = axios.create({
      baseURL: 'https://ghcr.io/'
    })
    // Set up retries.
    axiosRetry(this.axios, { retries: 3 })
    // Set up default request headers.
    this.axios.defaults.headers.common.Accept =
      'application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'
  }
  /**
   * Handles the authentication challenge.
   * @param challenge - The authentication challenge string.
   * @returns A Promise that resolves when the authentication challenge is handled.
   * @throws An error if the authentication challenge is invalid or the login fails.
   */
  private async handleAuthenticationChallenge(
    challenge: string
  ): Promise<string> {
    // Parse the authentication challenge.
    const attributes = parseChallenge(challenge)

    // Check if the challenge is valid.
    if (isValidChallenge(attributes)) {
      // Try to authenticate using the token from the configuration.
      const auth = axios.create()
      axiosRetry(auth, { retries: 3 })
      const tokenResponse = await auth.get(
        `${attributes.get('realm')}?service=${attributes.get('service')}&scope=${attributes.get('scope')}`,
        {
          auth: {
            username: 'token',
            password: this.config.token
          }
        }
      )

      // Try to extract the token from the returned data.
      const token = tokenResponse.data.token

      if (token) {
        return token
      } else {
        throw new Error(`ghcr.io login failed: ${token.response.data}`)
      }
    } else {
      throw new Error(`invalid www-authenticate challenge ${challenge}`)
    }
  }

  /**
   * Logs in to the registry.
   * This method retrieves a token and handles authentication challenges if necessary.
   * @returns A Promise that resolves when the login is successful.
   * @throws If an error occurs during the login process.
   */
  async login(): Promise<void> {
    try {
      // get token
      await this.axios.get(
        `/v2/${this.config.owner}/${this.config.package}/tags/list`
      )
    } catch (error) {
      if (isAxiosError(error) && error.response != null) {
        if (error.response?.status === 401) {
          const challenge = error.response?.headers['www-authenticate']
          const token = await this.handleAuthenticationChallenge(challenge)
          this.axios.defaults.headers.common.Authorization = `Bearer ${token}`
        } else {
          throw error
        }
      }
    }
  }

  async init(): Promise<void> {
    // Determine the repository type (User or Organization).
    this.repoType = await this.config.getOwnerType()
    await this.login()
  }

  /**
   * Loads all versions of the package from the GitHub Packages API and populates the internal maps.
   */
  private async fetchVersions(
    fn: (version: PackageVersionExt) => void
  ): Promise<void> {
    // Function to retrieve package versions.
    let fetch

    // Parameters for the function call.
    let fetch_params

    if (this.repoType === 'User') {
      // Use the appropriate function for user repos.
      fetch = this.config.isPrivateRepo
        ? this.config.octokit.rest.packages
            .getAllPackageVersionsForPackageOwnedByAuthenticatedUser
        : this.config.octokit.rest.packages
            .getAllPackageVersionsForPackageOwnedByUser

      // Parameters for the function call.
      fetch_params = {
        package_type: 'container',
        package_name: this.config.package,
        username: this.config.owner,
        state: 'active',
        per_page: 100
      }
    } else {
      fetch =
        this.config.octokit.rest.packages
          .getAllPackageVersionsForPackageOwnedByOrg

      // Parameters for the function call.
      fetch_params = {
        package_type: 'container',
        package_name: this.config.package,
        org: this.config.owner,
        state: 'active',
        per_page: 100
      }
    }

    // Iterate over all package versions.
    for await (const response of this.config.octokit.paginate.iterator(
      fetch,
      fetch_params
    )) {
      for (const packageVersion of response.data) {
        const version = parsePackageVersion(JSON.stringify(packageVersion))
        const manifest = await this.fetchManifest(version.name)
        version.manifest = manifest
        fn(version)
      }
    }
  }

  private addVersion(version: PackageVersionExt): void {
    this.versions.set(version.name, version)
    this.versions.set(version.id, version)
    this.digests.add(version.name)

    // Add each tag to the internal map.
    for (const tag of version.metadata.container.tags) {
      this.versions.set(tag, version)
      this.tags.add(tag)
    }

    this.uniqueVersions.add(version)
  }

  getRoots(): Set<PackageVersionExt> {
    return this.roots
  }

  async loadVersions(): Promise<void> {
    // Clear the internal maps.
    this.versions.clear()
    this.uniqueVersions.clear()
    this.tags.clear()
    this.digests.clear()

    await this.fetchVersions(this.addVersion.bind(this))
    this.roots = scanRoots(this.uniqueVersions, this.getVersion.bind(this))

    return Promise.resolve()
  }

  /**
   Return the digests for the package.
   * @returns The digests for the package.
   */
  getDigests(): string[] {
    return Array.from(this.digests)
  }

  getVersions(): PackageVersionExt[] {
    // filter duplicates
    return Array.from(new Set(this.versions.values()))
  }

  /**
   * Return the tags for the package.
   * @returns The tags for the package.
   */
  getTags(includeAttestations = false): string[] {
    const tags = Array.from(this.tags)

    if (includeAttestations) {
      return tags
    } else {
      return tags.filter(tag => !this.getVersion(tag)?.is_attestation)
    }
  }

  /**
   * Return the package version for a tag.
   * @param tag The tag to search for.
   * @returns The package version for the tag.
   */
  getVersion(key: string | number): PackageVersionExt | undefined {
    return this.versions.get(key)
  }

  /**
   * Delete a package version.
   * @param id The ID of the package version to delete.
   */
  async deleteVersion(key: string | number): Promise<void> {
    const version = this.getVersion(key)

    if (version == null) {
      throw new Error(`Package version not found for key ${key}.`)
    }

    const id = version.id

    if (!this.config.dryRun) {
      if (this.repoType === 'User') {
        if (this.config.isPrivateRepo) {
          await this.config.octokit.rest.packages.deletePackageVersionForAuthenticatedUser(
            {
              package_type: 'container',
              package_name: this.config.package,
              package_version_id: id
            }
          )
        } else {
          await this.config.octokit.rest.packages.deletePackageVersionForUser({
            package_type: 'container',
            package_name: this.config.package,
            username: this.config.owner,
            package_version_id: id
          })
        }
      } else {
        await this.config.octokit.rest.packages.deletePackageVersionForOrg({
          package_type: 'container',
          package_name: this.config.package,
          org: this.config.owner,
          package_version_id: id
        })
      }
    }

    // Remove digest from internal set.
    this.digests.delete(version.name)
    this.versions.delete(version.name)

    // Remove tags from internal set.
    for (const tag of version.metadata.container.tags) {
      this.tags.delete(tag)
      this.versions.delete(tag)
    }

    this.versions.delete(id)

    this.uniqueVersions.delete(version)

    this.roots = scanRoots(this.uniqueVersions, this.getVersion.bind(this))
  }

  /**
   * Retrieves a manifest by its digest.
   *
   * @param digest - The digest of the manifest to retrieve.
   * @returns A Promise that resolves to the retrieved manifest.
   */
  private async fetchManifest(digest: string): Promise<ManifestExt> {
    // Retrieve the manifest.
    const response: AxiosResponse<Manifest> = await this.axios.get<Manifest>(
      `/v2/${this.config.owner}/${this.config.package}/manifests/${digest}`
    )

    const manifest:
      | OCIImageIndexModel
      | OCIImageManifestModel
      | DockerImageManifestModel
      | DockerManifestListModel = parseManifest(JSON.stringify(response?.data))

    return manifest as ManifestExt
  }

  /**
   * Puts the manifest for a given tag in the registry.
   * @param tag - The tag of the manifest.
   * @param manifest - The manifest to be put.
   * @param multiArch - A boolean indicating whether the manifest is for a multi-architecture image.
   * @returns A Promise that resolves when the manifest is successfully put in the registry.
   */
  private async putManifest(tag: string, manifest: any): Promise<void> {
    if (!this.config.dryRun) {
      const contentType = manifest.mediaType
      const config = {
        headers: {
          'Content-Type': contentType
        }
      }

      const auth = axios.create()
      try {
        // Try to put the manifest without token.
        const response = await auth.put(
          `https://ghcr.io/v2/${this.config.owner}/${this.config.package}/manifests/${tag}`,
          manifest,
          config
        )
        core.debug(`New digest: ${response.headers['docker-content-digest']}`)
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          const token = await this.handleAuthenticationChallenge(
            error.response?.headers['www-authenticate']
          )

          const response = await this.axios.put(
            `/v2/${this.config.owner}/${this.config.package}/manifests/${tag}`,
            manifest,
            {
              headers: {
                'content-type': contentType,
                Authorization: `Bearer ${token}`
              }
            }
          )
          core.debug(`New digest: ${response.headers['docker-content-digest']}`)
        } else {
          throw error
        }
      }
    }
  }

  async deleteTag(tag: string): Promise<void> {
    // Get the version for the tag.
    const version = this.getVersion(tag)

    if (!version) {
      throw new Error(`Version or manifest not found for tag ${tag}.`)
    }

    if (!this.config.dryRun) {
      // Clone the manifest.
      const manifest0 = JSON.parse(JSON.stringify(version.manifest))

      // Make manifest0 into a fake manifest that does not point to any other manifests or layers.
      // Push the manifest with the given tag to the registry. This creates a new version with the
      // tag and removes it from the original version.
      if (manifest0.manifests) {
        // Multi-arch manifest. Remove any pointers to child manifests.
        manifest0.manifests = []
      } else {
        // Single-architecture or attestation manifest. Remove any pointers to layers.
        manifest0.layers = []
      }

      await this.putManifest(tag, manifest0)
    }

    // Remove the tag from the original version. The original manifest does not need to be adjusted.
    version.metadata.container.tags = version.metadata.container.tags.filter(
      t => t !== tag
    )

    // It should not be necessary, but just to remove the tag cleanly at this point, remove it from the internal maps and sets.
    this.tags.delete(tag)
    this.versions.delete(tag)

    if (!this.config.dryRun) {
      // Fetch the new version for the tag.
      const fn = (version_: PackageVersionExt): void => {
        if (version_.metadata.container.tags.includes(tag)) {
          this.addVersion(version_)
        }
      }

      // Reload the package repository to update the version cache.
      await this.fetchVersions(fn.bind(this))

      // Get the new version for the tag.
      const version0 = this.getVersion(tag)

      if (version0) {
        core.debug(JSON.stringify(version0, null, 2))
        // Delete the temporary version.
        await this.deleteVersion(tag)
      } else {
        throw new Error(
          `Intermediate version used to delete tag ${tag} not found.`
        )
      }
    }
  }
}
