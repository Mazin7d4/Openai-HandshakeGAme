"""Props kit module B for headless Blender kit."""
import math


def build(box, cyl, tube, commit):
    # -----------------------------------------------------------------------
    # 1. Cone: traffic cone (amberPaint + white band + square rubber base)
    # -----------------------------------------------------------------------
    box('Cone_Base', (0.0, 0.0, 0.015), (0.40, 0.40, 0.03), 'rubber', bevel=0.005, seg=1)
    cyl('Cone_Bottom', (0.0, 0.0, 0.165), 0.095, 0.27, 'amberPaint', v=12, r2=0.15)
    cyl('Cone_Band', (0.0, 0.0, 0.37), 0.065, 0.14, 'white', v=12, r2=0.095)
    cyl('Cone_Top', (0.0, 0.0, 0.545), 0.025, 0.21, 'amberPaint', v=12, r2=0.065)
    cyl('Cone_Rim', (0.0, 0.0, 0.655), 0.026, 0.01, 'amberPaint', v=12)
    commit('Cone', 'prop', custom_footprint=(0.40, 0.40))

    # -----------------------------------------------------------------------
    # 2. WetFloorSign: A-frame amberPaint with graphite pictogram strip (no text)
    # -----------------------------------------------------------------------
    box('Sign_Hinge', (0.0, 0.0, 0.55), (0.30, 0.03, 0.03), 'amberPaint', bevel=0.004, seg=1)
    box('Sign_Handle', (0.0, 0.0, 0.575), (0.12, 0.015, 0.025), 'graphite', bevel=0.003, seg=1)
    cyl('Sign_Pin_L', (-0.14, 0.0, 0.55), 0.008, 0.04, 'graphite', v=8, rot=(0.0, math.pi / 2.0, 0.0))
    cyl('Sign_Pin_R', (0.14, 0.0, 0.55), 0.008, 0.04, 'graphite', v=8, rot=(0.0, math.pi / 2.0, 0.0))
    tilt = math.radians(14.0)
    f_panel = box('Sign_Face_Front', (0.0, -0.068, 0.27), (0.28, 0.015, 0.54), 'amberPaint', bevel=0.006, seg=1)
    f_panel.rotation_euler = (-tilt, 0.0, 0.0)
    b_panel = box('Sign_Face_Back', (0.0, 0.068, 0.27), (0.28, 0.015, 0.54), 'amberPaint', bevel=0.006, seg=1)
    b_panel.rotation_euler = (tilt, 0.0, 0.0)
    f_picto = box('Sign_Picto_Front', (0.0, -0.076, 0.27), (0.18, 0.005, 0.12), 'graphite', bevel=0.002, seg=1)
    f_picto.rotation_euler = (-tilt, 0.0, 0.0)
    commit('WetFloorSign', 'prop', custom_footprint=(0.32, 0.35))

    # -----------------------------------------------------------------------
    # 3. CeilingLamp: pendant alu shade + diffuser disc + cable up to z=3.0 (bottom z=2.3)
    # -----------------------------------------------------------------------
    cyl('CeilingLamp_Diffuser', (0.0, 0.0, 2.31), 0.18, 0.02, 'diffuser', v=16)
    cyl('CeilingLamp_Shade_Flare', (0.0, 0.0, 2.37), 0.12, 0.14, 'alu', v=16, r2=0.22)
    cyl('CeilingLamp_Shade_Top', (0.0, 0.0, 2.48), 0.04, 0.08, 'alu', v=16, r2=0.12)
    cyl('CeilingLamp_Collar', (0.0, 0.0, 2.535), 0.015, 0.03, 'aluDark', v=12)
    cyl('CeilingLamp_Canopy', (0.0, 0.0, 2.985), 0.06, 0.03, 'alu', v=16)
    lamp_cable = [
        (0.0, 0.0, 2.97),
        (0.006, 0.004, 2.86),
        (-0.005, -0.003, 2.74),
        (0.004, 0.003, 2.64),
        (0.0, 0.0, 2.55)
    ]
    tube(lamp_cable, 0.004, 'rubber', res=1)
    commit('CeilingLamp', 'prop', custom_footprint=(0.44, 0.44))

    # -----------------------------------------------------------------------
    # 4. DeskLamp: articulated alu arm + diffuser emissive
    # -----------------------------------------------------------------------
    cyl('DeskLamp_Base', (0.0, 0.0, 0.01), 0.09, 0.02, 'aluDark', v=16)
    cyl('DeskLamp_Joint_Base', (0.0, 0.05, 0.035), 0.015, 0.03, 'alu', v=12, rot=(math.pi / 2.0, 0.0, 0.0))
    arm1 = [
        (0.0, 0.05, 0.035),
        (0.0, 0.04, 0.12),
        (0.0, 0.03, 0.20),
        (0.0, 0.02, 0.28)
    ]
    tube(arm1, 0.006, 'alu', res=1)
    cyl('DeskLamp_Joint_Elbow', (0.0, 0.02, 0.28), 0.015, 0.03, 'aluDark', v=12, rot=(math.pi / 2.0, 0.0, 0.0))
    arm2 = [
        (0.0, 0.02, 0.28),
        (0.0, -0.03, 0.34),
        (0.0, -0.08, 0.39),
        (0.0, -0.13, 0.42)
    ]
    tube(arm2, 0.006, 'alu', res=1)
    cyl('DeskLamp_Joint_Head', (0.0, -0.13, 0.42), 0.012, 0.025, 'aluDark', v=12, rot=(math.pi / 2.0, 0.0, 0.0))
    shade_rot = (math.radians(35.0), 0.0, 0.0)
    cyl('DeskLamp_Shade', (0.0, -0.17, 0.38), 0.045, 0.10, 'alu', v=14, r2=0.07, rot=shade_rot)
    cyl('DeskLamp_Diffuser', (0.0, -0.20, 0.34), 0.065, 0.015, 'diffuser', v=14, rot=shade_rot)
    cable_loop = [
        (0.0, 0.035, 0.24),
        (0.015, 0.055, 0.28),
        (0.0, 0.005, 0.31)
    ]
    tube(cable_loop, 0.003, 'rubber', res=1)
    commit('DeskLamp', 'prop', custom_footprint=(0.22, 0.30))

    # -----------------------------------------------------------------------
    # 5. GoldenStapler: executive desk stapler (gold)
    # -----------------------------------------------------------------------
    box('Stapler_Base', (0.0, 0.0, 0.01), (0.05, 0.16, 0.02), 'gold', bevel=0.003, seg=1)
    box('Stapler_Foot', (0.0, 0.0, 0.0015), (0.046, 0.15, 0.003), 'rubber', bevel=0.001, seg=1)
    box('Stapler_Anvil', (0.0, -0.055, 0.021), (0.03, 0.025, 0.002), 'steel', bevel=0.001, seg=1)
    box('Stapler_Hinge', (0.0, 0.06, 0.03), (0.04, 0.03, 0.025), 'gold', bevel=0.003, seg=1)
    cyl('Stapler_Pin', (0.0, 0.06, 0.03), 0.006, 0.044, 'steel', v=8, rot=(0.0, math.pi / 2.0, 0.0))
    box('Stapler_Arm', (0.0, -0.01, 0.042), (0.042, 0.13, 0.02), 'gold', bevel=0.003, seg=1)
    box('Stapler_Cap', (0.0, -0.015, 0.058), (0.046, 0.14, 0.016), 'gold', bevel=0.005, seg=2)
    box('Stapler_Nose', (0.0, -0.065, 0.045), (0.044, 0.03, 0.03), 'gold', bevel=0.004, seg=1)
    commit('GoldenStapler', 'prop', custom_footprint=(0.06, 0.18))

    # -----------------------------------------------------------------------
    # 6. PrototypePhone: slim white phone lying flat + screenWarm face
    # -----------------------------------------------------------------------
    box('Phone_Body', (0.0, 0.0, 0.005), (0.078, 0.158, 0.01), 'white', bevel=0.003, seg=2)
    box('Phone_Rim', (0.0, 0.0, 0.005), (0.080, 0.160, 0.008), 'alu', bevel=0.002, seg=1)
    box('Phone_Screen', (0.0, 0.002, 0.0105), (0.070, 0.145, 0.001), 'screenWarm', bevel=0.001, seg=1)
    box('Phone_Speaker', (0.0, 0.070, 0.0105), (0.02, 0.003, 0.001), 'graphite', bevel=0.0005, seg=1)
    cyl('Phone_Camera_Dot', (-0.022, 0.070, 0.0105), 0.0025, 0.001, 'graphite', v=8)
    commit('PrototypePhone', 'prop', custom_footprint=(0.08, 0.16))

    # -----------------------------------------------------------------------
    # 7. KeycardReader: wall box graphite + amberPaint stripe + lensAmber LED
    # -----------------------------------------------------------------------
    box('Keycard_Plate', (0.0, 0.0175, 1.18), (0.108, 0.005, 0.168), 'aluDark', bevel=0.002, seg=1)
    box('Keycard_Body', (0.0, 0.0, 1.18), (0.10, 0.035, 0.16), 'graphite', bevel=0.006, seg=2)
    box('Keycard_Stripe', (0.0, -0.0185, 1.17), (0.09, 0.003, 0.025), 'amberPaint', bevel=0.002, seg=1)
    box('Keycard_Pad', (0.0, -0.018, 1.135), (0.07, 0.003, 0.045), 'graphite', bevel=0.002, seg=1)
    cyl('Keycard_LED', (0.0, -0.0185, 1.23), 0.008, 0.004, 'lensAmber', v=10, rot=(math.pi / 2.0, 0.0, 0.0))
    commit('KeycardReader', 'prop', custom_footprint=(0.11, 0.04))

    # -----------------------------------------------------------------------
    # 8. HackTerminal: kiosk 0.5 wide 1.2 tall (graphite body, porcelain stand)
    # -----------------------------------------------------------------------
    box('Terminal_Base', (0.0, 0.0, 0.02), (0.44, 0.36, 0.04), 'porcelain', bevel=0.008, seg=1)
    box('Terminal_Pillar', (0.0, 0.02, 0.38), (0.16, 0.14, 0.68), 'porcelain', bevel=0.01, seg=2)
    box('Terminal_Neck', (0.0, 0.01, 0.74), (0.22, 0.16, 0.04), 'alu', bevel=0.004, seg=1)
    box('Terminal_Body', (0.0, -0.02, 0.98), (0.50, 0.26, 0.44), 'graphite', bevel=0.015, seg=2)
    box('Terminal_Bezel', (0.0, -0.155, 0.99), (0.46, 0.03, 0.38), 'graphite', bevel=0.008, seg=1)
    box('HackTerminal_Screen', (0.0, -0.171, 1.00), (0.36, 0.005, 0.28), 'screenWarm', bevel=0.002, seg=1)
    box('Terminal_Keypad_Ledge', (0.0, -0.18, 0.82), (0.44, 0.12, 0.03), 'aluDark', bevel=0.004, seg=1)
    box('Terminal_Keypad', (0.0, -0.18, 0.836), (0.28, 0.08, 0.004), 'rubber', bevel=0.001, seg=1)
    commit('HackTerminal', 'prop', custom_footprint=(0.50, 0.40))

    # -----------------------------------------------------------------------
    # 9. SecurityCamera: wall bracket + wedge housing (porcelain/graphite) + lensAmber lens
    # -----------------------------------------------------------------------
    box('Camera_WallPlate', (0.0, 0.155, 2.45), (0.12, 0.01, 0.16), 'graphite', bevel=0.004, seg=1)
    box('Camera_Arm', (0.0, 0.08, 2.45), (0.035, 0.14, 0.035), 'alu', bevel=0.003, seg=1)
    cyl('Camera_Swivel', (0.0, 0.01, 2.43), 0.025, 0.05, 'graphite', v=12)
    box('Camera_Shell_Top', (0.0, -0.06, 2.39), (0.14, 0.20, 0.08), 'porcelain', bevel=0.012, seg=2)
    box('Camera_Shell_Bottom', (0.0, -0.06, 2.33), (0.12, 0.18, 0.05), 'graphite', bevel=0.008, seg=1)
    box('Camera_Visor', (0.0, -0.08, 2.435), (0.15, 0.22, 0.015), 'porcelain', bevel=0.004, seg=1)
    box('Camera_Stripe', (0.0, -0.06, 2.355), (0.142, 0.19, 0.01), 'amberPaint', bevel=0.002, seg=1)
    cyl('Camera_Lens_Bezel', (0.0, -0.16, 2.36), 0.035, 0.02, 'graphite', v=14, rot=(math.pi / 2.0, 0.0, 0.0))
    cyl('Camera_Lens', (0.0, -0.171, 2.36), 0.026, 0.006, 'lensAmber', v=12, rot=(math.pi / 2.0, 0.0, 0.0))
    cam_cable = [
        (0.0, 0.14, 2.40),
        (0.02, 0.08, 2.38),
        (0.015, 0.02, 2.36),
        (0.0, -0.01, 2.37)
    ]
    tube(cam_cable, 0.004, 'rubber', res=1)
    commit('SecurityCamera', 'prop', custom_footprint=(0.16, 0.32))

    # -----------------------------------------------------------------------
    # 10. Extinguisher: red body + graphite hose tube + wall bracket alu
    # -----------------------------------------------------------------------
    box('Exting_WallPlate', (0.0, 0.125, 0.58), (0.08, 0.01, 0.36), 'alu', bevel=0.003, seg=1)
    box('Exting_Strap_Top', (0.0, 0.065, 0.68), (0.20, 0.13, 0.03), 'alu', bevel=0.003, seg=1)
    box('Exting_Strap_Bottom', (0.0, 0.065, 0.42), (0.20, 0.13, 0.03), 'alu', bevel=0.003, seg=1)
    cyl('Exting_BaseRing', (0.0, 0.0, 0.315), 0.092, 0.03, 'graphite', v=16)
    cyl('Exting_Tank', (0.0, 0.0, 0.53), 0.09, 0.40, 'red', v=16)
    cyl('Exting_Dome', (0.0, 0.0, 0.755), 0.04, 0.05, 'red', v=16, r2=0.09)
    cyl('Exting_Label', (0.0, 0.0, 0.52), 0.091, 0.18, 'paper', v=16)
    cyl('Exting_Neck', (0.0, 0.0, 0.795), 0.022, 0.03, 'alu', v=12)
    cyl('Exting_Gauge', (0.03, -0.01, 0.81), 0.015, 0.015, 'aluDark', v=10, rot=(0.0, math.pi / 2.0, 0.0))
    box('Exting_Handle_Fixed', (0.0, 0.03, 0.82), (0.025, 0.08, 0.01), 'alu', bevel=0.002, seg=1)
    box('Exting_Handle_Squeeze', (0.0, 0.03, 0.85), (0.025, 0.09, 0.01), 'red', bevel=0.002, seg=1)
    cyl('Exting_PinRing', (-0.025, 0.03, 0.835), 0.012, 0.004, 'gold', v=8, rot=(0.0, math.pi / 2.0, 0.0))
    ext_hose = [
        (0.0, -0.025, 0.80),
        (-0.06, -0.05, 0.74),
        (-0.10, -0.02, 0.60),
        (-0.10, 0.02, 0.45),
        (-0.09, 0.06, 0.52)
    ]
    tube(ext_hose, 0.008, 'graphite', res=1)
    cyl('Exting_Nozzle', (-0.09, 0.06, 0.56), 0.014, 0.06, 'graphite', v=8, r2=0.010)
    commit('Extinguisher', 'prop', custom_footprint=(0.28, 0.26))

    # -----------------------------------------------------------------------
    # 11. Sofa: 2-seat fabric + oak legs
    # -----------------------------------------------------------------------
    cyl('Sofa_Leg_FL', (-0.62, -0.30, 0.08), 0.025, 0.16, 'oak', v=10, r2=0.018)
    cyl('Sofa_Leg_FR', (0.62, -0.30, 0.08), 0.025, 0.16, 'oak', v=10, r2=0.018)
    cyl('Sofa_Leg_BL', (-0.62, 0.30, 0.08), 0.025, 0.16, 'oak', v=10, r2=0.018)
    cyl('Sofa_Leg_BR', (0.62, 0.30, 0.08), 0.025, 0.16, 'oak', v=10, r2=0.018)
    box('Sofa_Frame', (0.0, 0.0, 0.15), (1.36, 0.68, 0.04), 'oak', bevel=0.005, seg=1)
    box('Sofa_Base_Cushion', (0.0, 0.0, 0.25), (1.50, 0.82, 0.16), 'fabric', bevel=0.025, seg=2)
    box('Sofa_Seat_L', (-0.32, -0.06, 0.37), (0.60, 0.60, 0.12), 'fabric', bevel=0.025, seg=2)
    box('Sofa_Seat_R', (0.32, -0.06, 0.37), (0.60, 0.60, 0.12), 'fabric', bevel=0.025, seg=2)
    box('Sofa_Backrest', (0.0, 0.30, 0.58), (1.50, 0.22, 0.44), 'fabric', bevel=0.03, seg=2)
    box('Sofa_Arm_L', (-0.70, -0.02, 0.50), (0.14, 0.80, 0.34), 'fabric', bevel=0.025, seg=2)
    box('Sofa_Arm_R', (0.70, -0.02, 0.50), (0.14, 0.80, 0.34), 'fabric', bevel=0.025, seg=2)
    commit('Sofa', 'prop', custom_footprint=(1.54, 0.84))

    # -----------------------------------------------------------------------
    # 12. VendingMachine: graphite body, screenDark front panel + diffuser top strip
    # -----------------------------------------------------------------------
    box('Vending_Kickplate', (0.0, 0.0, 0.06), (0.92, 0.76, 0.12), 'graphite', bevel=0.01, seg=1)
    box('Vending_Cabinet', (0.0, 0.02, 1.05), (0.95, 0.78, 1.80), 'graphite', bevel=0.02, seg=2)
    box('Vending_Header_Diffuser', (0.0, -0.375, 1.82), (0.86, 0.02, 0.16), 'diffuser', bevel=0.004, seg=1)
    box('Vending_Display_Panel', (-0.12, -0.375, 1.18), (0.62, 0.02, 1.00), 'screenDark', bevel=0.005, seg=1)
    box('Vending_Display_Frame', (-0.12, -0.365, 1.18), (0.66, 0.01, 1.04), 'aluDark', bevel=0.005, seg=1)
    box('Vending_Control_Panel', (0.30, -0.375, 1.25), (0.18, 0.02, 0.45), 'graphite', bevel=0.005, seg=1)
    box('Vending_Keypad', (0.30, -0.386, 1.30), (0.12, 0.004, 0.14), 'rubber', bevel=0.002, seg=1)
    box('Vending_CoinSlot', (0.30, -0.386, 1.15), (0.08, 0.004, 0.04), 'alu', bevel=0.002, seg=1)
    box('Vending_Pickup_Door', (0.0, -0.375, 0.35), (0.70, 0.03, 0.32), 'aluDark', bevel=0.008, seg=1)
    box('Vending_Pickup_Pocket', (0.0, -0.382, 0.35), (0.58, 0.01, 0.22), 'graphite', bevel=0.004, seg=1)
    commit('VendingMachine', 'prop', custom_footprint=(0.95, 0.82))

    # -----------------------------------------------------------------------
    # 13. Bookshelf: oak 0.9x0.35x1.9 with book rows as coloured strips
    # -----------------------------------------------------------------------
    box('Book_Side_L', (-0.435, 0.0, 0.95), (0.03, 0.35, 1.90), 'oak', bevel=0.004, seg=1)
    box('Book_Side_R', (0.435, 0.0, 0.95), (0.03, 0.35, 1.90), 'oak', bevel=0.004, seg=1)
    box('Book_Top', (0.0, 0.0, 1.885), (0.90, 0.35, 0.03), 'oak', bevel=0.004, seg=1)
    box('Book_Base', (0.0, 0.0, 0.05), (0.90, 0.35, 0.04), 'oak', bevel=0.004, seg=1)
    box('Book_Back', (0.0, 0.165, 0.95), (0.84, 0.02, 1.80), 'oak', bevel=0.002, seg=1)
    box('Book_Shelf_1', (0.0, -0.005, 0.50), (0.84, 0.32, 0.025), 'oak', bevel=0.003, seg=1)
    box('Book_Shelf_2', (0.0, -0.005, 0.95), (0.84, 0.32, 0.025), 'oak', bevel=0.003, seg=1)
    box('Book_Shelf_3', (0.0, -0.005, 1.40), (0.84, 0.32, 0.025), 'oak', bevel=0.003, seg=1)
    box('Books_Row1_A', (-0.20, -0.03, 0.20), (0.36, 0.22, 0.24), 'bluePoly', bevel=0.004, seg=1)
    box('Books_Row1_B', (0.18, -0.03, 0.19), (0.34, 0.22, 0.22), 'paper', bevel=0.004, seg=1)
    box('Books_Row2_A', (-0.12, -0.03, 0.65), (0.48, 0.22, 0.26), 'sage', bevel=0.004, seg=1)
    box('Books_Row2_B', (0.24, -0.03, 0.66), (0.22, 0.22, 0.28), 'oakGrain', bevel=0.004, seg=1)
    box('Books_Row3_A', (-0.24, -0.03, 1.10), (0.26, 0.22, 0.25), 'paper', bevel=0.004, seg=1)
    box('Books_Row3_B', (0.10, -0.03, 1.09), (0.38, 0.22, 0.23), 'bluePoly', bevel=0.004, seg=1)
    commit('Bookshelf', 'prop', custom_footprint=(0.90, 0.35))

    # -----------------------------------------------------------------------
    # 14. ExitSign: porcelain wall box + ledGreen face + graphite pictogram strip (no letters)
    # -----------------------------------------------------------------------
    box('ExitSign_Housing', (0.0, 0.003, 2.29), (0.36, 0.044, 0.18), 'porcelain', bevel=0.006, seg=2)
    box('ExitSign_Flange', (0.0, 0.023, 2.29), (0.37, 0.004, 0.19), 'aluDark', bevel=0.002, seg=1)
    box('ExitSign_Face', (0.0, -0.020, 2.29), (0.32, 0.004, 0.14), 'ledGreen', bevel=0.002, seg=1)
    box('ExitSign_Picto_Door', (-0.08, -0.0225, 2.29), (0.04, 0.002, 0.09), 'graphite', bevel=0.001, seg=1)
    box('ExitSign_Picto_Torso', (-0.03, -0.0225, 2.29), (0.035, 0.002, 0.065), 'graphite', bevel=0.001, seg=1)
    cyl('ExitSign_Picto_Head', (-0.03, -0.0225, 2.335), 0.012, 0.003, 'graphite', v=8, rot=(math.pi / 2.0, 0.0, 0.0))
    box('ExitSign_Picto_Arrow', (0.06, -0.0225, 2.29), (0.07, 0.002, 0.025), 'graphite', bevel=0.001, seg=1)
    commit('ExitSign', 'prop', custom_footprint=(0.36, 0.05))

    # -----------------------------------------------------------------------
    # 15. BreakerPanel: alu cabinet, door slightly open, graphite breakers, ledGreen LED
    # -----------------------------------------------------------------------
    box('Breaker_Cabinet', (0.0, 0.08, 1.56), (0.48, 0.12, 0.72), 'alu', bevel=0.008, seg=2)
    box('Breaker_Flange', (0.0, 0.137, 1.56), (0.50, 0.006, 0.74), 'aluDark', bevel=0.002, seg=1)
    box('Breaker_Deadfront', (0.0, 0.035, 1.56), (0.42, 0.02, 0.66), 'graphite', bevel=0.003, seg=1)
    box('Breaker_Row_L1', (-0.08, 0.02, 1.68), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_L2', (-0.08, 0.02, 1.58), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_L3', (-0.08, 0.02, 1.48), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_L4', (-0.08, 0.02, 1.38), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_R1', (0.08, 0.02, 1.68), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_R2', (0.08, 0.02, 1.58), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_R3', (0.08, 0.02, 1.48), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Row_R4', (0.08, 0.02, 1.38), (0.09, 0.015, 0.08), 'graphite', bevel=0.002, seg=1)
    box('Breaker_Toggles_L', (-0.05, 0.01, 1.53), (0.015, 0.008, 0.36), 'alu', bevel=0.001, seg=1)
    box('Breaker_Toggles_R', (0.05, 0.01, 1.53), (0.015, 0.008, 0.36), 'alu', bevel=0.001, seg=1)
    cyl('Breaker_StatusLED', (0.0, 0.02, 1.78), 0.008, 0.006, 'ledGreen', v=10, rot=(math.pi / 2.0, 0.0, 0.0))
    door_angle = math.radians(20.0)
    door = box('Breaker_Door', (-0.013, -0.052, 1.56), (0.44, 0.012, 0.70), 'alu', bevel=0.004, seg=1)
    door.rotation_euler = (0.0, 0.0, -door_angle)
    box('Breaker_Latch', (0.17, -0.115, 1.56), (0.02, 0.025, 0.08), 'aluDark', bevel=0.002, seg=1)
    commit('BreakerPanel', 'prop', custom_footprint=(0.50, 0.28))
