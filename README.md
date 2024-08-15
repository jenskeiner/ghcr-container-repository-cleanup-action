# ghcr.io Container Repository Cleanup Action

[![GitHub Super-Linter](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/linter.yml/badge.svg?branch=main)](https://github.com/super-linter/super-linter)
![CI](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/ci.yml/badge.svg?branch=main)
[![Check dist/](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/autofix.yml/badge.svg?branch=main)](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/autofix.yml)
[![CodeQL](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

A workflow action that deletes tags and versions (container images) from a
GitHub Container Registry (ghcr.io) package repository.

This action is originally based on
[Ghcr Cleanup Action](https://github.com/dataaxiom/ghcr-cleanup-action), but has
different semantics.

Includes the following features:

- Supports GitHub user/organization repositories.
- Delete images by tag matching a regular expression.
- Keep images by tag matching a regular expression.
- Keep a number of most recent remaining tags
- Keep a number of most recent untagged images, respectively.
- Multi-architecture image support.

## Glossary and Terms

GitHub Packages is a software package hosting service and supports different
package types, like npm packages. This action only targets packages of type
`container`, meaning Docker/container images.

The contents of a _package_ are stored in a _package repository_. Each package
repository holds different _versions_ of the corresponding package. For
container images, a version is a single _container image_. Each image may be
associated with one or more tags. Also, an image can either be a
single-architecture image, a multi-architecture image, or an attestation image.
Multi-architecture images consist of references to single-architecture and/or
attestation images, thereby creating cross-links between different versions in
the package repository. We will use the terms (_container_) _image_ and
(_package_) _version_ interchangably.

## Setup

### Token Permissions

The injected GITHUB_TOKEN needs permissions to delete images/package versions
from the package repository. Ensure permissions are set up correctly:

- In project Settings > Actions > General set the Workflow permissions option to
  "Read and write permissions", or
- Set the permissions directly in the workflow by setting the packages value to
  write.

  ```yaml
  jobs:
    delete-package-versions:
      name: Delete Package Versions
      runs-on: ubuntu-latest
      permissions:
        packages: write
  ```

### Action Options

| Option          | Required | Defaults        | Description                                                 |
| --------------- | :------: | --------------- | ----------------------------------------------------------- |
| token           |   yes    |                 | Token used to connect with `ghcr.io` and the packages API   |
| owner           |    no    | project owner   | The repository owner, can be organization or user type      |
| repository      |    no    | repository name | The repository name                                         |
| package         |    no    | repository name | The package name                                            |
| include-tags    |    no    |                 | Regular expression matching tags to delete                  |
| exclude-tags    |    no    |                 | Regular expression matching tags to keep                    |
| keep-n-tagged   |    no    |                 | Number of remaining tags to keep, sorted by date            |
| keep-n-untagged |    no    |                 | Number of remaining untagged images to keep, sorted by date |
| dry-run         |    no    | false           | Whether to simulate action without actual deletion          |

## How package versions to delete are determined

The package versions to delete are determined through the combination of the
options `include-tags`, `exclude-tags`, `keep-n-tagged`, and `keep-n-untagged`,
all of which are optional. Nothing is deleted if all options are absent.

During processing of the options, the action keeps track of the following sets:

- tags to delete
- tags to keep
- versions to delete
- versions to keep

### `include-tags`

This option specifies a regular expression to match tags in the package
repository. Matching tags are added to the set of tags to delete. For each
matching tag, the corresponding version is added to the set of versions to
delete. If a selected version is a multi-architecture image, all child versions
(single-architecture images, attestations) reachable from there are also added
to the set of versions to delete.

### `exclude-tags`

This option works like `include-tags`, but collects matching tags, and the
corresponding versions and their children in the set of tags to keep and the set
of versions to keep, respectively.

Any tag and version selected by `include-tags` and `exclude-tags` at the same
time is kept, so `exclude-tags` trumps `include-tags`. For example, if
`include-tags` is set to `^1.[0-3]$` and `exclude-tags` is set to `^1.1$`, then
versions `1.0`, `1.2`, `1.3` would be deleted, but not version `1.1`.

Also, in the unlikely case that `1.0` and `1.1` are multi-architecture images
that share one or more child images, these children would also not be deleted to
keep the integrity of version `1.1`. More on that below.

### `keep-n-tagged`

This option selects the given number of tags after `include-tags` and
`exclude-tags` options have been processed. All tags matched by neither
`include-tags` nor `exclude-tags` are ordered by date and the most recent tags,
the corresponding versions and their children are added to the set of
tags/versions to keep, respectively. The remaining tags and their related
versions are added to the set of tags/versions to delete, respectively. If the
option is not set, the number of tags to keep is implicitly set to the number of
all remaining tags.

Continuing the example from above, if the repository contains the tags `1.0`,
`1.1`, ..., `1.9`, then the tags not matched by either `include-tags` or
`exclude-tags` are `1.4`, `1.5`, ..., `1.9`. If `keep-n-tagged` is set to `2`,
then the tags `1.8` and `1.9` would be kept, while `1.4`, `1.5`, `1.6` and `1.7`
would be deleted. This assumes that the versions were created in ascending
order.

Again, to keep the integrity of multi-architecture images, any child images that
are referenced both by a version that should be kept and one that should be
deleted, are kept.

### `keep-n-untagged`

This option selects untagged versions after `include-tags`, `exclude-tags`, and
`keep-n-tagged` options have been processed. All remaining versions neither
included in the versions to delete, nor included in the versions to keep so far
are ordered by date. The given number of most recent versions are added to the
set of version to keep. The rest is added to the versions to delete. If the
option is not set, the number of versions to keep is implicitly set to the
number of all remaining versions.

Note that using this option may break untagged multi-architecture images as all
untagged images processed by this option are treated the same.

### Deletion

After all options from above have been processed, the final set of tags/versions
are determined by removing all tags/versions to keep from the tags/versions to
delete. This ensures the integrity of all tags and tagged multi-architecture
images.

For example, assume a version V carries two tags, A and B, and that tag A should
be deleted while tag B should be kept. The final set of tags to delete is {A} \
{B} = {A}, but the final set of versions to delete in {V} \ {V} = {}, the empty
set. Therefore, only the tag A is removed. Version V cannot be removed because
tag B should be kept and needs to remain attached to V.

### Dry run

You can use the `dry-run` option to prevent the action from actually deleting
any tags and versions. This can be helpful to test the configuration of the
action.

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

## Notes

### Do a dry-run

Test the cleanup action first by setting the `dry-run` option to `true` and then
reviewing the workflow log. This mode will simulate the cleanup action but will
not delete any tags or images.

### Package Restoration

GitHub has a package restoration API capability. The package IDs are printed in
the workflow log where the ghcr-cleanup-action is run.

[Restore Organization Package](https://docs.github.com/en/rest/packages/packages?apiVersion=2022-11-28#restore-package-version-for-an-organization)

[Restore User Package](https://docs.github.com/en/rest/packages/packages?apiVersion=2022-11-28#restore-a-package-version-for-the-authenticated-user)
