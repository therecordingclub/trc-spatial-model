# Model deployment

Canonical source: this repository. The editable reconstruction and its source
photographs remain in `/Users/gregspero/image-blaster/trc-model` and
`/Users/gregspero/image-blaster/captures/trc-2026-09-05`.

The live target is the existing `trc-beta-apps` Fly machine. The model uses
host-specific static middleware in `/Users/gregspero/trc-beta-apps-deploy`.
It adds no child process, port, machine, volume, or separate application.
Model buffers and textures use this repository's existing
[GitHub Pages asset directory](https://therecordingclub.github.io/trc-spatial-model/model/v13-details/trc-web-v13-details.gltf).
Large downloadable files use the existing
[versioned release](https://github.com/therecordingclub/trc-spatial-model/releases/tag/v13-details).

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
   Use `GRID_PANE=codex-0` for this Codex pane. The local smoke check must use the
   installed Node ABI (`~/.gregbot-runtime/node-dist/bin/node`); Docker independently
   installs production dependencies on Node 24. Preserve the existing authenticated
   environment when invoking the deploy from its repository.
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

Recovery release 170 is live on the same machine `d8d2e50f0d9168`, with the same
2 shared CPUs and 2 GB memory. The public DNS record is now an unproxied A record
to `66.241.124.140`. Source commit `d6b507c` in the shared-host repository includes
the site snapshot `866a1c8`. Sixteen origin checks matched the committed files;
all required shared-host probes passed. The public release manifest and room
walkthroughs were verified after cutover. DNS rollback restores the original
unproxied CNAME `cname.vercel-dns.com` (automatic TTL); preserve the Vercel project.

Restored historical architecture files remain unchanged. Their historical
source paths can refer to temporary extraction files; `site/sources/source-index.json`
maps seven retained plans by filename, size, and SHA-256 without changing that baseline.

## Verified September 9 releases

V11 and smooth held-key controls are live in shared-host release 173, source
`245664b`, with the static site from `899ed89`. Eight public files match their
committed hashes, including the stable V11 manifest. The complete candidate
passed 19 room walkthrough checks in existing Chrome; three representative
room captures passed again on the public release. Held-arrow tests passed for
the main viewer and photographic lobby. Short Mezzanine and Patio movement
samples showed no observed regression against V10. Independent Astra review
approved V11 as a finish update, with the spatial limitations retained.

The same single machine remains at two shared CPUs and 2 GB RAM. Every required
shared-host post-deploy probe passed. V10 versioned manifests, buffers and both
downloadable source artifacts remain available for rollback.

V12-r2 is now the default in shared-host release 174, source `85198dd`, with the
static site snapshot `b2b9b269c68fc99cb1fb54fc9b5a559b77d5403a`. It adds Lounge
painted masonry and window grilles, reusing all 119 V11 images and adding
267,744 bytes of geometry. Existing geometry, materials and all 801 UV accessors
are preserved. Source/export validation passed 42 checks; independent Astra
review approved the bounded finish update after all 19 existing-Chrome room
captures and eight wall-control checks passed.

Nine public files match the committed bundle. All six versioned download routes
resolve correctly, and fresh unauthenticated V12 GLB and Blender downloads match
their published sizes and SHA-256 values. Four representative public room
walkthroughs and all eight wall-control checks passed after deployment. The
same single machine, CPU/memory sizing and volume remain in place; every required
shared-host probe passed. Public proof is retained locally at
`workbench/deployment-2026-09-08/public-v12-r2-proof-v1.0.json`.

The later V11/V12 movement comparison was inconclusive during heavy Mac load.
Both raw reports passed 11 of 13 checks; two settling checks used a fixed frame
window that included early braking at low frame rates. Time-based review found
no continuing movement after settling, but the mixed timings do not establish
sustained performance or isolate an asset regression. Do not claim a frame-rate
guarantee. Lounge masonry cadence, grille counts and ornament remain approximate.

## V13 promotion

V13 adds photo-supported seating, fabrics, console controls, keyboard keys,
instrument forms and ceiling fixtures. The runtime selects at most eight local
lights and two local shadow lights. The source passes 261 preservation checks;
the independent publication audit passes all 25 checks. All 19 room walkthroughs,
11 visibility controls, 13 held-key behaviors and the actual room-lighting probe
passed in Greg's existing Chrome. Independent Astra approved the final R3 export
as an incremental appearance improvement, with existing accuracy gaps retained.

The canonical GLB SHA-256 is
`c9682adf85ee4bff81f8f5b80f249cd9f9234f0eace9993c4be54f2c48faefe5`;
the editable source SHA-256 is
`afa52298f21909256b50334bb4fa4d6ebf0788d8578e3dfe891d7f3b6d861bf1`.
Seven new dependency files reuse the existing V11 payloads for unaffected data.
V10, V11 and V12 assets and downloads remain available.

V13 is live in shared-host release 175, source `33366e9`, using site snapshot
`bbd3eeaa6b864579e829ca2ba8a161956f0c0610`. Eleven public files match their
committed hashes. All eight versioned routes resolve correctly; fresh public
downloads of both complete source artifacts match the reviewed sizes and hashes.
All 115 unique glTF dependencies are reachable and match the local files.
Four representative public room walkthroughs, 11 visibility controls, the room
lighting probe and all 13 held-key behaviors passed in the existing Chrome.

The existing machine, CPU/memory sizing and volume are unchanged. The standard
deploy's neighboring-app probes passed. The expanded verifier checks the
protected agents `/staff/mod` endpoint for 401 and the public staff login for
200; that staff availability check does not certify its authorization policy.
The first expanded report's incorrect root-page 401 expectations remain recorded
in `workbench/v13-details-2026-09-09/evidence/publication-audit/public-v13-proof-v1.0.json`.
Native full-window captures remain unavailable because ScreenCaptureKit is
quarantined; actual main-Chrome WebGL and DOM proofs remain available.

## Accuracy boundaries

The 19 modeled rooms combine plans and photographs. Equipment placement,
finishes, and several ceiling heights remain inferred. The second upstairs area
(124.51 square feet), stair registration, and indoor-to-outdoor registration are
unresolved. New photographs can improve appearance; these spatial relationships
need connected capture or site measurements before they can be certified.
