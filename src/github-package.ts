import { Config } from './config.js'

import axios, { AxiosInstance, isAxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import { isValidChallenge, parseChallenge } from './utils.js'

export class ManifestNotFoundException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestNotFoundException'
  }
}

/**
 * Provides access to a package via the GitHub Packages REST API.
 */
export class GithubPackageRepo {
  // The action configuration
  config: Config

  // The type of repository (User or Organization)
  repoType = 'Organization'

  // Map of tags to package versions.
  tag2version = new Map<string, any>()

  // Map of digests to package versions.
  digest2version = new Map<string, any>()

  // HTTP client.
  axios: AxiosInstance

  // Cache of loaded manifests, by digest.
  manifestCache = new Map<string, any>()

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
  async handleAuthenticationChallenge(challenge: string): Promise<string> {
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
  async loadVersions(): Promise<void> {
    // Clear the internal maps.
    this.tag2version.clear()
    this.digest2version.clear()

    // Function to retrieve package versions.
    let getFunc

    // Parameters for the function call.
    let getParams

    if (this.repoType === 'User') {
      // Use the appropriate function for user repos.
      getFunc = this.config.isPrivateRepo
        ? this.config.octokit.rest.packages
            .getAllPackageVersionsForPackageOwnedByAuthenticatedUser
        : this.config.octokit.rest.packages
            .getAllPackageVersionsForPackageOwnedByUser

      // Parameters for the function call.
      getParams = {
        package_type: 'container',
        package_name: this.config.package,
        username: this.config.owner,
        state: 'active',
        per_page: 100
      }
    } else {
      getFunc =
        this.config.octokit.rest.packages
          .getAllPackageVersionsForPackageOwnedByOrg

      // Parameters for the function call.
      getParams = {
        package_type: 'container',
        package_name: this.config.package,
        org: this.config.owner,
        state: 'active',
        per_page: 100
      }
    }

    // Iterate over all package versions.
    for await (const response of this.config.octokit.paginate.iterator(
      getFunc,
      getParams
    )) {
      for (const packageVersion of response.data) {
        // Get the manifest for the package version.
        const manifest = await this.getManifestByDigest(packageVersion.name)

        packageVersion.manifest = manifest

        // Add the digest to the internal map.
        this.digest2version.set(packageVersion.name, packageVersion)

        // Add each tag to the internal map.
        for (const tag of packageVersion.metadata.container.tags) {
          this.tag2version.set(tag, packageVersion)
        }
      }
    }
  }

  /**
   * Return the tags for the package.
   * @returns The tags for the package.
   */
  getTags(): string[] {
    return Array.from(this.tag2version.keys())
  }

  /**
   * Return the package version for a tag.
   * @param tag The tag to search for.
   * @returns The package version for the tag.
   */
  getVersionForTag(tag: string): any {
    return this.tag2version.get(tag)
  }

  /**
   Return the digests for the package.
   * @returns The digests for the package.
   */
  getDigests(): string[] {
    return Array.from(this.digest2version.keys())
  }

  /**
   * Return the package version for a digest.
   * @param digest The digest to search for.
   * @returns The package version for the digest.
   */
  getVersionForDigest(digest: string): any {
    return this.digest2version.get(digest)
  }

  /**
   * Return all versions of the package.
   * @returns All versions of the package.
   */
  getVersions(): any[] {
    return Array.from(this.digest2version.values())
  }

  /**
   * Delete a package version.
   * @param id The ID of the package version to delete.
   */
  async deletePackageVersion(id: string): Promise<void> {
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
  }

  /**
   * Retrieves a manifest by its digest.
   *
   * @param digest - The digest of the manifest to retrieve.
   * @returns A Promise that resolves to the retrieved manifest.
   * @throws {ManifestNotFoundException} If the manifest is not found for the given digest.
   */
  async getManifestByDigest(digest: string): Promise<any> {
    if (this.manifestCache.has(digest)) {
      // Return cached manifest.
      return this.manifestCache.get(digest)
    } else {
      try {
        // Retrieve the manifest.
        const response = await this.axios.get(
          `/v2/${this.config.owner}/${this.config.package}/manifests/${digest}`,
          {
            transformResponse: [
              data => {
                return data
              }
            ]
          }
        )
        const manifest = JSON.parse(response?.data)

        // Save it for later use.
        this.manifestCache.set(digest, manifest)
        return manifest
      } catch (error) {
        if (
          isAxiosError(error) &&
          error.response != null &&
          error.response.status === 400
        ) {
          throw new ManifestNotFoundException(
            `Manifest not found for digest ${digest}`
          )
        } else {
          throw error
        }
      }
    }
  }

  /**
   * Puts the manifest for a given tag in the registry.
   * @param tag - The tag of the manifest.
   * @param manifest - The manifest to be put.
   * @param multiArch - A boolean indicating whether the manifest is for a multi-architecture image.
   * @returns A Promise that resolves when the manifest is successfully put in the registry.
   */
  async putManifest(tag: string, manifest: any): Promise<void> {
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
        await auth.put(
          `https://ghcr.io/v2/${this.config.owner}/${this.config.package}/manifests/${tag}`,
          manifest,
          config
        )
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          const token = await this.handleAuthenticationChallenge(
            error.response?.headers['www-authenticate']
          )

          await this.axios.put(
            `/v2/${this.config.owner}/${this.config.package}/manifests/${tag}`,
            manifest,
            {
              headers: {
                'content-type': contentType,
                Authorization: `Bearer ${token}`
              }
            }
          )
        } else {
          throw error
        }
      }
    }
  }
}
