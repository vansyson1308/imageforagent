"""Render a Storyboard Studio glTF shot with Blender, headless.

The bridge from the vector engine to a real 3D renderer: the glTF file carries
the exact meshes, the camera framed like the SVG frame, a sun light, and the
shot's TRS animation (walk rig, tracks, FK figure).

    blender -b -P scripts/blender_render.py -- gltf/F02.gltf out/F02_ \
        --engine CYCLES --samples 32 --res 1920x1080 --fps 12

Outputs out/F02_0001.png ... (one PNG per animation frame). Assemble them the
same way as the vector clips (ffmpeg -framerate 12 -i out/F02_%04d.png ...).

Engines: CYCLES renders on CPU anywhere; EEVEE needs a GPU/EGL context on
headless Linux (fall back to CYCLES if it fails). WORKBENCH is the fastest
preview. Tested with Blender 4.x and 5.x.
"""

import argparse
import sys

import bpy  # type: ignore  # noqa: E402  (only available inside Blender)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("gltf")
    p.add_argument("out", help="output prefix, e.g. out/F02_")
    p.add_argument("--engine", default="CYCLES", choices=["CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"])
    p.add_argument("--samples", type=int, default=32)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--fps", type=int, default=12, help="frame rate of the shot (motion spec fps)")
    p.add_argument("--frames", default="", help="range like 1-12 (default: whole animation)")
    p.add_argument("--sky", default="0.05,0.06,0.10", help="world background RGB (linear)")
    p.add_argument("--still", action="store_true", help="render only the first frame")
    return p.parse_args(argv)


def main():
    args = parse_args()
    scene = bpy.context.scene

    # Clean start: drop the default cube/camera/light
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=args.gltf)

    cams = [o for o in scene.objects if o.type == "CAMERA"]
    if not cams:
        raise SystemExit("glTF has no camera node")
    scene.camera = cams[0]

    w, h = (int(x) for x in args.res.lower().split("x"))
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = args.out

    try:
        scene.render.engine = args.engine
    except TypeError:
        # EEVEE id differs across versions (BLENDER_EEVEE_NEXT in 4.2+, BLENDER_EEVEE in 5.x)
        scene.render.engine = "BLENDER_EEVEE" if args.engine.startswith("BLENDER_EEVEE") else "CYCLES"
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = args.samples
        scene.cycles.device = "CPU"
        scene.cycles.use_denoising = True

    # World: flat ambient so shadows are never pitch black (engine's rule too)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    r, g, b = (float(x) for x in args.sky.split(","))
    bg.inputs[0].default_value = (r, g, b, 1)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    # Animation range from the imported action (glTF times are seconds)
    end = 1
    for obj in scene.objects:
        ad = obj.animation_data
        if ad and ad.action:
            end = max(end, int(round(ad.action.frame_range[1])))
    scene.frame_start = 1
    scene.frame_end = end
    if args.frames:
        a, _, b2 = args.frames.partition("-")
        scene.frame_start = int(a)
        scene.frame_end = int(b2 or a)

    if args.still:
        scene.render.filepath = f"{args.out}0001.png"
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)
    print(f"rendered frames {scene.frame_start}-{scene.frame_end} -> {args.out}####.png")


main()
