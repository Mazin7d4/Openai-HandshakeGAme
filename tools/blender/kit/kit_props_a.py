import math

def build(box, cyl, tube, commit):
    # 1. DeskL (L-shaped 1.6+1.2 m oak desk)
    box('DeskL_Top1', (-0.3, -0.3, 0.735), (1.0, 0.6, 0.03), 'oak', bevel=0.005)
    box('DeskL_Top2', (0.5, 0.0, 0.735), (0.6, 1.2, 0.03), 'oak', bevel=0.005)
    box('DeskL_Frame1', (-0.3, -0.3, 0.70), (0.92, 0.52, 0.04), 'alu', bevel=0.003, seg=1)
    box('DeskL_Frame2', (0.5, 0.0, 0.70), (0.52, 1.12, 0.04), 'alu', bevel=0.003, seg=1)
    for lx, ly in [(-0.76, -0.04), (-0.76, -0.56), (0.76, -0.56), (0.76, 0.56), (0.24, -0.04), (0.24, 0.56)]:
        box('DeskL_Leg', (lx, ly, 0.355), (0.04, 0.04, 0.69), 'alu', bevel=0.003, seg=1)
    commit('DeskL', 'prop', custom_footprint=(1.6, 1.2))

    # 2. OfficeChair (5-star alu base, casters, fabric seat+back, gas lift)
    cyl('Chair_Hub', (0.0, 0.0, 0.07), 0.05, 0.05, 'alu', v=10)
    for i in range(5):
        ang = i * (2.0 * math.pi / 5.0)
        cx, cy = math.cos(ang) * 0.26, math.sin(ang) * 0.26
        cyl(f'Chair_Spoke_{i}', (cx * 0.5, cy * 0.5, 0.055), 0.012, 0.26, 'alu', v=8, rot=(0.0, math.pi / 2.0, ang))
        cyl(f'Chair_Caster_{i}', (cx, cy, 0.025), 0.022, 0.03, 'rubber', v=8)
    cyl('Chair_LiftOuter', (0.0, 0.0, 0.18), 0.028, 0.16, 'aluDark', v=10)
    cyl('Chair_LiftInner', (0.0, 0.0, 0.32), 0.018, 0.14, 'alu', v=10)
    box('Chair_UnderPlate', (0.0, 0.0, 0.40), (0.18, 0.18, 0.04), 'aluDark', bevel=0.005, seg=1)
    box('Chair_Seat', (0.0, -0.02, 0.46), (0.48, 0.48, 0.08), 'fabric', bevel=0.02, seg=2)
    box('Chair_SpineH', (0.0, 0.16, 0.42), (0.06, 0.20, 0.03), 'alu', bevel=0.004, seg=1)
    box('Chair_SpineV', (0.0, 0.23, 0.64), (0.05, 0.04, 0.42), 'alu', bevel=0.004, seg=1)
    box('Chair_Back', (0.0, 0.22, 0.74), (0.44, 0.06, 0.42), 'fabric', bevel=0.02, seg=2)
    commit('OfficeChair', 'prop', custom_footprint=(0.65, 0.65))

    # 3. Monitor (24in graphite bezel + screenDark face, alu stand)
    box('Mon_StandBase', (0.0, 0.0, 0.005), (0.22, 0.18, 0.01), 'alu', bevel=0.002, seg=1)
    box('Mon_StandPost', (0.0, 0.04, 0.16), (0.04, 0.03, 0.30), 'alu', bevel=0.003, seg=1)
    box('Mon_Hinge', (0.0, 0.02, 0.28), (0.06, 0.04, 0.05), 'aluDark', bevel=0.002, seg=1)
    box('Mon_Bezel', (0.0, 0.0, 0.28), (0.54, 0.025, 0.34), 'graphite', bevel=0.004, seg=1)
    box('Mon_Screen', (0.0, -0.013, 0.28), (0.51, 0.002, 0.31), 'screenDark', bevel=0.001, seg=1)
    commit('Monitor', 'prop', custom_footprint=(0.54, 0.20))

    # 4. Keyboard (0.44x0.13, key rows as 3-4 strips)
    box('KB_Base', (0.0, 0.0, 0.006), (0.44, 0.13, 0.012), 'graphite', bevel=0.003, seg=1)
    box('KB_Row1', (0.0, -0.040, 0.014), (0.41, 0.020, 0.006), 'rubber', bevel=0.001, seg=1)
    box('KB_Row2', (0.0, -0.014, 0.015), (0.41, 0.018, 0.006), 'rubber', bevel=0.001, seg=1)
    box('KB_Row3', (0.0,  0.012, 0.016), (0.41, 0.018, 0.006), 'rubber', bevel=0.001, seg=1)
    box('KB_Row4', (0.0,  0.038, 0.017), (0.41, 0.018, 0.006), 'rubber', bevel=0.001, seg=1)
    commit('Keyboard', 'prop', custom_footprint=(0.44, 0.13))

    # 5. Laptop (open, screenWarm screen)
    box('Lap_Base', (0.0, -0.02, 0.006), (0.32, 0.22, 0.012), 'alu', bevel=0.003, seg=1)
    box('Lap_Pad', (0.0, -0.08, 0.0125), (0.09, 0.06, 0.001), 'aluDark', bevel=0.001, seg=1)
    box('Lap_Keys', (0.0, 0.02, 0.013), (0.28, 0.11, 0.002), 'graphite', bevel=0.001, seg=1)
    box('Lap_Lid', (0.0, 0.09, 0.11), (0.32, 0.01, 0.20), 'alu', bevel=0.003, seg=1)
    box('Lap_Bezel', (0.0, 0.084, 0.11), (0.31, 0.003, 0.19), 'graphite', bevel=0.002, seg=1)
    box('Lap_Screen', (0.0, 0.082, 0.11), (0.28, 0.002, 0.16), 'screenWarm', bevel=0.001, seg=1)
    commit('Laptop', 'prop', custom_footprint=(0.32, 0.24))

    # 6. DeskPhone (handset + sagging cord tube)
    box('Phone_BaseMain', (0.0, 0.0, 0.025), (0.20, 0.20, 0.05), 'graphite', bevel=0.005, seg=1)
    box('Phone_Console', (0.04, 0.03, 0.055), (0.10, 0.12, 0.02), 'aluDark', bevel=0.002, seg=1)
    box('Phone_Display', (0.04, 0.06, 0.067), (0.08, 0.04, 0.004), 'porcelain', bevel=0.001, seg=1)
    box('Phone_HandsetMid', (-0.06, 0.0, 0.07), (0.035, 0.10, 0.025), 'graphite', bevel=0.004, seg=1)
    box('Phone_HandsetEar', (-0.06, 0.065, 0.065), (0.045, 0.045, 0.035), 'graphite', bevel=0.004, seg=1)
    box('Phone_HandsetMic', (-0.06, -0.065, 0.065), (0.045, 0.045, 0.035), 'graphite', bevel=0.004, seg=1)
    cord_pts = [
        (-0.06, -0.085, 0.05),
        (-0.075, -0.095, 0.02),
        (-0.095, -0.08, 0.008),
        (-0.115, -0.05, 0.008),
        (-0.105, -0.02, 0.015),
        (-0.095, -0.01, 0.02),
    ]
    tube(cord_pts, radius=0.004, swatch='rubber', res=1)
    commit('DeskPhone', 'prop', custom_footprint=(0.22, 0.22))

    # 7. ServerRackA (0.6x1.0x2.0 graphite + alu rails + slot fronts, ONE emissive part strip of ledGreen + one beaconAmber LED)
    box('SR_A_Base', (0.0, 0.0, 0.04), (0.60, 1.00, 0.08), 'graphite', bevel=0.01, seg=1)
    box('SR_A_Roof', (0.0, 0.0, 1.96), (0.60, 1.00, 0.08), 'graphite', bevel=0.01, seg=1)
    box('SR_A_SideL', (-0.285, 0.0, 1.0), (0.03, 0.98, 1.84), 'graphite', bevel=0.005, seg=1)
    box('SR_A_SideR', (0.285, 0.0, 1.0), (0.03, 0.98, 1.84), 'graphite', bevel=0.005, seg=1)
    box('SR_A_Back', (0.0, 0.485, 1.0), (0.54, 0.03, 1.84), 'graphite', bevel=0.005, seg=1)
    box('SR_A_RailL', (-0.23, -0.44, 1.0), (0.03, 0.04, 1.84), 'alu', bevel=0.002, seg=1)
    box('SR_A_RailR', (0.23, -0.44, 1.0), (0.03, 0.04, 1.84), 'alu', bevel=0.002, seg=1)
    box('SR_A_Slot1', (0.0, -0.42, 0.40), (0.44, 0.08, 0.45), 'aluDark', bevel=0.003, seg=1)
    box('SR_A_Slot2', (0.0, -0.42, 0.95), (0.44, 0.08, 0.45), 'graphite', bevel=0.003, seg=1)
    box('SR_A_Slot3', (0.0, -0.42, 1.50), (0.44, 0.08, 0.45), 'aluDark', bevel=0.003, seg=1)
    box('SR_A_LedStrip', (0.0, -0.465, 1.55), (0.28, 0.01, 0.015), 'ledGreen', bevel=0.001, seg=1)
    cyl('SR_A_Beacon', (0.16, -0.465, 1.62), 0.012, 0.015, 'beaconAmber', v=8, rot=(math.pi / 2.0, 0.0, 0.0))
    commit('ServerRackA', 'prop', custom_footprint=(0.60, 1.00))

    # 8. ServerRackB (glass door variant: graphite + alu + 'glass' door, no emissive)
    box('SR_B_Base', (0.0, 0.0, 0.04), (0.60, 1.00, 0.08), 'graphite', bevel=0.01, seg=1)
    box('SR_B_Roof', (0.0, 0.0, 1.96), (0.60, 1.00, 0.08), 'graphite', bevel=0.01, seg=1)
    box('SR_B_SideL', (-0.285, 0.0, 1.0), (0.03, 0.98, 1.84), 'graphite', bevel=0.005, seg=1)
    box('SR_B_SideR', (0.285, 0.0, 1.0), (0.03, 0.98, 1.84), 'graphite', bevel=0.005, seg=1)
    box('SR_B_Back', (0.0, 0.485, 1.0), (0.54, 0.03, 1.84), 'graphite', bevel=0.005, seg=1)
    box('SR_B_RailL', (-0.23, -0.42, 1.0), (0.03, 0.04, 1.84), 'alu', bevel=0.002, seg=1)
    box('SR_B_RailR', (0.23, -0.42, 1.0), (0.03, 0.04, 1.84), 'alu', bevel=0.002, seg=1)
    box('SR_B_Slot1', (0.0, -0.38, 0.55), (0.44, 0.12, 0.65), 'graphite', bevel=0.003, seg=1)
    box('SR_B_Slot2', (0.0, -0.38, 1.30), (0.44, 0.12, 0.65), 'aluDark', bevel=0.003, seg=1)
    box('SR_B_DoorTop', (0.0, -0.48, 1.90), (0.54, 0.02, 0.04), 'alu', bevel=0.002, seg=1)
    box('SR_B_DoorBtm', (0.0, -0.48, 0.10), (0.54, 0.02, 0.04), 'alu', bevel=0.002, seg=1)
    box('SR_B_DoorL', (-0.25, -0.48, 1.0), (0.04, 0.02, 1.76), 'alu', bevel=0.002, seg=1)
    box('SR_B_DoorR', (0.25, -0.48, 1.0), (0.04, 0.02, 1.76), 'alu', bevel=0.002, seg=1)
    box('SR_B_Handle', (0.22, -0.495, 1.0), (0.02, 0.02, 0.16), 'aluDark', bevel=0.002, seg=1)
    box('SR_B_Glass', (0.0, -0.48, 1.0), (0.46, 0.008, 1.76), 'glass', bevel=0)
    commit('ServerRackB', 'prop', custom_footprint=(0.60, 1.00))

    # 9. FilingCabinet (3 drawers alu handles)
    box('FC_Body', (0.0, 0.01, 0.525), (0.45, 0.58, 1.05), 'steel', bevel=0.008, seg=1)
    for idx, dz in enumerate([0.19, 0.525, 0.86]):
        box(f'FC_Drawer_{idx}', (0.0, -0.29, dz), (0.42, 0.02, 0.30), 'steel', bevel=0.003, seg=1)
        box(f'FC_Handle_{idx}', (0.0, -0.31, dz + 0.06), (0.16, 0.02, 0.025), 'alu', bevel=0.002, seg=1)
    commit('FilingCabinet', 'prop', custom_footprint=(0.45, 0.60))

    # 10. WaterCooler (white body + waterBlue bottle)
    box('WC_Base', (0.0, 0.0, 0.04), (0.34, 0.34, 0.08), 'graphite', bevel=0.005, seg=1)
    box('WC_Body', (0.0, 0.0, 0.50), (0.32, 0.32, 0.84), 'white', bevel=0.01, seg=2)
    box('WC_Alcove', (0.0, -0.11, 0.72), (0.24, 0.08, 0.28), 'graphite', bevel=0.004, seg=1)
    box('WC_DripTray', (0.0, -0.13, 0.58), (0.22, 0.08, 0.02), 'aluDark', bevel=0.002, seg=1)
    box('WC_TapCold', (-0.04, -0.12, 0.82), (0.02, 0.03, 0.04), 'bluePoly', bevel=0.002, seg=1)
    box('WC_TapHot', (0.04, -0.12, 0.82), (0.02, 0.03, 0.04), 'red', bevel=0.002, seg=1)
    cyl('WC_Collar', (0.0, 0.0, 0.94), 0.14, 0.04, 'white', v=12)
    cyl('WC_BottleNeck', (0.0, 0.0, 0.98), 0.045, 0.05, 'waterBlue', v=12)
    cyl('WC_BottleShoulder', (0.0, 0.0, 1.05), 0.13, 0.10, 'waterBlue', v=12, r2=0.05)
    cyl('WC_BottleBody', (0.0, 0.0, 1.22), 0.13, 0.24, 'waterBlue', v=12)
    cyl('WC_BottleCap', (0.0, 0.0, 1.35), 0.10, 0.03, 'waterBlue', v=12, r2=0.13)
    commit('WaterCooler', 'prop', custom_footprint=(0.36, 0.36))

    # 11. PlantPot (terracotta pot + 5-7 leaf blades leaf/leafLight)
    cyl('Pot_Body', (0.0, 0.0, 0.14), 0.15, 0.28, 'terracotta', v=12, r2=0.11)
    cyl('Pot_Rim', (0.0, 0.0, 0.27), 0.16, 0.04, 'terracotta', v=12)
    cyl('Pot_Soil', (0.0, 0.0, 0.26), 0.14, 0.02, 'graphite', v=12)
    for i in range(6):
        ang = i * (2.0 * math.pi / 6.0) + 0.2
        tilt = 0.22 if i % 2 == 0 else 0.32
        swatch = 'leaf' if i % 2 == 0 else 'leafLight'
        h = 0.38 if i % 2 == 0 else 0.44
        r_mid = 0.04 + math.sin(tilt) * (h / 2.0)
        z_mid = 0.26 + math.cos(tilt) * (h / 2.0)
        cx, cy = math.cos(ang) * r_mid, math.sin(ang) * r_mid
        cyl(f'Pot_Leaf_{i}', (cx, cy, z_mid), 0.005, h, swatch, v=8, r2=0.035, rot=(0.0, tilt, ang))
    commit('PlantPot', 'prop', custom_footprint=(0.40, 0.40))

    # 12. CoffeeMug (porcelain + handle)
    cyl('Mug_Body', (0.0, 0.0, 0.048), 0.042, 0.095, 'porcelain', v=12)
    cyl('Mug_Liquid', (0.0, 0.0, 0.085), 0.038, 0.015, 'graphite', v=12)
    mug_handle_pts = [
        (0.040, 0.0, 0.080),
        (0.065, 0.0, 0.070),
        (0.070, 0.0, 0.048),
        (0.065, 0.0, 0.025),
        (0.040, 0.0, 0.020),
    ]
    tube(mug_handle_pts, radius=0.006, swatch='porcelain', res=1)
    commit('CoffeeMug', 'prop', custom_footprint=(0.12, 0.12))

    # 13. Printer (porcelain + graphite tray)
    box('Print_Body', (0.0, 0.02, 0.11), (0.44, 0.32, 0.20), 'porcelain', bevel=0.01, seg=2)
    box('Print_TopLid', (0.0, 0.03, 0.215), (0.42, 0.30, 0.02), 'porcelain', bevel=0.005, seg=1)
    box('Print_Panel', (0.13, -0.145, 0.18), (0.14, 0.03, 0.04), 'graphite', bevel=0.002, seg=1)
    box('Print_Screen', (0.15, -0.161, 0.18), (0.05, 0.002, 0.025), 'paper', bevel=0.001, seg=1)
    box('Print_Tray', (0.0, -0.12, 0.06), (0.24, 0.14, 0.015), 'graphite', bevel=0.002, seg=1)
    box('Print_Paper', (0.0, -0.10, 0.072), (0.21, 0.12, 0.008), 'paper', bevel=0.001, seg=1)
    box('Print_Cassette', (0.0, -0.05, 0.02), (0.40, 0.26, 0.035), 'graphite', bevel=0.003, seg=1)
    commit('Printer', 'prop', custom_footprint=(0.46, 0.38))

    # 14. Whiteboard (1.8x1.0 white board on alu stand + 3 scribble strips bluePoly/graphite + tray)
    box('WB_LegL', (-0.88, 0.0, 0.95), (0.04, 0.04, 1.80), 'alu', bevel=0.003, seg=1)
    box('WB_LegR', (0.88, 0.0, 0.95), (0.04, 0.04, 1.80), 'alu', bevel=0.003, seg=1)
    box('WB_FootL', (-0.88, 0.0, 0.03), (0.04, 0.50, 0.04), 'alu', bevel=0.003, seg=1)
    box('WB_FootR', (0.88, 0.0, 0.03), (0.04, 0.50, 0.04), 'alu', bevel=0.003, seg=1)
    box('WB_Brace', (0.0, 0.0, 0.40), (1.72, 0.03, 0.03), 'alu', bevel=0.002, seg=1)
    box('WB_Frame', (0.0, 0.0, 1.30), (1.82, 0.03, 1.02), 'alu', bevel=0.004, seg=1)
    box('WB_Board', (0.0, -0.005, 1.30), (1.80, 0.015, 1.00), 'white', bevel=0.002, seg=1)
    box('WB_Tray', (0.0, -0.035, 0.79), (0.80, 0.05, 0.015), 'alu', bevel=0.002, seg=1)
    box('WB_Scribble1', (-0.35, -0.014, 1.45), (0.45, 0.002, 0.02), 'graphite', bevel=0.001, seg=1)
    box('WB_Scribble2', (0.25, -0.014, 1.40), (0.50, 0.002, 0.02), 'bluePoly', bevel=0.001, seg=1)
    box('WB_Scribble3', (-0.20, -0.014, 1.20), (0.35, 0.002, 0.02), 'bluePoly', bevel=0.001, seg=1)
    commit('Whiteboard', 'prop', custom_footprint=(1.90, 0.55))

    # 15. TrashBin
    cyl('Bin_Body', (0.0, 0.0, 0.18), 0.13, 0.36, 'aluDark', v=12, r2=0.11)
    cyl('Bin_Rim', (0.0, 0.0, 0.36), 0.135, 0.025, 'alu', v=12)
    cyl('Bin_Inside', (0.0, 0.0, 0.16), 0.115, 0.30, 'graphite', v=12)
    box('Bin_Paper', (0.02, 0.02, 0.22), (0.08, 0.07, 0.07), 'paper', bevel=0.01, seg=1)
    commit('TrashBin', 'prop', custom_footprint=(0.28, 0.28))

    # 16. BoxSmall (cardboard + tape strip paper)
    box('BoxS_Body', (0.0, 0.0, 0.13), (0.40, 0.30, 0.26), 'cardboard', bevel=0.01, seg=2)
    box('BoxS_TapeTop', (0.0, 0.0, 0.261), (0.402, 0.05, 0.002), 'paper', bevel=0.001, seg=1)
    box('BoxS_TapeFront', (0.0, -0.151, 0.22), (0.05, 0.002, 0.07), 'paper', bevel=0.001, seg=1)
    box('BoxS_TapeBack', (0.0, 0.151, 0.22), (0.05, 0.002, 0.07), 'paper', bevel=0.001, seg=1)
    commit('BoxSmall', 'prop', custom_footprint=(0.40, 0.30))

    # 17. CrateStack (3 cardboard boxes stacked, offset)
    box('Crate_Box1', (-0.02, 0.0, 0.175), (0.54, 0.44, 0.35), 'cardboard', bevel=0.012, seg=2)
    box('Crate_Tape1', (-0.02, 0.0, 0.351), (0.542, 0.06, 0.002), 'paper', bevel=0.001, seg=1)
    box('Crate_Box2', (0.04, 0.03, 0.51), (0.46, 0.38, 0.32), 'cardboard', bevel=0.010, seg=2)
    box('Crate_Tape2', (0.04, 0.03, 0.671), (0.462, 0.05, 0.002), 'paper', bevel=0.001, seg=1)
    box('Crate_Box3', (-0.03, -0.02, 0.80), (0.36, 0.30, 0.26), 'cardboard', bevel=0.008, seg=2)
    box('Crate_Tape3', (-0.03, -0.02, 0.931), (0.362, 0.05, 0.002), 'paper', bevel=0.001, seg=1)
    commit('CrateStack', 'prop', custom_footprint=(0.70, 0.60))
