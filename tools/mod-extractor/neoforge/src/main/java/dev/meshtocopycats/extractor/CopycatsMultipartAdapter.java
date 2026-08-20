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
