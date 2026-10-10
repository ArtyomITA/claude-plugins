# office-pack.json

The furniture models in `office-pack.json` come from the **3D Voxel Office Pack** by **MariaIsMe**
(https://mariaisme.itch.io/3d-voxel-office), licensed under Creative Commons Attribution 4.0 International
(CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), as stated in the pack's README.

Changes made: each `.vox` file was converted with `scripts/tools/vox_bundle.py` into a compact JSON entry (the first
model only, its voxels and the colours it uses; materials, transforms and cameras dropped). The viewer turns the
models to face +z, scales them to metres and can recolour them into variants at runtime.

The author asks that the asset pack itself is not resold.
