import * as core from '@actions/core'
import { Config } from './config'

import axios, { AxiosInstance, isAxiosError, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { isValidChallenge, parseChallenge } from './utils'
import { parseManifest, parsePackageVersion } from './parser'
import {
  OCIImageIndexModel,
  OCIImageManifestModel,
  DockerImageManifestModel,
  DockerManifestListModel,
  Manifest,
  PackageVersionType,
  PackageVersionExt,
  PackageVersionExtModel,
  ManifestHolder,
  PackageMetadataHolder
} from './models'
import { visit, linkVersions, Node } from './tree'

/**
 * For each version in the given set of versions, finds children of the version via the `children` property of the manifest.
 *
 * @param versions  The set of versions to find children for.
 * @param getVersion  A function that returns a version for a given key.
 * @returns
 */
export function getManifestChildren<T extends ManifestHolder>(v: T): string[] {
  return v.manifest.manifests
    ? v.manifest.manifests.map(manifest => manifest.digest)
    : []
}

export function discoverAndLinkManifestChildren<
  T extends ManifestHolder & Node<T>
>(versions: Set<T>, getVersion: (key: string | number) => T | undefined): T[] {
  return [...versions]
    .map(v0 => [v0, getManifestChildren(v0)] as [T, string[]])
    .map(([v0, ds]) =>
      ds
        .map(d => getVersion(d))
        .filter(v1 => v1 !== undefined)
        .map(v1 => linkVersions(v0, v1))
    )
    .reduce((vs1, vs2) => vs1.concat(vs2), [])
}

export function discoverAndLinkReferrers<T extends ManifestHolder & Node<T>>(
  versions: Set<T>,
  getVersion: (key: string | number) => T | undefined
): T[] {
  return [...versions]
    .map(v0 => [v0, v0.manifest.subject?.digest] as [T, string | undefined])
    .filter(([_v0, d]) => d !== undefined)
    .map(([v0, d]) => [v0, getVersion(d as string)] as [T, T | undefined])
    .filter(([_v0, v1]) => v1 !== undefined)
    .map(([v0, v1]) => {
      linkVersions(v1 as T, v0)
      return v0
    })
}

export function discoverAndLinkReferrerTags<
  T extends PackageMetadataHolder & Node<T>
>(versions: Set<T>, getVersion: (key: string | number) => T | undefined): T[] {
  return [...versions]
    .map(
      v0 =>
        [
          v0,
          v0.metadata.container.tags
            .map(t => getVersion(t.replace('-', ':')))
            .filter(v1 => v1 !== undefined && v1 !== v0 && versions.has(v1))
        ] as [T, T[]]
    )
    .map(([v0, vs]) => vs.map(v1 => [v0, v1] as [T, T]))
    .reduce((vs1, vs2) => vs1.concat(vs2), [])
    .map(([v0, v1]) => {
      linkVersions(v1, v0)
      return v0
    })
}

export function getArtifactType(v: PackageVersionExt): PackageVersionType {
  const m = v.manifest

  if (m.layers) {
    // Manifest with layers.

    // Docker build attestations attach directly to the image index as manifests.
    // Check if the manifest is an attestation by checking if all layers' mediaType is application/vnd.in-toto+json.
    if (m.layers.every(l => l.mediaType === 'application/vnd.in-toto+json')) {
      return 'attestation'
    }

    // If it's not an attestation, then it's a regular single-architecture image.
    return 'single-arch image'
  }

  // Check if an attestation by checking if `subject` is defined.
  if (m.subject) {
    return 'attestation'
  }

  // Check if an attestation by checking the referrers tag schema, that is if the tag is in the form of `sha256-<digest>`.
  if (
    v.metadata.container.tags.some(t => RegExp(/^sha256-[a-f0-9]{64}$/).exec(t))
  ) {
    return 'attestation'
  }

  // If it's not an attestation, then it's a multi-architecture image if it has child manifests. Otherwise, it's unknown.
  return m.manifests && m.manifests.length > 0 ? 'multi-arch image' : 'unknown'
}

export function scanRoots(
  uniqueVersions: Set<PackageVersionExt>,
  getVersion: (key: string | number) => PackageVersionExt | undefined
): Set<PackageVersionExt> {
  // Start with all versions as roots.
  const roots = new Set(uniqueVersions)

  for (const v of roots) {
    v.children = []
    v.parent = null
    v.type = 'unknown'
  }

  for (const v of discoverAndLinkManifestChildren(roots, getVersion)) {
    roots.delete(v)
  }

  for (const v of discoverAndLinkReferrers(roots, getVersion)) {
    roots.delete(v)
  }

  // Remove GitHub attestations from root.
  for (const v of discoverAndLinkReferrerTags(roots, getVersion)) {
    roots.delete(v)
  }

  // Set the type for each version.
  for (const v of roots) {
    visit(v, _v => {
      _v.type = getArtifactType(_v)
    })
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
        const version0 = parsePackageVersion(JSON.stringify(packageVersion))
        const manifest = await this.fetchManifest(version0.name)
        const version = new PackageVersionExtModel(version0, manifest)
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
  private async fetchManifest(digest: string): Promise<Manifest> {
    // Retrieve the manifest.
    const response: AxiosResponse<Manifest> = await this.axios.get<Manifest>(
      `/v2/${this.config.owner}/${this.config.package}/manifests/${digest}`
    )

    // Assume default mediaType if not present.
    if (response?.data && !response?.data['mediaType']) {
      response.data['mediaType'] = 'application/vnd.oci.image.index.v1+json'
    }

    const manifest:
      | OCIImageIndexModel
      | OCIImageManifestModel
      | DockerImageManifestModel
      | DockerManifestListModel = parseManifest(JSON.stringify(response?.data))

    return manifest as Manifest
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
