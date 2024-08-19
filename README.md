# ghcr.io Container Repository Cleanup Action

[![GitHub Super-Linter](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/linter.yml/badge.svg?branch=main)](https://github.com/super-linter/super-linter)
![CI](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/ci.yml/badge.svg?branch=main)
[![Check dist/](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/autofix.yml/badge.svg?branch=main)](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/autofix.yml)
[![CodeQL](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

This GitHub Action deletes tags and versions (container images) from a GitHub
Container Registry (ghcr.io) package repository. It is based on
[Ghcr Cleanup Action](https://github.com/dataaxiom/ghcr-cleanup-action) but with
different semantics.

## Features

- Support for GitHub user/organization repositories
- Deletion of images by tag matching a regular expression
- Retention of images by tag matching a regular expression
- Retention of a specified number of most recent remaining tags
- Retention of a specified number of most recent untagged images
- Multi-architecture image support

## Glossary

- **Package**: A software package hosted on GitHub Packages. This action targets
  only packages of type `container` (Docker/container images).
- **Package Repository**: Storage for different versions of a package.
- **Version**: A single version within a package repository. This can be
  - a _single-architecture_ container image
  - a _multi-architecture_ container image which is effectively a list of
    pointers to other versions/images
  - an attestation image which is a cryptographically secured asset that proves
    the provenance of an actual version/image.
- **Digest**: A hash value that serves as a unique identifier for each
  version/image.
- **Manifest**: Each package version's contents are described by a JSON
  structure called a manifest.
- **Tag**: An identifier associated with a version. Typically used as a more
  human-readable alternative to the digest. Tags can be changed, e.g. moved from
  one version to another, while the digest is fixed and created from the
  contents of the version.

Note that the terms version and manifest are used interchangeably. Also, where
necessary, it will be clear from the context whether a version or manifest
relates to a single-architecture image, a multi-architecture image, or an
attestation image.

## Integrity

Since package repositories that host container images may contain cross-links
between the contained versions, it is possible to create situations where the
integrity of the contained versions is no longer maintained. For example, if a
version/single-architecture image referenced by another
version/multi-architecture image is deleted, the multi-architecture image will
contain a dangling reference to the noew deleted version/single-architecture
image.

This action ensures the integrity of the package repository by only deleting
versions that are safe to delete and that do not leave any dangling references.
To that end, it is possible that the action may keep some versions that would
otherwise be deleted; see particularly the `keep-n-untagged` option.

## Setup

### Token Permissions

The injected GITHUB_TOKEN `GITHUB_TOKEN` needs permissions to delete
images/package versions. Set up permissions by:

1. In project Settings > Actions > General, set workflow permissions to "Read
   and write permissions", or
2. Set the permissions directly in the workflow:

```yaml
jobs:
  delete-package-versions:
    name: Delete Package Versions
    runs-on: ubuntu-latest
    permissions:
      packages: write
```

### Action Options

| Option          | Required | Default         | Description                                                  |
| --------------- | :------: | --------------- | ------------------------------------------------------------ |
| token           |   Yes    |                 | Token for `ghcr.io` and packages API authentication          |
| owner           |    No    | Project owner   | Repository owner (organization or user)                      |
| repository      |    No    | Repository name | Name of the repository                                       |
| package         |    No    | Repository name | Name of the package                                          |
| include-tags    |    No    |                 | Regular expression matching tags to delete                   |
| exclude-tags    |    No    |                 | Regular expression matching tags to keep                     |
| keep-n-tagged   |    No    |                 | Number of remaining tags to keep (sorted by date)            |
| keep-n-untagged |    No    |                 | Number of remaining untagged images to keep (sorted by date) |
| dry-run         |    No    | false           | Simulate action without actual deletion                      |

## Deletion Process

The action determines which package versions to delete based on the combination
of `include-tags`, `exclude-tags`, `keep-n-tagged`, and `keep-n-untagged`
options. If all options are absent, no deletions occur.

### Process Overview

Throughout the process, a set of tags to delete (keep) and a set of versions to
delete (keep) are maintained.

1. **`include-tags`**: Matches tags to delete and their corresponding versions.
2. **`exclude-tags`**: Matches tags to keep and their corresponding version. A
   version matched by `include-tags` as well as `exclude-tags` is kept.
3. **`keep-n-tagged`**: Retains the specified number of most recent tags not
   matched by previous options.
4. **`keep-n-untagged`**: Keeps the specified number of most recent untagged
   images not matched by previous options.
5. **Final Deletion**: All tags (versions) that are in the set to delete, but
   not in the set to keep, are deleted. The integrity of multi-architecture
   images is preserved.

### `include-tags`

This option specifies a regular expression to match tags in the package
repository. Matching tags are added to the set of tags to delete. For each
matching tag, the corresponding version - or versions if it's a
multi-architecture image - are added to the set of versions to delete.

### `exclude-tags`

This option works like `include-tags`, but adds matching tags and versions to
the set of tags and versions to keep, respectively.

Any tag and version selected by `include-tags` and `exclude-tags` at the same
time is kept, so `exclude-tags` trumps `include-tags`. For example, if
`include-tags` is set to `^1.[0-3]$` and `exclude-tags` is set to `^1.1$`, then
versions `1.0`, `1.2`, `1.3` would be deleted, but not version `1.1`.

Also, in the unlikely case that `1.0` and `1.1` are multi-architecture images
that share one or more child images, these children would also not be deleted to
keep the integrity of version `1.1`.

### `keep-n-tagged`

This option selects from the tags not matched by `include-tags` or
`exclude-tags`. These remaining tags are ordered by date and the given number of
most recent tags and their corresponding versions are added to the set of
tags/versions to keep, respectively. All other tags and their versions are
likewise added to the set of tags/versions to delete.

If the option is not set, all remaining tags and their versions are kept.

Continuing the example from above, if the repository contains the tags `1.0`,
`1.1`, ..., `1.9`, then the tags not matched by either `include-tags` or
`exclude-tags` are `1.4`, `1.5`, ..., `1.9`. If `keep-n-tagged` is set to `2`,
then the tags `1.8` and `1.9` would be kept, while `1.4`, `1.5`, `1.6` and `1.7`
would be deleted. This assumes that tagged versions versions were created in
ascending order.

### `keep-n-untagged`

This option selects untagged versions not matched by `include-tags`,
`exclude-tags`, or `keep-n-tagged`. These versions are also ordered by date and
the given number of the most recent versions is added to the set of versions to
keep. All remaining versions are added to the set of versions to delete.

However, to preserve the integrity of multi-arch images, it may actually be
necessary to keep a few more versions than strictly specified. In such case,
`keep-n-untagged` is only a lower bound.

### Edge cases

While the options should mostly work intuitively, some edge cases should be
considered. This affects typically the `keep-n-untagged` option since the
ordering by date and the requirement to maintain the integrity of
multi-architecture images can conflict.

In most situations, a single multi-architecture image and its
single-architecture children will have timestamps relatively close to each
other, so that ordering untagged images by the timestamp will keep related
images together. Also, the multi-architecture version/manifest is created last,
after all single-architecture images, since it needs to reference the
single-architecture images by their digest.

However, there could be situations where the timestamps of images belonging to
two different multi-architecture images are interleaved. In this siutation, it
may happen that the more recent multi-architecture manifest is added to the list
of versions to keep, but after also adding the child images to the set, the
number of untagged images to keep is already reached or exceeded. In this case,
the second multi-architecture image and its children would not be kept, even
though some images related to that version are newer than some other images
related to the first version. This behaviour ensures the integrity of
multi-architecture images while also ensuring that the number of untagged images
to keep is typically only exceeded by a relatively small number.

### Final Deletion

After all options have been processed, the final set of tags/versions to delete
are determined by removing all tags/versions to keep from the tags/versions to
delete.

For example, assume a version V carries two tags, A and B, and that tag A should
be deleted while tag B should be kept. The final set of tags to delete is {A} \
{B} = {A}, but the final set of versions to delete in {V} \ {V} = {}, the empty
set. Therefore, only tag A is removed. Version V cannot be removed because tag B
should be kept and needs to remain attached to V.

Finally, the tags and versions that are safe to delete are actually deleted.

## Best Practices

1. **Dry Run**: Always test your configuration using the `dry-run: true` option
   before performing actual deletions.
2. **Regular Maintenance**: Set up a periodic workflow to clean up obsolete
   images and maintain an efficient repository.
3. **Careful Configuration**: Double-check your regular expression patterns and
   keep counts to avoid unintended deletions.

## Examples

### Delete specific tagged images

Set the `include-tags` option to delete specific tags and their images.

```yaml
jobs:
  - name: ghcr.io container repository cleanup action
    runs-on: ubuntu-latest
    steps:
      - uses: jenskeiner/ghcr-container-repository-cleanup-action@v1
        with:
          include-tags: mytag|mytag2
          token: ${{ secrets.GITHUB_TOKEN }}
```

This will delete `mytag` and `mytag2`, as well as the corresponding images and
child images, unless they need to be kept to ensure integrity of other tags and
images.

This mode is useful, e.g. when tags related to a pull request should be deleted
when the pull request is closed.

```yaml
name: Cleanup Pull Request Images
on:
  pull_request:
    types: [closed]
jobs:
  ghcr-cleanup-image:
    name: Cleanup
    runs-on: ubuntu-latest
    steps:
      - name: Delete pull request tags and images
        uses: jenskeiner/ghcr-container-repository-cleanup-action@v1
        with:
          include-tags: pr-${{github.event.pull_request.number}}
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Keep specific tagged images and delete everything else

To delete everything except specific tags and their images, use the
`exclude-tags` option and set `keep-n-tagged` and `keep-n-untagged` to zero.

```yaml
jobs:
  - name: ghcr.io container repository cleanup action
    runs-on: ubuntu-latest
    steps:
      - uses: jenskeiner/ghcr-container-repository-cleanup-action@v1
        with:
          exclude-tags: mytag|mytag2
          keep-n-tagged: 0
          keep-n-untagged: 0
          token: ${{ secrets.GITHUB_TOKEN }}
```

This will delete all tags and images except `mytag1`and `mytag2` and their
related images.

This mode is useful for a periodicly triggered workflow that cleans up obsolete
images from a package repository.

```yaml
name: Periodic Repository Cleanup
on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  ghcr-cleanup-image:
    name: Cleanup
    runs-on: ubuntu-latest
    steps:
      - name: Delete obsolete tags and images
        uses: jenskeiner/ghcr-container-repository-cleanup-action@v1
        with:
          # Don't delete main, master, develop, semantic version tags,
          # and pull request tags.
          exclude-tags: '^main|master|develop|\d+(?:\.\d+){0,2}|pr-\d+$'
          keep-n-tagged: 0
          keep-n-untagged: 0
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Keeping a number of recent tags or images

THere may be reasons to keep a certain number of tags and images not covered by
`exclude-tags`. In this case, use `keep-n-tagged` and `keep-n-untagged` options
with a positive value.

```yaml
jobs:
  - name: ghcr.io container repository cleanup action
    runs-on: ubuntu-latest
    steps:
      - uses: jenskeiner/ghcr-container-repository-cleanup-action@v1
        with:
          exclude-tags: mytag|mytag2
          keep-n-tagged: 3
          keep-n-untagged: 3
          token: ${{ secrets.GITHUB_TOKEN }}
```

In addition to `mytag1`and `mytag2` and their images, this will keep the three
most recent tags and their images, as well as the three most recent untagged
images not already covered by the previous options.

### Override default owner/repository/package

The default settings will use the current project to determine the owner,
repository and package name but for cross project and multiple package support
these can be overriden by setting owner, repository and package values.

```yaml
jobs:
  - name: ghcr.io container repository cleanup action
    runs-on: ubuntu-latest
    steps:
      - uses: jenskeiner/ghcr-container-repository-cleanup-action@v1
        with:
          owner: myowner
          repository: myrepo
          package: mypackage
          token: ${{ secrets.GITHUB_TOKEN }}
          ...
```

## Package Restoration

GitHub has a package restoration API capability. The package IDs are printed in
the workflow log where the ghcr-cleanup-action is run.

[Restore Organization Package](https://docs.github.com/en/rest/packages/packages?apiVersion=2022-11-28#restore-package-version-for-an-organization)

[Restore User Package](https://docs.github.com/en/rest/packages/packages?apiVersion=2022-11-28#restore-a-package-version-for-the-authenticated-user)
