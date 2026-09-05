# TRC Spatial Model — public viewer

Static export of the Recording Club spatial studio viewer (`image-blaster/trc-model/viewer`), rendered model `v10-webp` by Astra.
Live: https://model.therecording.club

- `site/` — static viewer bundle deployed to Vercel (Hobby, 100 MB cap).
- The 171 MB model (`trc-web-v10-webp.glb`) is served from this repo's GitHub Release `v10-webp`; Vercel redirects `/reconstruction/trc-web-v10-webp.glb` there.
- Layout saving is disabled in the public copy (read-only); "Export equipment layout" still works.
