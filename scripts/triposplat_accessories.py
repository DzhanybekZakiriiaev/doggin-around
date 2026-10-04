import numpy as np


def segment_accessories(positions, colors, bone_names):
    positions = np.asarray(positions)
    colors = np.asarray(colors)
    names = [str(name) for name in bone_names]
    if positions.ndim != 2 or positions.shape[1] != 3:
        raise ValueError('positions must have shape (count, 3)')
    if colors.shape != positions.shape:
        raise ValueError('colors must match positions')
    if 'joint_14' not in names or 'joint_22' not in names:
        raise ValueError('head and neck joints are required')

    x, y, z = positions.T
    red, green, blue = colors.T
    cobalt = (blue > red * 1.15) & (blue > green * 1.03) & (blue > 0.04)
    amber = (red > green * 1.25) & (green > blue * 1.25) & (red > 0.3)
    dark = np.max(colors, axis=1) < 0.3
    pale = (np.min(colors, axis=1) > 0.55) & ((np.max(colors, axis=1) - np.min(colors, axis=1)) < 0.25)

    cap = cobalt & (y > 0.045) & (z > 0.18) & (np.abs(x) < 0.19)
    frames = amber & (y > 0.29) & (0.19 < z) & (z < 0.37) & (np.abs(x) < 0.23)
    lenses = dark & (y > 0.29) & (z > 0.20) & (np.abs(x) < 0.22)
    daisies = (amber | pale) & (y > 0.18) & (z > 0.355) & (np.abs(x) < 0.18)
    bow = (cobalt | amber) & (y > 0.18) & (-0.06 < z) & (z < 0.18) & (np.abs(x) < 0.21)
    collar = cobalt & (y > 0.045) & (0.025 < z) & (z < 0.18) & (np.abs(x) < 0.21)

    head = cap | frames | lenses | daisies
    neck = (bow | collar) & ~head
    metadata = {
        'head_joint': names.index('joint_14'),
        'neck_joint': names.index('joint_22'),
        'counts': {
            'cap': int(np.count_nonzero(cap)),
            'frames': int(np.count_nonzero(frames)),
            'lenses': int(np.count_nonzero(lenses)),
            'daisies': int(np.count_nonzero(daisies)),
            'bow': int(np.count_nonzero(bow)),
            'collar': int(np.count_nonzero(collar)),
            'head_total': int(np.count_nonzero(head)),
            'neck_total': int(np.count_nonzero(neck)),
        },
    }
    return head, neck, metadata
