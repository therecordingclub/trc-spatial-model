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

## V14 chair correction

V14 rotates the four complete Lounge chair assemblies 180 degrees around their
unchanged seat centers. Their backs now sit beside the west wall and their
openings face the sofa. Source preservation passes 75 checks; independent browser
preservation passes 28 checks. All 9,702 scoped vertices rotate correctly, with
every other node, material, image and UV preserved. Independent Astra rates the
bounded correction 4/4 SHIP. Two existing-Chrome room captures and all 11
visibility controls pass. The earlier source and released assets remain intact.

The canonical GLB SHA-256 is
`afb901e0f895fdc089a3fde84d507f3412061c2117cbee97419d0a0cddcefac1`;
the editable source SHA-256 is
`be314d0f7a8500640558354b8b87e8713d37abab34efd241a219ee4551aba768`.
Only 650,544 bytes of additional browser geometry are required. The earlier
V13 review is superseded for chair direction by its retained production addendum
v1.1 and the fresh V14 gate in `workbench/v14-lounge-chairs-2026-09-09/evidence`.

The runtime is unchanged. The candidate's repeated held-key timing probe was
inconclusive in a background tab; the foreground policy refused window
activation. The probe was stopped by reloading the owned tab. Existing V13
behavior evidence and passing focused movement tests remain available; this
release does not claim a fresh timing pass or a sustained frame-rate guarantee.
That release preceded the V15 building, door and fireplace correction below.

## V15 building and fixed features

V15 adjusts Kitchen and Lounge door openings, the Lounge entry recess, and
four rooms' usable floor and ceiling surfaces. The planning view now uses the
same room boundaries and exclusions. Furniture placement rejects bathroom
cutouts and concave boundary crossings. Both detailed and fallback walking
collision paths pass the actual browser checks.

The photo-referenced Kitchen includes a tapered fireplace hood, recessed cast
surround, rectangular inner aperture, window wall, gabled ceiling, beams,
cabinetry, appliances and furnishings. The west Lounge door has a black leaf
inside a light casing. Existing source materials, images, unaffected browser
data and the V14 chair correction remain intact.

The editable source passes 1,427 preservation checks and the independent source
audit passes 27 checks. The preserving browser overlay passes 12 checks and adds
26,634,784 bytes. All 19 room renders were inspected in existing Chrome; the
final runtime passes 15 planning checks, 18 fixed-feature checks, 12 UI checks
and 14 code tests. V14 also opens under the final runtime. One initial room PNG
retrieval timed out in the Chrome bridge; the remaining rooms passed on the
retained retry. Native full-window capture remains unavailable.

Independent GPT-6 Astra approves the qualified R5/ui2 release at 3/4 SHIP with
no must-fix defects. The gate binds both runtime files and all three model
artifacts. Evidence is preserved under
`workbench/v15-building-2026-09-09/evidence`.

The canonical GLB SHA-256 is
`d6684cee9938bcd07a2cfb3388ead542d4dcd80792d9c69472692fe1da90fc70`;
the editable source SHA-256 is
`787d26785ee1f3fcaf6df94a35228585f66a094cff452c2a882e6d71e29235ff`.
The immutable assets use the
[V15 release](https://github.com/therecordingclub/trc-spatial-model/releases/tag/v15-building)
and the existing GitHub Pages buffer directory. The deployment target remains
the existing shared static route on `trc-beta-apps`; its other applications,
machine count, sizing and volume are preserved.

V15 is live from shared-host commit `ab1715a200762a3f97dad7064d7a1a69901b2561`,
with site snapshot `948d8780843a896c9efd06934dc21b5f09e08f61`. Twelve public
files match the committed bundle, including both runtime modules. All 12
versioned download redirects are correct; complete public GLB and Blender
downloads match the reviewed sizes and SHA-256 values. All 117 unique dependency
URLs are reachable and the additional buffer matches its complete hash.
Seven neighboring host checks pass. The same machine, two shared CPUs,
2 GB memory and existing volume remain in place.

The live model passes all 18 fixed-feature, 15 planning and 12 UI checks in
Greg's main Chrome. Five public detail captures and the actual planning render
are preserved with the production proof at
`workbench/v15-building-2026-09-09/evidence/public-v15-proof-v1.0.json`.

Several dimensions and clearances remain estimated. Fireplace-side storage
bays, softer paper-lantern materials and irregular record groupings remain
documented detail work. Upstairs, stair and outdoor registration require
additional measured or connected reference data.

## V16 structure and photo details

V16 shows full-height walls by default. The Building structure preset frames
the current floor from above and keeps walls, doors, beams, steps and fixed
fixtures visible while hiding movable furniture. Ceiling surfaces have a
separate overview control; walking retains full walls and ceilings. The
existing ground model contains 63 solid wall runs and two intentionally open
boundaries. Coverage checks establish their active endpoints, not a measured
survey of every physical wall or height.

The source adds fireplace-side cabinets, shelves and hanging rails, matte paper
shades, a lower opening and rim on the Kitchen shade, and irregular Lounge
record groups. The 28 existing Lounge pendant parts are classified as ceiling
fixtures and exported separately from furniture. The three lantern rendering
emitters fit within their shades while preserving total emitted power. The
125 source lights, light-pool limits, V15 building geometry and V14 chair
direction remain unchanged.

The R3 source passes 553 preservation checks; preparation passes 14 and asset
assembly passes 12. Independent Astra approves the bounded release at 3/4 with
78 independent asset/served-file checks and 39 source-comparison checks. Final
main-Chrome evidence passes 23 structure, 30 detail and 12 interface checks,
plus both affected room walkthroughs. Unchanged rooms retain the 19-room smoke
evidence. Evidence is under `workbench/v16-detail-2026-09-09/evidence`.

Canonical GLB SHA-256:
`4899867dad8d82fd505cd37a5ebb01a16f10d0df23766a770783452c68d52439`.
Editable source SHA-256:
`2dee6b9153089595ddc5e517064d78da591cded4e7a81e94bf493fa07998ed9d`.
The release uses the existing GitHub Pages asset directory and the existing
shared static route; it adds no application, machine, child process or volume.
All 265 previous versioned asset files remain unchanged.

V16 is live from shared-host commit
`2e17a255da583a3b984107095fd3108235e749cd`, with site snapshot
`84bbc04d44456dd0a6231b2868411a35e3237148`. The existing machine runs image
`deployment-01M251MMZRXYMP2XJR6Q6EK7TD`; its machine identity, two shared CPUs,
2 GB memory, mount and 20 GB volume are unchanged. The standard `bin/deploy`
completed successfully and released its deployment lock.

Twelve public files match the committed bundle. All 14 versioned redirects are
correct; complete public GLB and Blender downloads match the reviewed sizes and
SHA-256 values. All 118 dependency URLs are reachable and the new buffer matches
its full hash. Seven neighboring endpoints retain their expected HTTP status.
The [V16 release](https://github.com/therecordingclub/trc-spatial-model/releases/tag/v16-detail)
contains both correctly named downloadable artifacts.

The public model passes 23 structure, 30 detail and 12 interface checks, plus
both affected room walkthroughs in Greg's existing main Chrome. Independent
GPT-6 Astra inspected all 15 public WebGL captures and approved production at
3/4 SHIP after 24 independent checks. The new public tab was opened at the
[structure view](https://model.therecording.club/?floor=ground&mode=explore&view=structure).
Proof is under `workbench/v16-detail-2026-09-09/evidence`, including
`public-v16-proof-v1.0.json` and `astra-v16-production-gate/gate-v1.0.json`.
Exact-window native capture remains unavailable because ScreenCaptureKit is
quarantined; a successful unrelated desktop capture does not close that UI gap.

This release is an incremental improvement. Missing instruments, framed art,
furniture and other photo details remain active reconstruction work. Record
groupings still repeat, and several dimensions remain inferred.

## V17 Lounge instruments and window

V17 adds five distinct wall instruments, five source-photo artworks, the Lounge
workstation and photographed furnishings. Its south east-wall window and the
actual opening move together to match photo order. The old opening is filled;
the north opening, adjacent wall solids and previous chair directions remain
intact. The structure control reflects its selected visual and accessible state.

The corrected r2 source passes 755 preservation checks. Exactly 11 existing
objects change and 231 are added; 26 materials and five images are added while
all previous materials, images, world settings and 125 lights are preserved.
An independent Astra gate rates the bounded r2 release 3/4 SHIP after 17 fresh
saved-source checks and 14 export checks. The r1 candidate was rejected for
unsupported matching laptop shapes; its gate and artifacts remain preserved.
The correction represents one dark folio device and a separate pale upright
object whose exact identity remains unresolved.

Editable source SHA-256:
`1f1245a9b99437284df825278ebb6a5bbf0061a4edc41c36da7b389e7b448c06`.
Canonical GLB SHA-256:
`0252ef32dba9b83460fbe68819ab3c1167ebaa75a7410f6e38663f511681eb97`.
Public glTF SHA-256:
`40972d327aee50218c8b65d2a8f2145c2627aae1eecfc1f0bc1b89826f726f10`.
Planning revision: `6efb748e21047f53`. The new buffer adds 3,230,696 bytes and
269 existing versioned asset files remain unchanged.

The live static snapshot is source commit
`d430d2e7c3d772520af43bf2bce4e31f7d58179e`, deployed from shared-host commit
`123875c8ac14750597770cfa66b290f7696bd891` with image
`deployment-01M25A9FW6HZSSJBVECMMA71M7`. Seven route tests and the standard
`bin/deploy` passed. The same machine, CPU/memory allocation, mount and 20 GB
volume remain in place. No child service or new infrastructure was added.

Twelve public files match the committed site. All 16 versioned download
redirects are correct, and complete public downloads of the 234,364,188-byte GLB
and 195,762,843-byte Blender source match their hashes. All 119 unique dependency
URLs are reachable; the new buffer matches its complete hash. Seven neighboring
endpoints retain their expected HTTP status. Both artifacts are available in the
[V17 release](https://github.com/therecordingclub/trc-spatial-model/releases/tag/v17-instruments).

The public release passes 24 Lounge, 12 interface and 12 structure-control checks
in Greg's existing main Chrome. The pane's Astra controller inspected all seven
actual public WebGL captures and left the newly opened
[structure view](https://model.therecording.club/?floor=ground&mode=explore&view=structure)
available. Proof is under `workbench/v17-instruments-2026-09-09/evidence`, including
`public-v17-proof-v1.0.json` and the three `browser-public-*` reports. Native
desktop capture stalled again; that broader screen-control boundary remains
unverified. Walking code is unchanged and no new frame-rate claim is made.

Garment folds, workstation-chair upholstery and several instrument headstocks
remain refinement work. Window dimensions and the offset are estimates. The
missing lower stair is a separate active reconstruction; its local form has
photo support, while its dimensions and upper-floor registration are unresolved.

## Accuracy boundaries

The 19 modeled rooms combine plans and photographs. Equipment placement,
finishes, and several ceiling heights remain inferred. The second upstairs area
(124.51 square feet), stair registration, and indoor-to-outdoor registration are
unresolved. New photographs can improve appearance; these spatial relationships
need connected capture or site measurements before they can be certified.
