# Model deployment

Canonical source: this repository. The editable reconstruction and its source
photographs remain in `/Users/gregspero/image-blaster/trc-model` and
`/Users/gregspero/image-blaster/captures/trc-2026-09-05`.

The recovery target is the existing `trc-beta-apps` Fly machine. The model uses
host-specific static middleware in `/Users/gregspero/trc-beta-apps-deploy`.
It adds no child process, port, machine, volume, or separate application.
Model buffers and textures use this repository's existing
[GitHub Pages asset directory](https://therecordingclub.github.io/trc-spatial-model/model/trc-web-v10-webp.gltf).
Large downloadable files use the existing
[versioned release](https://github.com/therecordingclub/trc-spatial-model/releases/tag/v10-webp).

`site/reconstruction/web-manifest.json` selects the current model.
Versioned manifests and original assets remain available for rollback.
`site/downloads.json` declares the supported legacy download redirects.

## Release checks

1. Run `node tools/verify-static-release.mjs` and check the export's source,
   geometry, material and room-coverage reports.
2. Copy the static site into `apps/trc-spatial-model-static` in the shared host
   repository, excluding `.vercel` and other dotfiles. Record file hashes.
3. Verify the complete candidate in Greg's existing Chrome, including room
   navigation, download links and the photographic lobby. Obtain independent
   Astra review before promoting a changed model.
4. Commit the narrowly scoped shared-host changes on its required `main` branch.
   Push `backup main` only as a backup; it does not deploy anything.
5. Deploy the shared host only with its `bin/deploy`, which owns the deployment
   lock and checks the pinned applications. Never change machine sizing or count.
6. Check the model on the Fly origin with the intended host and valid TLS before
   moving the single public DNS record. Recheck the public asset hashes and all
   existing host probes after the change.

Before a model asset release, identify the exact GitHub branch and Pages target.
Pages currently builds `main:/docs`; a branch push alone does not publish assets.
Keep each model version in a distinct asset directory. Never replace a prior
release file or publish an unverified source/export combination.

## Recovery baseline

The September 8 check found the V10 viewer rendering in existing Chrome.
Four download paths were missing. The old deployment remains on Vercel as a
rollback target, with DNS CNAME `cname.vercel-dns.com`. Keep it intact during
cutover. Shared-host baseline: release 169, source commit `5500fc7`.

Restored historical architecture files remain unchanged. Their historical
source paths can refer to temporary extraction files; a source archive index
will map those records to retained plans without changing the geometry baseline.

## Accuracy boundaries

The 19 modeled rooms combine plans and photographs. Equipment placement,
finishes, and several ceiling heights remain inferred. The second upstairs area
(124.51 square feet), stair registration, and indoor-to-outdoor registration are
unresolved. New photographs can improve appearance; these spatial relationships
need connected capture or site measurements before they can be certified.
