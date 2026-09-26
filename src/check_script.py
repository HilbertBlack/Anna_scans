import os
import sys
import json
import struct
import subprocess
import shutil
import trimesh


SUPPORTED = {
    ".obj",
    ".stl",
    ".glb",
    ".gltf",
    ".fbx",
    ".ply",
    ".off",
    ".dae",
    ".3ds",
}


def check_fbx(file_path):
    """
    Basic FBX validation.

    FBX files can be binary or ASCII.
    trimesh does not directly support FBX, so we inspect
    the file and optionally use Blender if available.
    """

    try:
        with open(file_path, "rb") as f:
            header = f.read(64)

        # Binary FBX signature
        if header.startswith(b"Kaydara FBX Binary"):
            print("  FBX type       : Binary FBX")
            print("  FBX header     : Valid")

            # Try Blender if installed
            blender = shutil.which("blender")

            if blender:
                print("  Blender        : Found")
                print("  Import test    : Running...")

                result = subprocess.run(
                    [
                        blender,
                        "--background",
                        "--python-expr",
                        f"""
import bpy
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)

try:
    bpy.ops.import_scene.fbx(filepath=r'{os.path.abspath(file_path)}')
    print("FBX_IMPORT_SUCCESS")
except Exception as e:
    print("FBX_IMPORT_ERROR:", str(e))
""",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=120
                )

                output = result.stdout + result.stderr

                if "FBX_IMPORT_SUCCESS" in output:
                    return True, "FBX file is valid and Blender successfully imported it."

                # Extract Blender's error
                errors = [
                    line for line in output.splitlines()
                    if "FBX_IMPORT_ERROR" in line
                ]

                if errors:
                    return False, errors[-1]

                return False, "Blender could not import the FBX file."

            else:
                return True, (
                    "FBX binary header is valid, but full geometry validation "
                    "requires Blender. Blender was not found."
                )

        # ASCII FBX
        text = header.decode("utf-8", errors="ignore")

        if "FBXHeaderExtension" in text:
            return True, (
                "ASCII FBX header detected. "
                "Full geometry validation requires Blender."
            )

        return False, (
            "File has .fbx extension but does not contain a valid "
            "Binary or recognizable ASCII FBX header."
        )

    except Exception as e:
        return False, f"Could not read FBX file: {e}"


def check_mesh(file_path):
    """Validate formats supported by trimesh."""

    try:
        model = trimesh.load(file_path)

    except ValueError as e:
        return False, f"Unsupported by trimesh: {e}"

    except Exception as e:
        return False, f"Parser error: {type(e).__name__}: {e}"

    # Scene
    if isinstance(model, trimesh.Scene):

        if len(model.geometry) == 0:
            return False, "Scene loaded successfully, but contains no geometry."

        meshes = list(model.geometry.values())

    # Single mesh
    elif isinstance(model, trimesh.Trimesh):

        meshes = [model]

    else:

        return False, (
            f"File loaded, but returned unsupported object type: "
            f"{type(model).__name__}"
        )

    total_vertices = 0
    total_faces = 0

    for index, mesh in enumerate(meshes):

        vertices = len(mesh.vertices)
        faces = len(mesh.faces)

        print(f"  Mesh {index + 1}")
        print(f"    Vertices : {vertices}")
        print(f"    Faces    : {faces}")

        if vertices == 0:
            return False, f"Mesh {index + 1} contains no vertices."

        if faces == 0:
            return False, f"Mesh {index + 1} contains no faces."

        total_vertices += vertices
        total_faces += faces

    print()
    print(f"  Total vertices : {total_vertices}")
    print(f"  Total faces    : {total_faces}")

    # Check for NaN / infinite vertices
    for index, mesh in enumerate(meshes):

        if not mesh.is_empty:

            if not mesh.vertices.flags.writeable:
                vertices = mesh.vertices.copy()
            else:
                vertices = mesh.vertices

            if not all(map(lambda x: x == x, vertices.flatten())):
                return False, f"Mesh {index + 1} contains NaN vertex coordinates."

    return True, "3D model loaded successfully and contains valid geometry."


def check_3d_model(file_path):

    print("=" * 60)
    print("3D MODEL VALIDATOR")
    print("=" * 60)

    # File existence
    if not os.path.exists(file_path):
        return False, "File does not exist."

    if not os.path.isfile(file_path):
        return False, "Path is not a file."

    # File size
    size = os.path.getsize(file_path)

    print(f"File       : {file_path}")
    print(f"File size  : {size / 1024 / 1024:.2f} MB")

    if size == 0:
        return False, "File is empty (0 bytes)."

    # Extension
    extension = os.path.splitext(file_path)[1].lower()

    print(f"Extension  : {extension}")

    if extension not in SUPPORTED:
        return False, f"Unsupported 3D file format: {extension}"

    print(f"Format     : {extension.upper()}")
    print()

    # FBX needs special handling
    if extension == ".fbx":

        return check_fbx(file_path)

    # Other formats
    return check_mesh(file_path)


def main():

    if len(sys.argv) != 2:

        print("Usage:")
        print("python check_script.py <3d_model>")
        print()
        print("Example:")
        print("python check_script.py model.glb")

        sys.exit(1)

    file_path = sys.argv[1]

    valid, message = check_3d_model(file_path)

    print()
    print("=" * 60)

    if valid:
        print("✓ VALID MODEL")
        print("=" * 60)
        print(message)
        sys.exit(0)

    else:
        print("✗ INVALID MODEL")
        print("=" * 60)
        print("ERROR:")
        print(message)
        sys.exit(1)


if __name__ == "__main__":
    main()