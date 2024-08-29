import * as core from '@actions/core'
import { Config, getConfig } from './config.js'
import {
  GithubPackageRepo,
  ManifestNotFoundException
} from './github-package.js'
import { isMediaType } from './models.js'

export async function run(): Promise<void> {
  try {
    // Instantiate action class.
    const action = new CleanupAction()
    // Initialization work.
    await action.init()
    // Run the actual action.
    await action.run()
  } catch (error) {
    // Fail the workflow run if an error occurs.
    if (error instanceof Error) core.setFailed(error.message)
  }
}

class CleanupAction {
  // Configuration.
  config: Config

  // Provides access to the package repository.
  githubPackageRepo: GithubPackageRepo

  constructor() {
    // Get action configuration.
    this.config = getConfig()
    // Initialize registry and package repository.
    this.githubPackageRepo = new GithubPackageRepo(this.config)
  }

  async init(): Promise<void> {
    // Initialize the package repository.
    await this.githubPackageRepo.init()
  }

  /**
   * Filters the given array of items based on a regular expression.
   *
   * Used to match tags against a regular expression.
   *
   * @param regexStr - The regular expression string to match against the items.
   * @param items - The array of items to filter.
   * @returns An array of items that match the regular expression.
   */
  matchItems(regexStr: string | undefined, items: string[]): string[] {
    // The result.
    let result: string[] = []

    if (regexStr) {
      // Compile regular expression.
      const regex = new RegExp(regexStr)
      // Filter items based on regular expression.
      result = items.filter(item => regex.test(item))
      // Log items that match the regular expression.
      if (result.length > 0) {
        core.info(`Items that match regular expression ${regexStr}:`)
        for (const item of result) {
          core.info(`- ${item}`)
        }
      } else {
        core.info(`No items that match regular expression ${regexStr}.`)
      }
    } else {
      // Regular expression undefined.
      core.info('Option not set.')
    }
    return result
  }

  isMultiArch(manifest: any): boolean {
    return (
      manifest.mediaType === 'application/vnd.oci.image.index.v1+json' ||
      manifest.mediaType ===
        'application/vnd.docker.distribution.manifest.list.v2+json'
    )
  }

  /**
   * Returns the digests of all versions recursively reachable from the given tags.
   *
   * @param tags - The tags to determine the reachable versions for.
   * @returns The set of reachable digests.
   */
  async getReachableDigestsForTags(tags: Iterable<string>): Promise<string[]> {
    // The result.
    const result = new Set<string>()

    // Loop over all tags.
    for (const tag of tags) {
      core.startGroup(`Determine reachable versions for tag ${tag}.`)
      // Get the version for the tag.
      const version = this.githubPackageRepo.getVersion(tag)
      if (version) {
        // Starting with the version's digest, recursively determine all reachable versions.
        const reachable = await this.getReachableDigestsForDigest(version.name)
        // Add all reachable versions to the result.
        for (const child of reachable) {
          result.add(child)
        }
      }
      core.endGroup()
    }

    return Array.from(result)
  }

  /**
   * Returns the digests of all versions recursively reachable from the given digests.
   *
   * @param digests - The digests to determine the reachable versions for.
   * @returns The set of reachable digests.
   */
  async getReachableDigestsForDigests(
    digests: Iterable<string>
  ): Promise<string[]> {
    // The result.
    const result = new Set<string>()

    // Loop over all digests.
    for (const digest of digests) {
      core.startGroup(`Determine reachable versions for digest ${digest}.`)
      // Starting with the version's digest, recursively determine all reachable versions.
      const reachable = await this.getReachableDigestsForDigest(digest)
      // Add all reachable versions to the result.
      for (const child of reachable) {
        result.add(child)
      }
      core.endGroup()
    }

    return Array.from(result)
  }

  // Helper function that fetches the manifest for a given digest, but returns null if the manifest is not found.
  async getManifest(digest: string): Promise<any> {
    try {
      core.debug(`Getting manifest for digest ${digest}.`)
      // Get the manifest for the digest. May throw an exception.
      const manifest = this.githubPackageRepo.getManifest(digest)
      core.debug(`Manifest for digest ${digest}:`)
      core.debug(JSON.stringify(manifest, null, 2))
      return manifest
    } catch (error) {
      // Handle exception.
      if (error instanceof ManifestNotFoundException) {
        // Manifest not found. Log error and return null.
        core.error(
          `Manifest for digest ${digest} not found in repository. Skipping.`
        )
        return null
      } else {
        // Re-throw other errors.
        throw error
      }
    }
  }

  /**
   * Retrieves the digests reachable from a given digest.
   *
   * The result includes the given digest as well.
   *
   * @param digest - The digest for which to retrieve the reachable digests.
   * @returns The set of digests of reachable digests.
   */
  async getReachableDigestsForDigest(digest: string): Promise<string[]> {
    // The result.
    const result: string[] = []

    // Get the manifest for the given digest.
    const manifest = await this.getManifest(digest)

    if (!manifest) {
      // Manifest not found. Return empty set.
      return result
    }

    core.info(`manifest: ${JSON.stringify(manifest)}`)

    // Add the cgiven digest to the result, since it points to an existing manifest.
    result.push(digest)

    // Check the media type of the manifest.
    if (this.isMultiArch(manifest)) {
      // Manifest list, i.e. a multi-architecture image pointing to multiple child manifests.
      core.info(`- ${digest}: manifest list`)

      // Recursively get all reachable versions for each child manifest.
      // Note: Exceptions will not be caught here if errors occur for any child. This is
      // to prevent making inconsistent changes later. THe only error case that is handled
      // is when a manifest is not found, in which case the child is skipped; see above.
      for (const child of manifest.manifests) {
        const mediaType = child.mediaType
        if (isMediaType(mediaType)) {
          // Get reachable versions for current child.
          const reachable = await this.getReachableDigestsForDigest(
            child.digest
          )
          // Add all reachable versions to result.
          for (const i of reachable) {
            result.push(i)
          }
        } else {
          core.warning(
            `- ${digest}: Ignoring child manifest ${child.digest} with media type ${child.mediaType}.`
          )
        }
      }
    } else if (
      manifest.mediaType === 'application/vnd.oci.image.manifest.v1+json' ||
      manifest.mediaType ===
        'application/vnd.docker.distribution.manifest.v2+json'
    ) {
      // Image manifest. Can be a single-architecture image or an attestation.

      if (
        manifest.layers.length === 1 &&
        manifest.layers[0].mediaType === 'application/vnd.in-toto+json'
      ) {
        // Attestation.
        core.info(`- ${digest}: attestation manifest`)
      } else {
        // Single-architecture image.
        core.info(`- ${digest}: image manifest`)
      }
    } else {
      // Unknown media type.
      core.warning(`- ${digest}: unknown manifest type ${manifest.mediaType}`)
    }

    return result
  }

  logItems(items: string[]): void {
    if (items.length > 0) {
      for (const item of items) {
        core.info(`- ${item}`)
      }
    } else {
      core.info('  none')
    }
  }

  async run(): Promise<void> {
    try {
      // Load package versions.
      core.startGroup('Load package versions.')
      core.info(
        `Loading package versions for ${this.config.owner}/${this.config.package}.`
      )

      // Load versions.
      await this.githubPackageRepo.loadVersions()

      // Log total number of version retrieved.
      const digests = this.githubPackageRepo.getDigests()
      for (const digest of digests) {
        const version = this.githubPackageRepo.getVersion(digest)
        if (version) {
          core.debug(
            `- id=${version.id}, digest=${version.name}, ${version.metadata.container.tags.length > 0 ? `tags=${version.metadata.container.tags}` : 'untagged'}`
          )
        }
      }

      core.info(`Retrieved ${digests.length} versions.`)
      core.endGroup()

      // The logic to determine the tags and versions to delete is as follows:
      //
      // Let X_tag be the set of all tags and X_digest be the set of all version digests in the package repository.
      //
      // 1. Determine the set A_tag of tags to delete according to the given regular expression this.config.includeTags.
      //    Maybe the empty set if no tag matches the expression or the option is not set.
      //
      // 2. Determine the set A_digest of all version digests reachable from the tags in A_tag.
      //
      // 3. Determine the set B_tag of tags to exclude according to the given regular expression this.config.excludeTags.
      //    Maybe the empty set if no tag matches the expression or the option is not set.
      //
      // 4. Determine the set B_digest of all version digests reachable from the tags in B_tag.
      //
      // At this point, there are sets of tags and digests to delete and not to delete based only on tag names.
      //
      // The next steps consider all remaining tags that are not in A_tag or B_tag, respectively.
      //
      // 5. Determine the set C_tag as the most recent this.config.keepNtagged tags from the set X_tag \ (A_tag v B_tag).
      //    These tags will also be kept. C_tag may be the empty set, if all tags are already in the union of A_tag and B_tag,
      //    or if the option is not set.
      //
      // 6. Determine the set C_digest of all version digests reachable from the tags in C_tag.
      //
      // 7. Determine D_tag as the complement of C_tag in X_tag \ (A_tag v B_tag). These tags will be deleted.
      //    This may be the empty set. The set D_digest of all version digests reachable from the tags in D_tag is not considered.
      //
      // The next steps consider all remaining version digests that are not in A_digest, B_digest, or C_digest, respectively.
      //
      // 8. Determine the set E_digest as the most recent this.config.keepNuntagged version digests from the set X_digest \ (A_digest v B_digest v C_digest).
      //    These versions will also be kept. E_digest may be the empty set, if all version digests are already in the union of A_digest, B_digest, and C_digest,
      //    or if the option is not set.
      //
      // 9. Determine the set F_digest as the complement of E_digest in X_digest \ (A_digest v B_digest v C_digest). These version digests will be deleted.
      //
      // The final set of tags to delete is (A_tag v D_tag) \ (B_tag v C_tag) = (A_tag \ B_tag) v D_tag, as per definition.
      //
      // The final set of version digests to delete is (A_digest v F_digest) \ (B_digest v C_digest v E_digest) = (A_digest \ (B_digest v C_digest)) v F_digest, as per definition.

      // 1. Determine A_tags.
      core.startGroup('Determine tags to delete.')
      const a_tag = this.matchItems(
        this.config.includeTags,
        this.githubPackageRepo.getTags()
      )
      core.endGroup()

      // 2. Determine A_digest.
      const a_digest = await this.getReachableDigestsForTags(a_tag)

      // 3. B_tags.
      core.startGroup('Determine tags to exclude.')
      const b_tag = this.matchItems(
        this.config.excludeTags,
        this.githubPackageRepo.getTags()
      )
      core.endGroup()

      // 4. Determine B_digest.
      const b_digest = await this.getReachableDigestsForTags(b_tag)

      core.startGroup('Determine most recent remaining tags to keep.')
      let c_tag: string[] = []
      let c_digest: string[] = []
      let d_tag: string[] = []
      let d_digest: string[] = []

      const tagsRest: string[] = this.githubPackageRepo
        .getTags()
        .filter(tag => !a_tag.includes(tag))
        .filter(tag => !b_tag.includes(tag))
        .sort((a: string, b: string) => {
          return (
            Date.parse(
              this.githubPackageRepo.getVersion(b)?.updated_at ??
                '1970-01-01T00:00:00Z'
            ) -
            Date.parse(
              this.githubPackageRepo.getVersion(a)?.updated_at ??
                '1970-01-01T00:00:00Z'
            )
          )
        })

      // 5. Determine C_tag.
      c_tag =
        this.config.keepNtagged != null
          ? tagsRest.slice(0, this.config.keepNtagged)
          : tagsRest

      // 6. Determine C_digest.
      c_digest = await this.getReachableDigestsForTags(c_tag)

      // 7. Determine D_tag.
      d_tag =
        this.config.keepNtagged != null
          ? tagsRest.slice(this.config.keepNtagged)
          : []

      // 8. Determine D_digest.
      d_digest = await this.getReachableDigestsForTags(d_tag)

      core.info(`Most recent ${this.config.keepNtagged} tags to keep`)
      this.logItems(c_tag)
      core.info('Remaining tags to delete: ')
      this.logItems(d_tag)

      core.endGroup()

      core.startGroup(
        'Determine most recent remaining untagged images to keep.'
      )
      let e_digest: string[] = []
      let f_digest: string[] = []

      // Determine the ordered list of all versions that are neither in A or B.
      const imagesRest: string[] = this.githubPackageRepo
        .getDigests()
        .filter(digest => !a_digest.includes(digest))
        .filter(digest => !b_digest.includes(digest))
        .filter(digest => !c_digest.includes(digest))
        .filter(digest => !d_digest.includes(digest))
        .sort((a: string, b: string) => {
          const aVersion = this.githubPackageRepo.getVersion(a)
          const bVersion = this.githubPackageRepo.getVersion(b)
          return (
            Date.parse(bVersion?.updated_at ?? '1970-01-01T00:00:00Z') -
            Date.parse(aVersion?.updated_at ?? '1970-01-01T00:00:00Z')
          )
        })

      core.info('Remaining digests to consider:')
      this.logItems(imagesRest)

      // 8. Determine E_digest.
      const e_digest0 =
        this.config.keepNuntagged != null
          ? imagesRest.slice(0, this.config.keepNuntagged)
          : imagesRest

      // Loop over all digests in e_digest0. For each, determine all reachable digests and add them to e_digest, until there are at least keepNuntagged digests.
      e_digest = []
      for (const digest of e_digest0) {
        const reachable = await this.getReachableDigestsForDigest(digest)
        for (const child of reachable) {
          // Avoid duplicates.
          if (!e_digest.includes(child)) e_digest.push(child)
        }
        if (
          this.config.keepNuntagged != null &&
          e_digest.length >= this.config.keepNuntagged
        ) {
          break
        }
      }

      // 9. Determine F_digest as imagesRest with images in E_digest removed.
      f_digest = imagesRest.filter(digest => !e_digest.includes(digest))

      core.info(
        `Most recent ${this.config.keepNuntagged} untagged images to keep:`
      )
      this.logItems(e_digest)
      core.info('Remaining untagged images to delete:')
      this.logItems(f_digest)

      core.endGroup()

      core.startGroup('Determine final set of tags to delete.')
      const tagsDelete = a_tag.filter(tag => !b_tag.includes(tag)).concat(d_tag)
      this.logItems(tagsDelete)
      core.endGroup()

      core.startGroup('Determine final set of versions to delete.')
      const digestsDelete = a_digest
        .concat(d_digest)
        .concat(f_digest)
        .filter(
          digest =>
            !b_digest.includes(digest) &&
            !c_digest.includes(digest) &&
            !e_digest.includes(digest)
        )

      this.logItems(digestsDelete)
      core.endGroup()

      // Delete the tags.
      for (const tag of tagsDelete) {
        core.info(`Deleting tag ${tag}.`)
        await this.githubPackageRepo.deleteTag(tag)
      }

      // Delete the versions.
      for (const digest of digestsDelete) {
        const version = this.githubPackageRepo.getVersion(digest)
        if (version) {
          core.info(
            `Deleting version with digest=${version.name}, id=${version.id}.`
          )
          await this.githubPackageRepo.deleteVersion(version.id)
        } else {
          core.info(`Version with digest ${digest} not found.`)
        }
      }
    } catch (error) {
      // Fail the workflow run if an error occurs
      if (error instanceof Error) core.setFailed(error.message)
    }
  }
}
