import * as core from '@actions/core'
import { Config, getConfig } from './config'
import { GithubPackageRepo, scanRoots } from './github-package'
import { PackageVersionExt } from './models'
import { renderTree } from './tree'

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
  private VersionSet = class {
    tags: string[] = []
    versions: PackageVersionExt[] = []
    parent: CleanupAction

    constructor(parent: CleanupAction) {
      this.parent = parent
    }

    addVersions(
      versions: PackageVersionExt | Iterable<PackageVersionExt>
    ): this {
      // Ensure that version is an array.
      const versions0: Iterable<PackageVersionExt> =
        Symbol.iterator in versions ? versions : [versions]

      for (const v of versions0) {
        const c = this.parent.getClosure(v.name)

        for (const v0 of c) {
          // Add the version to the list.
          if (!this.versions.includes(v0)) this.versions.push(v0)

          // Add each tag to the list of tags as well.
          for (const t of v0.metadata.container.tags) {
            if (!this.tags.includes(t)) this.tags.push(t)
          }
        }
      }

      return this
    }

    addTags(tags: string | Iterable<string>): this {
      const tags0: Iterable<string> = typeof tags === 'string' ? [tags] : tags

      for (const t of tags0) {
        const v = this.parent.repo.getVersion(t)

        if (v) {
          if (!this.tags.includes(t)) {
            this.tags.push(t)
          }

          this.addVersions(v)
        }
      }
      return this
    }
  }

  // Configuration.
  config: Config

  // Provides access to the package repository.
  repo: GithubPackageRepo

  constructor() {
    // Get action configuration.
    this.config = getConfig()
    // Initialize registry and package repository.
    this.repo = new GithubPackageRepo(this.config)
  }

  async init(): Promise<void> {
    // Initialize the package repository.
    await this.repo.init()
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
  matchItems(regexStr: string, items: string[]): string[] {
    // The result.
    let result: string[] = []

    // Compile regular expression.
    const regex = new RegExp(regexStr)
    // Filter items based on regular expression.
    result = items.filter(item => regex.test(item))

    return result
  }

  /**
   * Retrieves the digests reachable from a given digest.
   *
   * The result includes the given digest as well.
   *
   * @param digest - The digest for which to retrieve the reachable digests.
   * @returns The set of digests of reachable digests.
   */
  getClosure(key: string | Iterable<string>): PackageVersionExt[] {
    // Convert key to an array.
    const keys: Iterable<string> = typeof key === 'string' ? [key] : key

    // The result.
    const result: PackageVersionExt[] = []

    // Loop over all keys.
    for (const key0 of keys) {
      // Get the version for the given key.
      const version = this.repo.getVersion(key0)

      if (!version) continue

      // Add the digest of the version to the result.
      result.push(version)

      // Recursively get all reachable versions.
      for (const child of version.children) {
        // Get reachable versions for current child.
        const reachable = this.getClosure(child.name)
        // Add all reachable versions to result.
        for (const i of reachable) {
          result.push(i)
        }
      }
    }

    return result
  }

  logItems(items: string[] | PackageVersionExt[]): void {
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
      await this.repo.loadVersions()

      // Log total number of version retrieved.
      {
        const roots = this.repo.getRoots()

        for (const r of roots) {
          renderTree<PackageVersionExt>(
            r,
            v => v.children,
            (v, prefix) => {
              core.info(`${v.parent == null ? '- ' : '  '}${prefix} ${v}`)
            }
          )
        }
      }

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

      core.startGroup('Determine tags to delete.')

      // The tags and versions to delete.
      const remove = new this.VersionSet(this)

      if (this.config.includeTags) {
        const tags = this.matchItems(
          this.config.includeTags,
          this.repo.getTags()
        )
        remove.addTags(tags)

        // Log tags that match the regular expression.
        if (tags.length > 0) {
          for (const item of tags) {
            core.info(`- ${item}`)
          }
        } else {
          core.info(
            `No tags match the regular expression ${this.config.includeTags}.`
          )
        }
      } else {
        core.info('Option not set.')
      }

      core.endGroup()

      core.startGroup('Determine tags to exclude.')

      // The tags and versions to keep.
      const keep = new this.VersionSet(this)

      if (this.config.excludeTags) {
        const tags = this.matchItems(
          this.config.excludeTags,
          this.repo.getTags()
        )
        keep.addTags(tags)

        // Log tags that match the regular expression.
        if (tags.length > 0) {
          for (const item of tags) {
            core.info(`- ${item}`)
          }
        } else {
          core.info(
            `No tags match the regular expression ${this.config.excludeTags}.`
          )
        }
      } else {
        core.info('Option not set.')
      }

      core.endGroup()

      core.startGroup('Determine most recent remaining tags to keep.')

      const tagsRest: string[] = this.repo
        .getTags()
        .filter(tag => !remove.tags.includes(tag) && !keep.tags.includes(tag))
        .sort((x: string, y: string) => {
          return (
            Date.parse(
              this.repo.getVersion(y)?.updated_at ?? '1970-01-01T00:00:00Z'
            ) -
            Date.parse(
              this.repo.getVersion(x)?.updated_at ?? '1970-01-01T00:00:00Z'
            )
          )
        })

      // Determine the most recent tags to keep.
      const c_tags =
        this.config.keepNtagged != null
          ? tagsRest.slice(0, this.config.keepNtagged)
          : tagsRest

      if (this.config.keepNtagged == null) {
        core.info('Option not set. All remaining tags will be kept:')
      } else {
        core.info(
          `Keeping the most recent ${this.config.keepNtagged} remaining tags:`
        )
      }
      if (c_tags.length === 0) {
        core.info('  none')
      } else {
        for (const t of c_tags) core.info(`- ${t}`)
      }

      keep.addTags(c_tags)

      // Determine the remaining tags to delete.
      const d_tags =
        this.config.keepNtagged != null
          ? tagsRest.slice(this.config.keepNtagged)
          : []

      remove.addTags(d_tags)

      core.endGroup()

      core.startGroup(
        'Determine most recent remaining untagged images to keep.'
      )

      // Determine the ordered list of all versions that are neither in A or B.
      const imagesRest: PackageVersionExt[] = Array.from(this.repo.getRoots())
        .filter(v => !remove.versions.includes(v))
        .filter(v => !keep.versions.includes(v))
        .filter(v => !v.is_attestation)
        .sort((x: PackageVersionExt, y: PackageVersionExt) => {
          return (
            Date.parse(y?.updated_at ?? '1970-01-01T00:00:00Z') -
            Date.parse(x?.updated_at ?? '1970-01-01T00:00:00Z')
          )
        })

      // 8. Determine E_digest.
      const e_versions: PackageVersionExt[] =
        this.config.keepNuntagged != null
          ? imagesRest.slice(0, this.config.keepNuntagged)
          : imagesRest

      if (this.config.keepNuntagged == null) {
        core.info('Option not set. All remaining untagged images will be kept.')
      } else {
        core.info(
          `Keeping the most recent ${this.config.keepNuntagged} remaining untagged images:`
        )
      }
      if (e_versions.length === 0) {
        core.info('  none')
      } else {
        for (const v of e_versions) core.info(`- ${v}`)
      }

      keep.addVersions(e_versions)

      const f_versions = imagesRest.filter(v => !e_versions.includes(v))

      remove.addVersions(f_versions)

      core.endGroup()

      core.startGroup('Final set of tags to delete.')
      const tagsDelete = remove.tags.filter(tag => !keep.tags.includes(tag))
      this.logItems(tagsDelete)
      core.endGroup()

      core.startGroup('Final set of versions to delete.')
      const versionsDelete = remove.versions.filter(
        v => !keep.versions.includes(v)
      )
      {
        const roots = scanRoots(
          new Set<PackageVersionExt>(versionsDelete),
          key => this.repo.getVersion(key)
        )

        for (const r of roots) {
          renderTree<PackageVersionExt>(
            r,
            v => v.children,
            (v, prefix) => {
              core.info(`${v.parent == null ? '- ' : '  '}${prefix} ${v}`)
            }
          )
        }
      }

      //this.logItems(versionsDelete)
      core.endGroup()

      core.startGroup('Delete tags.')
      for (const tag of tagsDelete) {
        core.info(`Deleting tag ${tag}.`)
        await this.repo.deleteTag(tag)
      }
      core.endGroup()

      core.startGroup('Delete versions.')
      const deletionStartTime = Date.now()
      let deletedCount = 0
      const maxConcurrency = 3

      const inFlight = new Set<Promise<void>>()

      for (const v of versionsDelete) {
        core.info(`Deleting version ${v}.`)
        const versionStartTime = Date.now()

        const promiseWrapper = { promise: null as Promise<void> | null }

        promiseWrapper.promise = (async () => {
          try {
            await this.repo.deleteVersion(v.id)
            const versionDuration = Date.now() - versionStartTime
            deletedCount++

            if (versionDuration > 100) {
              core.debug(`Single deletion took ${versionDuration}ms for ${v}`)
            }
          } catch (error) {
            core.error(
              `Failed to delete version ${v}: ${error instanceof Error ? error.message : String(error)}`
            )
          } finally {
            inFlight.delete(promiseWrapper.promise!)
          }
        })()

        inFlight.add(promiseWrapper.promise)

        // Wait if we've hit max concurrency
        if (inFlight.size >= maxConcurrency) {
          await Promise.race(inFlight)
        }
      }

      // Wait for all remaining deletions to complete
      if (inFlight.size > 0) {
        await Promise.all(Array.from(inFlight))
      }

      const totalDeletionTime = Date.now() - deletionStartTime
      const avgDeletionTime =
        deletedCount > 0 ? Math.round(totalDeletionTime / deletedCount) : 0

      core.info(
        `Deleted ${deletedCount} versions in ${totalDeletionTime}ms (avg: ${avgDeletionTime}ms per version)`
      )

      if (totalDeletionTime > 1000) {
        core.warning(
          `Slow deletion phase: ${totalDeletionTime}ms for ${deletedCount} versions`
        )
      }

      core.endGroup()
    } catch (error) {
      // Fail the workflow run if an error occurs
      if (error instanceof Error) core.setFailed(error.message)
    }
  }
}
