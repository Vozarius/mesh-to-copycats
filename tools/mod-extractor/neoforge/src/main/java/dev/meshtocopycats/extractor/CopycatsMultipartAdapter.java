package dev.meshtocopycats.extractor;

import com.copycatsplus.copycats.foundation.copycat.multistate.IMultiStateCopycatBlock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.shapes.CollisionContext;

/**
 * Version-pinned bridge to Copycats+ 3.0.4 multi-state storage.
 *
 * <p>The public Copycats API identifies storage keys and whether each key exists in a state, but
 * it does not expose a three-dimensional shape for one material part. A part is accepted only when
 * an authoritative state of the same block contains that key and no other storage key. The closest
 * such state is used as an isolation witness. Its mask must be contained by the target mask, and all
 * isolated masks must reconstruct the target exactly. Ambiguity omits that realization with a
 * deterministic diagnostic instead of emitting guessed ownership.</p>
 */
final class CopycatsMultipartAdapter {
    private static final int MAX_MATERIAL_SLOTS = 256;
    private static final String COGWHEEL_BLOCK_CLASS =
        "com.copycatsplus.copycats.content.copycat.cogwheel.CopycatCogWheelBlock";
    private static final String COGWHEEL_KEY = "cogwheel";
    private static final String SHAFT_KEY = "shaft";
    private static final int COGWHEEL_MIN = 6;
    private static final int COGWHEEL_MAX = 10;

    private CopycatsMultipartAdapter() {}

    static Result extract(
        String blockId,
        Block block,
        BlockState targetState,
        List<BlockState> possibleStates,
        List<int[]> targetBoxes
    ) {
        if (!(block instanceof IMultiStateCopycatBlock copycat)) return Result.notMultipart();

        try {
            return Result.supported(extractMultipart(
                blockId,
                block,
                copycat,
                targetState,
                possibleStates,
                targetBoxes
            ));
        } catch (RuntimeException error) {
            String reason = error.getMessage();
            return Result.unsupported(reason == null ? error.getClass().getName() : reason);
        }
    }

    private static List<ExtractedPartGeometry> extractMultipart(
        String blockId,
        Block block,
        IMultiStateCopycatBlock copycat,
        BlockState targetState,
        List<BlockState> possibleStates,
        List<int[]> targetBoxes
    ) {

        List<String> storageKeys = storageKeys(blockId, copycat);
        Map<String, Integer> materialSlots = materialSlots(blockId, storageKeys);
        List<String> activeKeys = activeKeys(copycat, targetState, storageKeys);
        VoxelMask16 targetMask = VoxelMask16.fromBoxes(targetBoxes);

        if (activeKeys.isEmpty()) {
            if (!targetMask.isEmpty()) {
                throw failure(blockId, targetState, "has geometry but no active Copycats storage key");
            }
            return List.of();
        }

        if (block.getClass().getName().equals(COGWHEEL_BLOCK_CLASS)) {
            return extractPinnedCogwheel(
                blockId,
                targetState,
                storageKeys,
                activeKeys,
                materialSlots,
                targetBoxes,
                targetMask
            );
        }

        List<ExtractedPartGeometry> parts = new ArrayList<>(activeKeys.size());
        VoxelMask16 reconstructed = VoxelMask16.empty();
        for (String key : activeKeys) {
            Candidate witness = isolate(
                blockId,
                copycat,
                targetState,
                possibleStates,
                storageKeys,
                targetMask,
                key
            );
            parts.add(new ExtractedPartGeometry(
                witness.boxes(),
                key,
                materialSlots.get(key)
            ));
            reconstructed = reconstructed.union(witness.mask());
        }

        if (!reconstructed.equals(targetMask)) {
            throw failure(
                blockId,
                targetState,
                "isolated Copycats parts do not exactly reconstruct the outline shape"
            );
        }
        return List.copyOf(parts);
    }

    /**
     * Exact, version-pinned Copycats+ 3.0.4 cogwheel ownership.
     *
     * <p>{@code CopycatCogWheelBlock.partExists} is unconditionally true and its public
     * {@code getPropertyFromInteraction} assigns the cogwheel key exactly when the local hit
     * coordinate along AXIS is strictly between 0.375 and 0.625. Those are the integer GRID16
     * planes 6 and 10. Clipping the authoritative outline boxes at the same planes therefore
     * preserves its interaction ownership without attempting to reverse-engineer the fractional
     * render model.</p>
     */
    private static List<ExtractedPartGeometry> extractPinnedCogwheel(
        String blockId,
        BlockState targetState,
        List<String> storageKeys,
        List<String> activeKeys,
        Map<String, Integer> materialSlots,
        List<int[]> targetBoxes,
        VoxelMask16 targetMask
    ) {
        List<String> expectedKeys = List.of(COGWHEEL_KEY, SHAFT_KEY);
        if (!storageKeys.equals(expectedKeys) || !activeKeys.equals(expectedKeys)) {
            throw failure(
                blockId,
                targetState,
                "pinned cogwheel storage contract changed: expected active keys " + expectedKeys
            );
        }

        Direction.Axis axis = targetState.getValue(
            com.simibubi.create.content.kinetics.base.RotatedPillarKineticBlock.AXIS
        );
        List<int[]> cogwheelBoxes = clipBoxes(targetBoxes, axis, COGWHEEL_MIN, COGWHEEL_MAX);
        List<int[]> shaftBoxes = new ArrayList<>();
        shaftBoxes.addAll(clipBoxes(targetBoxes, axis, 0, COGWHEEL_MIN));
        shaftBoxes.addAll(clipBoxes(targetBoxes, axis, COGWHEEL_MAX, 16));
        shaftBoxes.sort(CopycatsMultipartAdapter::compareBoxes);

        VoxelMask16 cogwheelMask = VoxelMask16.fromBoxes(cogwheelBoxes);
        VoxelMask16 shaftMask = VoxelMask16.fromBoxes(shaftBoxes);
        if (
            cogwheelMask.isEmpty() ||
            shaftMask.isEmpty() ||
            !cogwheelMask.union(shaftMask).equals(targetMask)
        ) {
            throw failure(
                blockId,
                targetState,
                "pinned cogwheel GRID16 ownership does not reconstruct the outline shape"
            );
        }

        return List.of(
            new ExtractedPartGeometry(cogwheelBoxes, COGWHEEL_KEY, materialSlots.get(COGWHEEL_KEY)),
            new ExtractedPartGeometry(shaftBoxes, SHAFT_KEY, materialSlots.get(SHAFT_KEY))
        );
    }

    private static List<int[]> clipBoxes(
        List<int[]> boxes,
        Direction.Axis axis,
        int minimum,
        int maximum
    ) {
        int minimumIndex = axis.ordinal();
        int maximumIndex = minimumIndex + 3;
        List<int[]> clipped = new ArrayList<>();
        for (int[] source : boxes) {
            int[] box = source.clone();
            box[minimumIndex] = Math.max(box[minimumIndex], minimum);
            box[maximumIndex] = Math.min(box[maximumIndex], maximum);
            if (box[minimumIndex] < box[maximumIndex]) clipped.add(box);
        }
        clipped.sort(CopycatsMultipartAdapter::compareBoxes);
        return List.copyOf(clipped);
    }

    private static int compareBoxes(int[] left, int[] right) {
        for (int coordinate = 0; coordinate < 6; coordinate++) {
            int comparison = Integer.compare(left[coordinate], right[coordinate]);
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    private static Candidate isolate(
        String blockId,
        IMultiStateCopycatBlock copycat,
        BlockState targetState,
        List<BlockState> possibleStates,
        List<String> storageKeys,
        VoxelMask16 targetMask,
        String targetKey
    ) {
        List<Candidate> candidates = new ArrayList<>();
        for (BlockState candidateState : possibleStates) {
            List<String> candidateKeys = activeKeys(copycat, candidateState, storageKeys);
            if (candidateKeys.size() != 1 || !candidateKeys.getFirst().equals(targetKey)) continue;

            String candidateIdentity = blockId + ExtractionService.canonicalState(candidateState);
            List<int[]> candidateBoxes = ExactVoxelShape.boxes(
                candidateState.getShape(
                    new ControlledBlockGetter(Map.of(BlockPos.ZERO, candidateState)),
                    BlockPos.ZERO,
                    CollisionContext.empty()
                ),
                candidateIdentity
            );
            VoxelMask16 candidateMask = VoxelMask16.fromBoxes(candidateBoxes);
            if (candidateMask.isEmpty() || !targetMask.contains(candidateMask)) continue;
            candidates.add(new Candidate(
                candidateMask,
                candidateBoxes,
                propertyDistance(targetState, candidateState),
                candidateIdentity
            ));
        }

        if (candidates.isEmpty()) {
            throw failure(
                blockId,
                targetState,
                "cannot isolate storage key '" + targetKey + "' in a singleton state"
            );
        }

        int minimumDistance = candidates.stream()
            .mapToInt(Candidate::propertyDistance)
            .min()
            .orElseThrow();
        Map<VoxelMask16, Candidate> distinctMasks = new LinkedHashMap<>();
        candidates.stream()
            .filter(candidate -> candidate.propertyDistance() == minimumDistance)
            .sorted(Comparator.comparing(Candidate::identity))
            .forEach(candidate -> distinctMasks.putIfAbsent(candidate.mask(), candidate));

        if (distinctMasks.size() != 1) {
            throw failure(
                blockId,
                targetState,
                "has " + distinctMasks.size() +
                    " distinct minimum-distance singleton witnesses for storage key '" +
                    targetKey + "'"
            );
        }
        return distinctMasks.values().iterator().next();
    }

    private static List<String> storageKeys(String blockId, IMultiStateCopycatBlock copycat) {
        Set<String> rawKeys = Objects.requireNonNull(
            copycat.storageProperties(),
            () -> blockId + " returned null storageProperties()"
        );
        LinkedHashSet<String> checked = new LinkedHashSet<>();
        for (String key : rawKeys) {
            if (key == null || key.isEmpty() || key.indexOf('\0') >= 0) {
                throw new IllegalStateException(blockId + " returned an invalid Copycats storage key");
            }
            if (!checked.add(key)) {
                throw new IllegalStateException(blockId + " returned duplicate Copycats storage key '" + key + "'");
            }
        }
        if (checked.isEmpty()) {
            throw new IllegalStateException(blockId + " returned no Copycats storage keys");
        }
        return checked.stream().sorted().toList();
    }

    private static Map<String, Integer> materialSlots(String blockId, List<String> storageKeys) {
        if (storageKeys.size() > MAX_MATERIAL_SLOTS) {
            throw new IllegalStateException(blockId + " has more than 256 Copycats material slots");
        }
        Map<String, Integer> slots = new LinkedHashMap<>();
        for (int index = 0; index < storageKeys.size(); index++) {
            slots.put(storageKeys.get(index), index);
        }
        return slots;
    }

    private static List<String> activeKeys(
        IMultiStateCopycatBlock copycat,
        BlockState state,
        List<String> storageKeys
    ) {
        return storageKeys.stream().filter(key -> copycat.partExists(state, key)).toList();
    }

    private static int propertyDistance(BlockState left, BlockState right) {
        if (left.getBlock() != right.getBlock()) {
            throw new IllegalArgumentException("Cannot compare states from different blocks");
        }
        int distance = 0;
        for (Property<?> property : left.getProperties()) {
            if (!sameValue(left, right, property)) distance++;
        }
        return distance;
    }

    private static <T extends Comparable<T>> boolean sameValue(
        BlockState left,
        BlockState right,
        Property<T> property
    ) {
        return Objects.equals(left.getValue(property), right.getValue(property));
    }

    private static UnsupportedMultipartShape failure(
        String blockId,
        BlockState state,
        String reason
    ) {
        return new UnsupportedMultipartShape(
            "Fail-closed Copycats multipart extraction for " +
                blockId + ExtractionService.canonicalState(state) + ": " + reason
        );
    }

    private record Candidate(
        VoxelMask16 mask,
        List<int[]> boxes,
        int propertyDistance,
        String identity
    ) {}

    record Result(Status status, List<ExtractedPartGeometry> parts, String omissionReason) {
        static Result notMultipart() {
            return new Result(Status.NOT_MULTIPART, List.of(), "");
        }

        static Result supported(List<ExtractedPartGeometry> parts) {
            return new Result(Status.SUPPORTED, List.copyOf(parts), "");
        }

        static Result unsupported(String reason) {
            return new Result(Status.UNSUPPORTED, List.of(), reason);
        }
    }

    record ExtractedPartGeometry(List<int[]> boxes, String key, int materialSlot) {}

    enum Status {
        NOT_MULTIPART,
        SUPPORTED,
        UNSUPPORTED
    }

    private static final class UnsupportedMultipartShape extends IllegalStateException {
        private UnsupportedMultipartShape(String message) {
            super(message);
        }
    }
}
