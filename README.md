# ghcr.io Container Repository Cleanup Action

[![GitHub Super-Linter](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/linter.yml/badge.svg?branch=main)](https://github.com/super-linter/super-linter)
![CI](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/ci.yml/badge.svg?branch=main)
[![Check dist/](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/autofix.yml/badge.svg?branch=main)](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/autofix.yml)
[![CodeQL](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/jenskeiner/ghcr-container-repository-cleanup-action/actions/workflows/codeql-analysis.yml)
[![codecov](https://codecov.io/github/jenskeiner/ghcr-container-repository-cleanup-action/branch/main/graph/badge.svg?token=X84LE2UUQT)](https://codecov.io/github/jenskeiner/ghcr-container-repository-cleanup-action)

This GitHub Action deletes tags and versions (container images) from a GitHub
Container Registry (ghcr.io) package repository. It is based on
[Ghcr Cleanup Action](https://github.com/dataaxiom/ghcr-cleanup-action) but with
different semantics.

## Features

- Support for GitHub user/organization repositories
- Deleting images by tag
- Keeping images by tag
- Keeping a number tagged images
- Keeping a number of untagged images
- Multi-architecture image support
- Support for OCI 1.0 referrers tag schema
- Support for OCI 1.1 referrers API
- Support regular expressions for tag include/exclude options

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
options. If all options are absent, no deletions occur. If a version is matched
by two conflicting options, the version is kept.

This action ensures that the integrity of multi-arch images and referrers (used
e.g. for attestations) is preserved. That is, no new dangling references are
left in the reppository after running this action.

### Overview

The action first scans the package repostory and establishes links between
related images. For example, multi-architecture image manifests point to the
corresponding singe-architecture image manifests (linking parent to child),
while other artifacts point to their referred image (linking child to parent).
See the [Glossary](#glossary) and
[Container Registry Architecture](#container-registry-architecture) sections for
details.

Throughout the process, a set of tags to delete (keep) and a set of versions to
delete (keep) are maintained.

1. **`include-tags`**: Matches tags to delete and their related versions.
2. **`exclude-tags`**: Matches tags to keep and their related versions.
3. **`keep-n-tagged`**: Retains the specified number of most recent tags not
   matched by previous options.
4. **`keep-n-untagged`**: Keeps the specified number of most recent untagged
   images not matched by previous options.
5. **Final Deletion**: All tags (versions) that are in the set to delete, but
   not in the set to keep, are deleted. The integrity of multi-architecture
   images and all referrers is preserved.

### `include-tags`

This option specifies a regular expression to match tags in the package
repository. Matching tags are added to the set of tags to delete. For each
matching tag, the corresponding version and its children are added to the set of
versions to delete.

### `exclude-tags`

This option works like `include-tags`, but adds matching tags and versions to,
respectively, the set of tags and versions to keep.

Any tag and version selected by `include-tags` and `exclude-tags` at the same
time is kept, so `exclude-tags` trumps `include-tags`. For example, if
`include-tags` is set to `^1.[0-3]$` and `exclude-tags` is set to `^1.1$`, then
versions `1.0`, `1.2`, `1.3` would be deleted, but not version `1.1`.

Also, in the unlikely case that `1.0` and `1.1` are multi-architecture images
that share one or more child images, these children would also not be deleted to
keep the integrity of version `1.1`.

### `keep-n-tagged`

This option selects from the tags not matched by `include-tags` or
`exclude-tags`. These remaining tags are ordered by modification date of the
underlying version. The given number of most recent tags and their corresponding
versions, including any children, are added to the set of tags/versions to keep,
respectively. All other tags and their versions are likewise added to the set of
tags/versions to delete.

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
the given number of most recent versions and their children are added to the set
of versions to keep. All remaining versions and their children are added to the
set of versions to delete.

Note: In contrast to the previous options which select tags, this option only
considers top-level versions, i.e. those that are not a child to another
version. This is done to always preserve the integrity of all relationships
between image manifests. In most cases, options that select tags will also only
operate on these top-level versions, but in edge cases, child images may also be
tagged and thus selected.

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
          exclude-tags: '^(?:main|master|develop|\d+(?:\.\d+){0,2}|pr-\d+)$'
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

## Container Registry Architecture

The original open source container registry implementation goes under the name
_Registry_ and was originally devloped at
[Docker Inc](https://docs.docker.com/registry/). The project has since been
donated to the [CNCF](https://www.cncf.io/) where it now goes under the name
_Distribution_. Today, various registry implementations like
[GitHub Container Registry](https://ghcr.io) exist and unfortunately, they all
differ in subtle ways.

### OCI

Alongside the popularization of Docker, the
[Open Container Initiative](https://opencontainers.org/) has developed
specifications for
[container image formats](https://github.com/opencontainers/image-spec) and
[distribution](https://github.com/opencontainers/distribution-spec).

### Docker Registry

Docker's initial Registry implementation was meant to store single
architecture-specific images. Each image is represented by a JSON manfest,
identified by a unique digest, which mostly contains pointers to blobs that make
up the layers of the corresponding image. An image can optionally be tagged to
make it identifiable not only through the digest. Deleting an image entails
deleting the corresponding manifest. Deleting any dangling blobs, i.e. the
actual payloads referenced by a manifest, is a separate garbage collection
process typically handled automatically by the registry.

### Multi-architecture Images

Multi-architecture images introduced relationships between images. A multi-arch
image is simply a manifest that contains a list of pointers to
single-architecture images. Each multi-architecture image is thus typically a
tree of depth 1. Deleting a multi-architecture image now requires to delete the
root manifest as well as all of its children.

This change introduced new risks. If a single-architecture image gets deleted,
but a referring manifest is not updated appropriately, this would leave the
registry in an inconsistent state. Any attempt to donwload the
single-architecture image pointed to by the multi-architecture manifest would
fail.

An unlikely, but entirely possible edge case is when two multi-architecture
images share a common single-architecture image. Recursively deleting one
multi-architecture image and its children would leave a dangling reference in
the second multi-architecture image.

Another rather theoretical case is when a single multi-architecture image refers
to the same single-architecture image more than once. By definition, all child
images should be for a different architecture, so in practice this should not
happen.

Note that single-architecture images may also be tagged, although it is very
common to only tag the multi-architecture manifest and not the
single-architecture images below. But it is a possibility.

### Attestations and Other Artifacts

Newer OCI specifications added the capability to store additional content in
registries to enhance container images. For example, a _software bill of
materials_ (SBOM) can be used to improve software supply chain security by
declaring components used to build a particular image, _attestations_ provide
cryptographically verifiable information on e.g. how a particular image was
built.

The common theme is that the additional content does not contain a container
image, but metadata that is associated with an actual container image.
Correspondingly, a relationship needs to be established between the additional
manifest and the manifest it refers to.

The
[OCI distribution specification version 1.1.0](https://github.com/opencontainers/distribution-spec/blob/v1.1.0/spec.md)
introduced the optional
[Referrers API](https://github.com/opencontainers/distribution-spec/blob/v1.1.0/spec.md#listing-referrers).
According to the specification, manifests may contain a `subject` field pointing
to another manifest via its digest, thereby making it clear that this manifest
does not represent an actual container image, but that it enhances another
artifact, typically an actual container image.

Since the referrers API is optional, a fallback scheme mandates an alternative
way of relating a manifest to another, the
[referrers tag schema](https://github.com/opencontainers/distribution-spec/blob/main/spec.md#referrers-tag-schema).
Here, instead of including a `subject` field, the manifest is tagged with the
digest of the referred manifest. To satisfy the rules for tags, the digest
`<alg>:<digest>` is replaced with `<alg>-<digest>` to form the tag.

### Summary

In summary, container registries may implement different standards and may
differ in subtle ways. The contained images will often form a forest, where each
root is a multi-architecture image. However, relationships between the different
manifests may be specified in different ways. In some cases, like a
multi-architecture manifest pointing to the corresponding single-architecture
manifests, the parent points to its children. In other cases, like the referrers
tag schema, the child points to its parent.

This action tries to be as standard-agnostic as possible. To that end, it can
discover relationships between manifests when a parent points to its child, or
vice versa. By arranging all related manifests in a proper tree structure, the
integrity of all relationships can be maintained when deleting select container
images. The action also does assume as little as possible to be able to handle
uncommon cases, like tagged single-architecture child images or shared child
images.
