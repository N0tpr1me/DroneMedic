"""
Zipline P2 Medical Delivery Drone + Delivery Droid — Blender Python Script
Accurate recreation from reference photos: bulbous fuselage, red wing booms,
4 VTOL pods with copper mesh vents, T-tail, rear pusher with gimbal,
plus delivery droid with ducted fan.

Usage:
    blender --background --python generate_drone.py
    # Or paste into Blender Scripting tab
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector


# ── Cleanup ──────────────────────────────────────────────────────────────────
def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in bpy.data.meshes:
        bpy.data.meshes.remove(mesh)
    for mat in bpy.data.materials:
        bpy.data.materials.remove(mat)


# ── Materials ────────────────────────────────────────────────────────────────
def make_mat(name, color, metallic=0.0, roughness=0.5, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 2.0
    return mat


def create_materials():
    return {
        "white_body": make_mat("White_Body", (0.92, 0.92, 0.92, 1.0), 0.05, 0.3),
        "red_boom": make_mat("Red_Boom", (0.85, 0.12, 0.1, 1.0), 0.1, 0.25),
        "dark_prop": make_mat("Dark_Prop", (0.1, 0.1, 0.1, 1.0), 0.2, 0.45),
        "sensor_glass": make_mat("Sensor_Glass", (0.05, 0.05, 0.08, 1.0), 0.0, 0.1),
        "copper_mesh": make_mat("Copper_Mesh", (0.75, 0.45, 0.15, 1.0), 0.5, 0.3),
        "dark_gray": make_mat("Dark_Gray", (0.15, 0.15, 0.15, 1.0), 0.0, 0.4),
        "motor_housing": make_mat("Motor_Housing", (0.6, 0.6, 0.6, 1.0), 0.5, 0.3),
        "red_spinner": make_mat("Red_Spinner", (0.85, 0.12, 0.1, 1.0), 0.2, 0.3),
    }


# ── Helpers ──────────────────────────────────────────────────────────────────
def assign_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def smooth(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if hasattr(obj.data, 'polygons'):
        for f in obj.data.polygons:
            f.use_smooth = True
    obj.select_set(False)


def add_subsurf(obj, levels=2):
    mod = obj.modifiers.new("Subsurf", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels


# ── A1: Fuselage ─────────────────────────────────────────────────────────────
def create_fuselage(mats):
    """Bulbous dolphin/egg fuselage — widest at front, tapered rear."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=32, ring_count=16,
        radius=1.0, location=(0, 0, 0)
    )
    fuse = bpy.context.active_object
    fuse.name = "Fuselage"
    # Base egg shape
    fuse.scale = (0.25, 0.85, 0.2)
    bpy.ops.object.transform_apply(scale=True)

    # Sculpt dolphin profile: bulge front, taper rear
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(fuse.data)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        y = v.co.y
        # Bulge the front (positive Y)
        if y > 0:
            factor = y / 0.85
            v.co.x *= 1.0 + 0.3 * factor  # wider front
            v.co.z *= 1.0 + 0.25 * factor  # taller front
        # Taper the rear (negative Y)
        if y < -0.2:
            factor = abs(y + 0.2) / 0.65
            v.co.x *= 1.0 - 0.35 * factor
            v.co.z *= 1.0 - 0.3 * factor
    bmesh.update_edit_mesh(fuse.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    add_subsurf(fuse, 2)
    assign_mat(fuse, mats["white_body"])
    smooth(fuse)

    # ── Sensor panel on top-front ──
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.45, 0.2))
    panel = bpy.context.active_object
    panel.name = "Sensor_Panel"
    panel.scale = (0.1, 0.15, 0.008)
    bpy.ops.object.transform_apply(scale=True)
    mod = panel.modifiers.new("Bevel", 'BEVEL')
    mod.width = 0.02
    mod.segments = 3
    bpy.context.view_layer.objects.active = panel
    bpy.ops.object.modifier_apply(modifier="Bevel")
    assign_mat(panel, mats["sensor_glass"])
    smooth(panel)
    panel.parent = fuse

    # ── V-antenna stalks ──
    for x_sign in [-1, 1]:
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.006, depth=0.12,
            location=(x_sign * 0.04, 0.15, 0.28)
        )
        stalk = bpy.context.active_object
        stalk.name = f"Antenna_{'L' if x_sign < 0 else 'R'}"
        stalk.rotation_euler.x = math.radians(-15)
        stalk.rotation_euler.y = x_sign * math.radians(30)
        assign_mat(stalk, mats["dark_gray"])
        stalk.parent = fuse

        # Paddle tip
        bpy.ops.mesh.primitive_cube_add(
            size=1,
            location=(x_sign * 0.065, 0.12, 0.34)
        )
        paddle = bpy.context.active_object
        paddle.name = f"AntennaPaddle_{'L' if x_sign < 0 else 'R'}"
        paddle.scale = (0.015, 0.008, 0.025)
        bpy.ops.object.transform_apply(scale=True)
        assign_mat(paddle, mats["dark_gray"])
        paddle.parent = fuse

    # ── Belly landing fins (3x) ──
    fin_angles = [-0.8, 0.0, 0.8]  # spread along Y
    for i, y_off in enumerate(fin_angles):
        bpy.ops.mesh.primitive_cone_add(
            vertices=3, radius1=0.05, depth=0.01,
            location=(0, y_off * 0.3, -0.18)
        )
        fin = bpy.context.active_object
        fin.name = f"BellyFin_{i}"
        fin.scale = (0.6, 1.0, 1.5)
        fin.rotation_euler.x = math.radians(180)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        assign_mat(fin, mats["dark_gray"])
        fin.parent = fuse

    # ── Side panel lines ──
    for x_sign in [-1, 1]:
        for y_off in [0.1, -0.1, -0.3]:
            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(x_sign * 0.24, y_off, 0.02)
            )
            line = bpy.context.active_object
            line.name = f"PanelLine_{x_sign}_{y_off}"
            line.scale = (0.003, 0.12, 0.02)
            bpy.ops.object.transform_apply(scale=True)
            assign_mat(line, mats["dark_gray"])
            line.parent = fuse

    return fuse


# ── A2: Wing Booms (RED) ────────────────────────────────────────────────────
def create_wing_booms(fuse, mats):
    """Two red tubular booms extending left/right with tip propellers."""
    boom_length = 1.4
    boom_positions = []

    for x_sign in [-1, 1]:
        x_center = x_sign * (boom_length / 2 + 0.15)

        # Main boom tube
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.04, depth=boom_length,
            location=(x_center, -0.05, 0.0)
        )
        boom = bpy.context.active_object
        boom.name = f"Boom_{'L' if x_sign < 0 else 'R'}"
        boom.rotation_euler.y = math.radians(90)
        bpy.ops.object.transform_apply(rotation=True)

        # Pinch where boom meets fuselage
        bpy.ops.object.mode_set(mode='EDIT')
        bm = bmesh.from_edit_mesh(boom.data)
        bm.verts.ensure_lookup_table()
        for v in bm.verts:
            dist_from_center = abs(v.co.x - x_center + x_sign * boom_length / 2)
            if dist_from_center < 0.15:
                pinch = 1.0 - 0.3 * (1.0 - dist_from_center / 0.15)
                v.co.y *= pinch
                v.co.z *= pinch
        bmesh.update_edit_mesh(boom.data)
        bpy.ops.object.mode_set(mode='OBJECT')

        assign_mat(boom, mats["red_boom"])
        smooth(boom)
        boom.parent = fuse

        # Boom tip position
        tip_x = x_sign * (boom_length / 2 + 0.15 + boom_length / 2)

        # Red nose cone at tip
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.045, location=(tip_x, -0.05, 0.0)
        )
        nose = bpy.context.active_object
        nose.name = f"BoomNose_{'L' if x_sign < 0 else 'R'}"
        nose.scale = (0.8, 0.8, 0.8)
        bpy.ops.object.transform_apply(scale=True)
        assign_mat(nose, mats["red_boom"])
        smooth(nose)
        nose.parent = fuse

        # Tip tractor propeller — 2 blade with red spinner
        bpy.ops.mesh.primitive_cone_add(
            radius1=0.02, depth=0.03,
            location=(tip_x + x_sign * 0.04, -0.05, 0.0)
        )
        spinner = bpy.context.active_object
        spinner.name = f"TipSpinner_{'L' if x_sign < 0 else 'R'}"
        spinner.rotation_euler.y = x_sign * math.radians(90)
        assign_mat(spinner, mats["red_spinner"])
        smooth(spinner)
        spinner.parent = fuse

        for b in range(2):
            angle = b * math.pi
            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(tip_x + x_sign * 0.05, -0.05, 0.0)
            )
            blade = bpy.context.active_object
            blade.name = f"TipBlade_{'L' if x_sign < 0 else 'R'}_{b}"
            blade.scale = (0.005, 0.003, 0.1)
            blade.rotation_euler.x = angle
            bpy.ops.object.transform_apply(scale=True, rotation=True)
            assign_mat(blade, mats["dark_prop"])
            blade.parent = fuse

        # Store pod mount positions (2 per boom)
        boom_positions.append((x_sign * 0.45, -0.05, 0.0))
        boom_positions.append((x_sign * 0.85, -0.05, 0.0))

    return boom_positions


# ── A3: VTOL Motor Pods (4x) ────────────────────────────────────────────────
def create_vtol_pods(fuse, mats, pod_positions):
    """White elongated pods below booms with copper vents and 4-blade props."""
    for i, (px, py, pz) in enumerate(pod_positions):
        pod_z = pz - 0.12  # hang below boom

        # Pylon connecting boom to pod
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.012, depth=0.1,
            location=(px, py, pz - 0.05)
        )
        pylon = bpy.context.active_object
        pylon.name = f"Pylon_{i}"
        assign_mat(pylon, mats["white_body"])
        pylon.parent = fuse

        # Pod body — elongated ellipsoid
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=16, ring_count=8,
            radius=0.06, location=(px, py, pod_z)
        )
        pod = bpy.context.active_object
        pod.name = f"VTOLPod_{i}"
        pod.scale = (0.7, 1.6, 0.6)
        bpy.ops.object.transform_apply(scale=True)
        add_subsurf(pod, 1)
        assign_mat(pod, mats["white_body"])
        smooth(pod)
        pod.parent = fuse

        # Copper mesh vent on top of pod
        bpy.ops.mesh.primitive_cube_add(
            size=1, location=(px, py, pod_z + 0.035)
        )
        vent = bpy.context.active_object
        vent.name = f"PodVent_{i}"
        vent.scale = (0.025, 0.055, 0.005)
        bpy.ops.object.transform_apply(scale=True)
        mod = vent.modifiers.new("Bevel", 'BEVEL')
        mod.width = 0.005
        mod.segments = 2
        bpy.context.view_layer.objects.active = vent
        bpy.ops.object.modifier_apply(modifier="Bevel")
        assign_mat(vent, mats["copper_mesh"])
        vent.parent = fuse

        # Bolt details (2 per pod)
        for bx in [-0.015, 0.015]:
            bpy.ops.mesh.primitive_cylinder_add(
                radius=0.005, depth=0.004,
                location=(px + bx, py + 0.04, pod_z + 0.02)
            )
            bolt = bpy.context.active_object
            bolt.name = f"Bolt_{i}_{bx}"
            assign_mat(bolt, mats["dark_gray"])
            bolt.parent = fuse

        # Prop shaft
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.008, depth=0.05,
            location=(px, py, pod_z - 0.055)
        )
        shaft = bpy.context.active_object
        shaft.name = f"PropShaft_{i}"
        assign_mat(shaft, mats["motor_housing"])
        shaft.parent = fuse

        # 4-blade propeller below pod
        for b in range(4):
            angle = b * (math.pi / 2) + (i * 0.3)
            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(px, py, pod_z - 0.08)
            )
            blade = bpy.context.active_object
            blade.name = f"VTOLBlade_{i}_{b}"
            blade.scale = (0.12, 0.02, 0.004)
            blade.rotation_euler.z = angle
            bpy.ops.object.transform_apply(scale=True, rotation=True)

            # Slight twist
            mod = blade.modifiers.new("Twist", 'SIMPLE_DEFORM')
            mod.deform_method = 'TWIST'
            mod.angle = math.radians(10)
            bpy.context.view_layer.objects.active = blade
            bpy.ops.object.modifier_apply(modifier="Twist")

            assign_mat(blade, mats["dark_prop"])
            blade.parent = fuse


# ── A4: Tail Assembly ────────────────────────────────────────────────────────
def create_tail(fuse, mats):
    """T-tail: single boom rearward + horizontal stabilizer + angled fin plates."""
    # Tail boom
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.025, depth=0.6,
        location=(0, -0.65, 0.18)
    )
    boom = bpy.context.active_object
    boom.name = "TailBoom"
    boom.rotation_euler.x = math.radians(75)  # angled upward
    bpy.ops.object.transform_apply(rotation=True)
    assign_mat(boom, mats["white_body"])
    smooth(boom)
    boom.parent = fuse

    # Horizontal stabilizer
    stab_y = -0.9
    stab_z = 0.35
    bpy.ops.mesh.primitive_cube_add(
        size=1, location=(0, stab_y, stab_z)
    )
    stab = bpy.context.active_object
    stab.name = "H_Stabilizer"
    stab.scale = (0.35, 0.1, 0.012)
    bpy.ops.object.transform_apply(scale=True)
    mod = stab.modifiers.new("Bevel", 'BEVEL')
    mod.width = 0.008
    mod.segments = 2
    bpy.context.view_layer.objects.active = stab
    bpy.ops.object.modifier_apply(modifier="Bevel")
    assign_mat(stab, mats["white_body"])
    smooth(stab)
    stab.parent = fuse

    # Two angled vertical fin plates at stabilizer tips
    for x_sign in [-1, 1]:
        bpy.ops.mesh.primitive_cube_add(
            size=1, location=(x_sign * 0.33, stab_y - 0.02, stab_z + 0.06)
        )
        fin = bpy.context.active_object
        fin.name = f"TailFin_{'L' if x_sign < 0 else 'R'}"
        fin.scale = (0.012, 0.06, 0.07)
        fin.rotation_euler.y = x_sign * math.radians(15)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        assign_mat(fin, mats["white_body"])
        smooth(fin)
        fin.parent = fuse


# ── A5: Rear Pusher Propeller ────────────────────────────────────────────────
def create_pusher_prop(fuse, mats):
    """Rear pusher with ball gimbal joint + ribbed motor housing + 2-blade prop."""
    pusher_y = -0.82
    pusher_z = -0.08

    # Ball/gimbal joint
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=0.03, location=(0, pusher_y, pusher_z)
    )
    ball = bpy.context.active_object
    ball.name = "PusherGimbal"
    assign_mat(ball, mats["motor_housing"])
    smooth(ball)
    ball.parent = fuse

    # Ribbed motor housing
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.025, depth=0.06,
        location=(0, pusher_y, pusher_z - 0.05)
    )
    motor = bpy.context.active_object
    motor.name = "PusherMotor"
    assign_mat(motor, mats["motor_housing"])
    smooth(motor)
    motor.parent = fuse

    # Add ribs to motor housing
    for rz in range(5):
        z_off = pusher_z - 0.03 - rz * 0.01
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.027, minor_radius=0.003,
            location=(0, pusher_y, z_off)
        )
        rib = bpy.context.active_object
        rib.name = f"MotorRib_{rz}"
        assign_mat(rib, mats["dark_gray"])
        rib.parent = fuse

    # 2-blade propeller
    for b in range(2):
        angle = b * math.pi
        bpy.ops.mesh.primitive_cube_add(
            size=1, location=(0, pusher_y, pusher_z - 0.09)
        )
        blade = bpy.context.active_object
        blade.name = f"PusherBlade_{b}"
        blade.scale = (0.12, 0.004, 0.018)
        blade.rotation_euler.z = angle
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        assign_mat(blade, mats["dark_prop"])
        blade.parent = fuse


# ── B: Delivery Droid ────────────────────────────────────────────────────────
def create_delivery_droid(mats):
    """Delivery Droid: rounded box, front sensor, rear ducted fan, landing legs."""
    droid_loc = (0, -0.2, -0.55)  # below and behind fuselage

    # ── B1: Body — rounded rectangular box ──
    bpy.ops.mesh.primitive_cube_add(size=1, location=droid_loc)
    body = bpy.context.active_object
    body.name = "Droid_Body"
    body.scale = (0.12, 0.18, 0.1)
    bpy.ops.object.transform_apply(scale=True)
    mod = body.modifiers.new("Bevel", 'BEVEL')
    mod.width = 0.03
    mod.segments = 4
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier="Bevel")
    add_subsurf(body, 1)
    assign_mat(body, mats["white_body"])
    smooth(body)

    dx, dy, dz = droid_loc

    # Upper vent slot
    bpy.ops.mesh.primitive_cube_add(
        size=1, location=(dx, dy, dz + 0.08)
    )
    vent = bpy.context.active_object
    vent.name = "Droid_Vent"
    vent.scale = (0.08, 0.1, 0.004)
    bpy.ops.object.transform_apply(scale=True)
    assign_mat(vent, mats["dark_gray"])
    vent.parent = body

    # ── B2: Front sensor window ──
    bpy.ops.mesh.primitive_cube_add(
        size=1, location=(dx, dy + 0.17, dz + 0.01)
    )
    sensor = bpy.context.active_object
    sensor.name = "Droid_Sensor"
    sensor.scale = (0.08, 0.008, 0.06)
    bpy.ops.object.transform_apply(scale=True)
    mod = sensor.modifiers.new("Bevel", 'BEVEL')
    mod.width = 0.015
    mod.segments = 3
    bpy.context.view_layer.objects.active = sensor
    bpy.ops.object.modifier_apply(modifier="Bevel")
    assign_mat(sensor, mats["sensor_glass"])
    smooth(sensor)
    sensor.parent = body

    # ── B3: Rear ducted fan ──
    # White fairing ring
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.065, minor_radius=0.012,
        location=(dx, dy - 0.17, dz)
    )
    ring = bpy.context.active_object
    ring.name = "Droid_DuctRing"
    ring.rotation_euler.x = math.radians(90)
    assign_mat(ring, mats["white_body"])
    smooth(ring)
    ring.parent = body

    # Honeycomb mesh guard (dome)
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=12, ring_count=6,
        radius=0.055, location=(dx, dy - 0.19, dz)
    )
    guard = bpy.context.active_object
    guard.name = "Droid_MeshGuard"
    guard.scale = (1.0, 0.4, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    assign_mat(guard, mats["copper_mesh"])
    smooth(guard)
    guard.parent = body

    # 5-blade propeller inside duct
    for b in range(5):
        angle = b * (2 * math.pi / 5)
        bpy.ops.mesh.primitive_cube_add(
            size=1, location=(dx, dy - 0.16, dz)
        )
        blade = bpy.context.active_object
        blade.name = f"DroidProp_{b}"
        blade.scale = (0.04, 0.003, 0.008)
        blade.rotation_euler.y = angle
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        assign_mat(blade, mats["dark_prop"])
        blade.parent = body

    # ── B4: Top antenna nub ──
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.008, depth=0.02,
        location=(dx, dy, dz + 0.1)
    )
    nub = bpy.context.active_object
    nub.name = "Droid_AntennaNub"
    assign_mat(nub, mats["dark_gray"])
    nub.parent = body

    # ── B4: Landing legs (4x) ──
    leg_offsets = [
        (0.07, 0.07),
        (-0.07, 0.07),
        (0.07, -0.07),
        (-0.07, -0.07),
    ]
    for li, (lx, ly) in enumerate(leg_offsets):
        bpy.ops.mesh.primitive_cone_add(
            vertices=3, radius1=0.025, depth=0.04,
            location=(dx + lx, dy + ly, dz - 0.1)
        )
        leg = bpy.context.active_object
        leg.name = f"Droid_Leg_{li}"
        # Splay outward
        leg.rotation_euler.x = math.radians(10) * (1 if ly > 0 else -1)
        leg.rotation_euler.y = math.radians(10) * (1 if lx > 0 else -1)
        assign_mat(leg, mats["dark_gray"])
        leg.parent = body

    # ── Tether connecting to aircraft ──
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.004, depth=0.35,
        location=(dx, dy + 0.1, dz + 0.25)
    )
    tether = bpy.context.active_object
    tether.name = "Tether"
    assign_mat(tether, mats["dark_gray"])
    tether.parent = body

    return body


# ── Scene Setup ──────────────────────────────────────────────────────────────
def setup_scene():
    """Ground plane, camera, and lighting for hero render."""
    # Ground plane
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.7))
    ground = bpy.context.active_object
    ground.name = "Ground"
    mat = make_mat("Ground", (0.85, 0.85, 0.85, 1.0), 0.0, 0.8)
    assign_mat(ground, mat)

    # Key light (sun)
    bpy.ops.object.light_add(type='SUN', location=(3, 2, 5))
    sun = bpy.context.active_object
    sun.name = "Sun_Key"
    sun.data.energy = 3.0

    # Fill light
    bpy.ops.object.light_add(type='AREA', location=(-2, -1, 3))
    fill = bpy.context.active_object
    fill.name = "Fill_Light"
    fill.data.energy = 50.0
    fill.data.size = 3.0

    # Camera — 3/4 hero angle to show both aircraft and droid
    bpy.ops.object.camera_add(location=(2.8, -2.8, 1.2))
    cam = bpy.context.active_object
    cam.name = "Camera"
    cam.rotation_euler = (math.radians(72), 0, math.radians(45))
    bpy.context.scene.camera = cam


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    clear_scene()
    mats = create_materials()

    # Part A: P2 Zip Aircraft
    fuse = create_fuselage(mats)
    pod_positions = create_wing_booms(fuse, mats)
    create_vtol_pods(fuse, mats, pod_positions)
    create_tail(fuse, mats)
    create_pusher_prop(fuse, mats)

    # Part B: Delivery Droid
    create_delivery_droid(mats)

    # Scene
    setup_scene()

    # Select all for export
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = fuse

    # Export
    out_dir = os.path.dirname(os.path.abspath(__file__))

    glb_path = os.path.join(out_dir, "drone_medic.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
    )
    print(f"Exported GLB  → {glb_path}")

    blend_path = os.path.join(out_dir, "drone_medic.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved .blend  → {blend_path}")

    print("Done! Zipline P2 + Delivery Droid generated.")


if __name__ == "__main__":
    main()
