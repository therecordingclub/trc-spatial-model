# The Recording Club spatial model

[Open the model](https://model.therecording.club/) ·
[Photographic lobby](https://model.therecording.club/photo/) ·
[Source archive](https://model.therecording.club/sources/source-index.json)

The viewer runs directly on the existing `trc-beta-apps` shared host. It adds no
machine, child process, or recurring server charge. The prior Vercel deployment
remains intact for rollback.

- `site/` contains the read-only viewer and its stable model manifest.
- `docs/model/` holds versioned browser buffers and textures on existing GitHub Pages.
- Versioned GitHub Releases retain the downloadable GLB and editable Blender files.
- `tools/` verifies release files and captures rooms in an already-open main Chrome tab.

The model combines architectural plans and photographs across 19 rooms. Some
dimensions, fixtures, and spatial connections remain inferred; the viewer and
source archive identify those limits. Layout edits can be exported locally.

See [deployment and rollback instructions](DEPLOYMENT.md) before publishing.
