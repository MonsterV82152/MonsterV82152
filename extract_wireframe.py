#!/usr/bin/env python3
"""
extract_wireframe.py — robot.obj  ->  compact wireframe (.bin) for Three.js
=========================================================================
A customizable, dependency-free (numpy only) pre-processor that turns a
heavy CAD mesh into a lightweight, STRUCTURAL wireframe suitable for the web.

WHAT IT DOES
  1. Parses vertices + triangular faces from a Wavefront OBJ (streaming).
  2. (optional) VOXEL DECIMATION  (--voxel): collapses all vertices that fall
     inside the same voxel cell into one. This ERASES features smaller than
     the cell (threads, grooves, fillets, small holes) while keeping large
     structure (panels, frame, silhouette) — the recommended way to get a
     clean "structural only" look. Off when 0.
  3. Computes per-face normals (vectorized) and extracts HARD edges
     (dihedral angle > --angle) + BOUNDARY/open edges.
  4. (optional) MIN-LENGTH filter (--min-len): drops any remaining edge
     shorter than the threshold (world units). A per-edge floor; pair with
     --voxel for extra cleanup. Off when 0.
  5. Keeps ALL surviving boundary edges + the SHARPEST surviving creases,
     up to the --cap budget.
  6. Re-orients (--up / --front), centers, uniformly scales, writes f32.

WHY --voxel BEATS --min-len FOR "REMOVE GROOVES/THREADS"
  CAD meshes are tessellated so finely that a long panel line and a tiny
  groove are BOTH made of ~same-length micro-edges, so a per-edge length
  filter can't tell them apart and just punches gaps in the panel lines.
  Decimating by voxel size first removes whole sub-scale FEATURES, then the
  hard-edge pass returns only the big structural lines — complete, no gaps.

OUTPUT
  Little-endian float32, layout [x0,y0,z0, x1,y1,z1] per segment. Three.js
  loads it into a BufferGeometry position attribute (itemSize 3) and renders
  with THREE.LineSegments (every 2 vertices = 1 segment).

USAGE EXAMPLES
  python3 extract_wireframe.py                      # voxel=0.03 (clean default)
  python3 extract_wireframe.py --voxel 0.04         # sparser / cleaner
  python3 extract_wireframe.py --voxel 0.02         # more detail retained
  python3 extract_wireframe.py --voxel 0            # raw (no decimation)
  python3 extract_wireframe.py --voxel 0.03 --min-len 0.01 --angle 30
  python3 extract_wireframe.py --up y --front z     # different orientation

Re-running is ~3-5s. If the render looks sideways, try the other --up.
"""
import argparse, os, re, time
import numpy as np

AX = {'x': 0, 'y': 1, 'z': 2}


def parse_obj(path, limit=0):
    """Stream-parse an OBJ, returning (verts[N,3] f64, faces[M,3] int64)."""
    vlines, flines = [], []
    n = 0
    with open(path) as fh:
        for line in fh:
            c0 = line[0]
            if c0 == 'v' and line[1] == ' ':       # vertex
                vlines.append(line[2:])
            elif c0 == 'f' and line[1] == ' ':     # face
                flines.append(line[2:])
            n += 1
            if limit and n >= limit:
                break
    verts = np.fromstring(''.join(vlines), sep=' ', dtype=np.float64).reshape(-1, 3)
    ftext = re.sub(r'/\d*', '', ''.join(flines))    # strip '/t' and '//n'
    faces = np.fromstring(ftext, sep=' ', dtype=np.int64).reshape(-1, 3) - 1
    faces = np.clip(faces, 0, verts.shape[0] - 1)
    return verts, faces


def decimate(verts, faces, cell):
    """Vertex-clustering decimation: merge all verts within one cubic `cell`
    (model-space units) into their centroid, then drop faces that collapse.
    Erases sub-cell features (grooves/threads) while preserving large form."""
    mn = verts.min(0)
    ix = np.floor((verts - mn) / cell).astype(np.int64)
    dim = ix.max(0) + 1
    key = ix[:, 0] * (dim[1] * dim[2]) + ix[:, 1] * dim[2] + ix[:, 2]
    _, inv = np.unique(key, return_inverse=True)
    K = inv.max() + 1
    counts = np.bincount(inv, minlength=K)
    nv = np.stack(
        [np.bincount(inv, weights=verts[:, a], minlength=K) for a in range(3)],
        axis=1,
    ) / counts[:, None]
    nf = inv[faces]
    keep = (nf[:, 0] != nf[:, 1]) & (nf[:, 1] != nf[:, 2]) & (nf[:, 0] != nf[:, 2])
    return nv, nf[keep]


def extract(verts, faces, angle_deg):
    """Return (boundary_keys, crease_keys, crease_angles, NV) for hard+open edges."""
    NV = verts.shape[0]
    fa, fb, fc = faces[:, 0], faces[:, 1], faces[:, 2]
    nrm = np.cross(verts[fb] - verts[fa], verts[fc] - verts[fa])
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-18)

    a = np.minimum(fa, fb); b = np.maximum(fa, fb)
    c = np.minimum(fb, fc); d = np.maximum(fb, fc)
    e = np.minimum(fc, fa); g = np.maximum(fc, fa)
    ar = np.arange(faces.shape[0], dtype=np.int64)
    keys = np.concatenate([a * NV + b, c * NV + d, e * NV + g])
    fids = np.concatenate([ar, ar, ar])
    order = np.argsort(keys, kind='stable')
    ks, fs = keys[order], fids[order]

    uk, ustart, ucount = np.unique(ks, return_index=True, return_counts=True)
    bnd_keys = uk[ucount == 1]                                  # open silhouette edges

    m = ucount == 2
    i0 = ustart[m]
    dot = np.clip(np.einsum('ij,ij->i', nrm[fs[i0]], nrm[fs[i0 + 1]]), -1, 1)
    ang = np.degrees(np.arccos(dot))
    pair_keys = uk[m]
    crease_mask = ang > angle_deg
    return bnd_keys, pair_keys[crease_mask], ang[crease_mask], NV


def lengths_world(keys, NV, verts, scale):
    """World-space length of each edge in `keys` (encoded a*NV+b)."""
    A = keys // NV
    B = keys % NV
    return np.linalg.norm(verts[A] - verts[B], axis=1) * scale


def remap_axes(verts, up, front):
    """Reorder columns so model `up`->Y, `front`->Z, remaining->X."""
    ui, fi = AX[up], AX[front]
    ri = next(i for i in (0, 1, 2) if i not in (ui, fi))
    return verts[:, [ri, ui, fi]]


def main():
    ap = argparse.ArgumentParser(
        description="OBJ -> lightweight structural wireframe .bin",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument('--obj', default='robot.obj', help='input OBJ path')
    ap.add_argument('--out', default='site/assets/robot-edges.bin', help='output .bin')
    ap.add_argument('--cap', type=int, default=250000, help='max segments (density ceiling)')
    ap.add_argument('--angle', type=float, default=28.0, help='crease threshold (deg); lower=more edges')
    ap.add_argument('--voxel', type=float, default=0.03,
                    help='decimation cell size in WORLD units (erases sub-scale grooves/threads); 0=off')
    ap.add_argument('--min-len', type=float, default=0.0,
                    help='drop edges shorter than this (world units); 0=off')
    ap.add_argument('--extent', type=float, default=6.5, help='target max extent (world units)')
    ap.add_argument('--up', choices=['x', 'y', 'z'], default='z', help='model axis that becomes vertical')
    ap.add_argument('--front', choices=['x', 'y', 'z'], default='y', help='model axis that faces camera (+Z)')
    ap.add_argument('--seed', type=int, default=42, help='RNG seed for final subsampling')
    ap.add_argument('--limit', type=int, default=0, help='debug: stop after N OBJ lines (0=all)')
    args = ap.parse_args()
    if args.up == args.front:
        ap.error('--up and --front must differ')

    t0 = time.time()
    def log(m): print(f"[{time.time()-t0:6.2f}s] {m}", flush=True)

    log(f"parsing {args.obj} ...")
    verts, faces = parse_obj(args.obj, limit=args.limit)
    log(f"verts={verts.shape[0]}  faces={faces.shape[0]}")

    # world<->model scale (uniform, from bbox max extent)
    maxext_model = (verts.max(0) - verts.min(0)).max()
    scale = args.extent / maxext_model

    # --- optional voxel decimation (the structural cleanup) ---
    if args.voxel > 0:
        cell_model = args.voxel / scale
        verts, faces = decimate(verts, faces, cell_model)
        log(f"decimated to voxel={args.voxel} -> verts={verts.shape[0]}  faces={faces.shape[0]}")

    bnd_keys, crease_keys, crease_ang, NV = extract(verts, faces, args.angle)
    log(f"boundary={bnd_keys.size}  creases(>{args.angle}deg)={crease_keys.size}")

    # --- optional per-edge min-length floor ---
    if args.min_len > 0:
        if bnd_keys.size:
            bnd_keys = bnd_keys[lengths_world(bnd_keys, NV, verts, scale) >= args.min_len]
        if crease_keys.size:
            keep = lengths_world(crease_keys, NV, verts, scale) >= args.min_len
            crease_keys, crease_ang = crease_keys[keep], crease_ang[keep]
        log(f"after min-len>={args.min_len}: boundary={bnd_keys.size}  creases={crease_keys.size}")

    # selection: ALL boundaries first, then SHARPEST creases up to budget
    budget = max(0, args.cap - bnd_keys.size)
    if crease_keys.size > budget:
        sel = np.argpartition(-crease_ang, budget - 1)[:budget]
        crease_keys = crease_keys[sel]
    keep = np.concatenate([bnd_keys, crease_keys])
    A = (keep // NV).astype(np.int64)
    B = (keep % NV).astype(np.int64)
    if A.shape[0] > args.cap:                       # safety cap (boundaries exceeded budget)
        sel = np.random.default_rng(args.seed).choice(A.shape[0], args.cap, replace=False)
        sel.sort(); A, B = A[sel], B[sel]
    log(f"selected segments={A.shape[0]} (cap={args.cap})")

    # center + uniform scale (model space), then re-orient to world axes
    verts = (verts - (verts.min(0) + verts.max(0)) / 2.0) * scale
    verts = remap_axes(verts, args.up, args.front)

    segs = np.empty((A.shape[0], 6), dtype=np.float32)
    segs[:, 0:3] = verts[A]
    segs[:, 3:6] = verts[B]

    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    segs.tofile(args.out)
    sz = os.path.getsize(args.out)
    wext = segs.reshape(-1, 3).max(0) - segs.reshape(-1, 3).min(0)
    log(f"WROTE {args.out}  segments={A.shape[0]}  size={sz/1e6:.2f}MB")
    log(f"world extents  X(width)={wext[0]:.2f}  Y(height)={wext[1]:.2f}  Z(depth)={wext[2]:.2f}  (up='{args.up}', front='{args.front}')")
    log("DONE")


if __name__ == '__main__':
    main()
