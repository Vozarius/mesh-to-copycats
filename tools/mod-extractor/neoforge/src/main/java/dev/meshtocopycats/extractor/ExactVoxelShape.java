package dev.meshtocopycats.extractor;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.VoxelShape;

final class ExactVoxelShape {
    private static final Comparator<int[]> BOX_ORDER = (left, right) -> {
        for (int coordinate = 0; coordinate < 6; coordinate++) {
            int comparison = Integer.compare(left[coordinate], right[coordinate]);
            if (comparison != 0) return comparison;
        }
        return 0;
    };

    private ExactVoxelShape() {}

    static List<int[]> boxes(VoxelShape shape, String identity) {
        List<int[]> result = new ArrayList<>();
        for (AABB box : shape.optimize().toAabbs()) {
            result.add(new int[] {
                coordinate(box.minX, identity),
                coordinate(box.minY, identity),
                coordinate(box.minZ, identity),
                coordinate(box.maxX, identity),
                coordinate(box.maxY, identity),
                coordinate(box.maxZ, identity)
            });
        }
        result.sort(BOX_ORDER);
        for (int[] box : result) {
            if (box[0] >= box[3] || box[1] >= box[4] || box[2] >= box[5]) {
                throw new IllegalStateException("Degenerate shape box for " + identity);
            }
        }
        return List.copyOf(result);
    }

    static boolean equalBoxes(List<int[]> left, List<int[]> right) {
        if (left.size() != right.size()) return false;
        for (int index = 0; index < left.size(); index++) {
            if (!java.util.Arrays.equals(left.get(index), right.get(index))) return false;
        }
        return true;
    }

    private static int coordinate(double value, String identity) {
        double scaled = value * 16.0;
        double rounded = Math.rint(scaled);
        if (!Double.isFinite(value) || value < 0.0 || value > 1.0 || scaled != rounded) {
            throw new IllegalStateException(
                "Shape " + identity + " is not exact on the integer 0..16 lattice: " + value
            );
        }
        return Math.toIntExact((long) rounded);
    }
}
