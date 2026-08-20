package dev.meshtocopycats.extractor;

import java.util.Arrays;
import java.util.List;

/** Exact occupancy on Minecraft's integer 16 x 16 x 16 block lattice. */
final class VoxelMask16 {
    private static final int RESOLUTION = 16;
    private static final int WORD_COUNT = RESOLUTION * RESOLUTION * RESOLUTION / Long.SIZE;

    private final long[] words;

    private VoxelMask16(long[] words) {
        this.words = words;
    }

    static VoxelMask16 empty() {
        return new VoxelMask16(new long[WORD_COUNT]);
    }

    static VoxelMask16 fromBoxes(List<int[]> boxes) {
        VoxelMask16 result = empty();
        for (int[] box : boxes) {
            if (box.length != 6) {
                throw new IllegalArgumentException("A shape box must contain six coordinates");
            }
            for (int z = box[2]; z < box[5]; z++) {
                for (int y = box[1]; y < box[4]; y++) {
                    for (int x = box[0]; x < box[3]; x++) {
                        result.set(x, y, z);
                    }
                }
            }
        }
        return result;
    }

    boolean contains(VoxelMask16 other) {
        for (int index = 0; index < words.length; index++) {
            if ((words[index] & other.words[index]) != other.words[index]) return false;
        }
        return true;
    }

    boolean isEmpty() {
        for (long word : words) {
            if (word != 0) return false;
        }
        return true;
    }

    boolean isFull() {
        for (long word : words) {
            if (word != -1L) return false;
        }
        return true;
    }

    VoxelMask16 union(VoxelMask16 other) {
        long[] result = words.clone();
        for (int index = 0; index < result.length; index++) {
            result[index] |= other.words[index];
        }
        return new VoxelMask16(result);
    }

    private void set(int x, int y, int z) {
        if (
            x < 0 || x >= RESOLUTION ||
            y < 0 || y >= RESOLUTION ||
            z < 0 || z >= RESOLUTION
        ) {
            throw new IllegalArgumentException("Voxel coordinate is outside 0..15");
        }
        int bit = x + RESOLUTION * (y + RESOLUTION * z);
        words[bit / Long.SIZE] |= 1L << (bit % Long.SIZE);
    }

    @Override
    public boolean equals(Object other) {
        return this == other || other instanceof VoxelMask16 mask && Arrays.equals(words, mask.words);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(words);
    }
}
