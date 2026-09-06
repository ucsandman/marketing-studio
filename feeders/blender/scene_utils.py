"""Small Blender 5.1-safe building blocks shared by feeder scenes."""

from pathlib import Path

import bpy


def srgb_channel_to_linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def hex_rgba(value: str, alpha: float = 1.0):
    value = value.lstrip("#")
    rgb = [srgb_channel_to_linear(int(value[i : i + 2], 16) / 255) for i in (0, 2, 4)]
    return (*rgb, alpha)


def clear_scene() -> None:
    """Factory objects live in a child collection, so clear the datablock."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def configure_render(
    scene, out_dir: Path, width: int, height: int, fps: int, frame_count: int
) -> None:
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frame_count
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(out_dir / "frame_")


def principled_material(name: str, color, roughness: float, metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def image_material(name: str, path: Path, roughness: float = 0.32):
    del roughness
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(path), check_existing=False)
    tex.interpolation = "Closest"
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 0.9
    output = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(tex.outputs["Color"], emission.inputs["Color"])
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat, tex.image


def beveled_box(name: str, location, dimensions, material, bevel: float):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("edge_softness", type="BEVEL")
    modifier.width = bevel
    modifier.segments = 5
    obj.data.materials.append(material)
    return obj


def area_light(name: str, location, energy: float, size: float, color, target):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    point_at(obj, target)
    return obj


def point_at(obj, target) -> None:
    direction = mathutils_vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def mathutils_vector(values):
    from mathutils import Vector

    return Vector(values)
