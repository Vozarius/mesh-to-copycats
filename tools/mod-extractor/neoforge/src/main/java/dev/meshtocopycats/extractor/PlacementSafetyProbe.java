package dev.meshtocopycats.extractor;

import dev.meshtocopycats.extractor.CatalogDocument.PlacementNeighbor;
import dev.meshtocopycats.extractor.CatalogDocument.PlacementProbe;
import dev.meshtocopycats.extractor.CatalogDocument.PlacementSafety;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.EntityBlock;
import net.minecraft.world.level.block.state.BlockState;

final class PlacementSafetyProbe {
    private static final List<Direction> DIRECTIONS = List.of(
        Direction.DOWN,
        Direction.EAST,
        Direction.NORTH,
        Direction.SOUTH,
        Direction.UP,
        Direction.WEST
    );
    private static final String FINGERPRINT =
        "minecraft-1.21.1:canSurvive;reader=controlled-air;center=0,0,0;"
            + "contexts=empty,stone-down,stone-east,stone-north,stone-south,stone-up,stone-west;"
            + "block-fluid-entity-signal-reads=controlled;unknown-level-methods=fail-closed;"
            + "fixed-scalars=isClientSide:false,minHeight:-64,height:384,seaLevel:63;"
            + "world-mutation=none";

    private PlacementSafetyProbe() {}

    static Result assess(
        Block block,
        BlockState state
    ) {
        try {
            return new Result(
                assessControlled(block, state),
                null
            );
        } catch (RuntimeException error) {
            // Exception messages from third-party blocks can contain unstable data. The class is
            // deterministic enough for both the evidence fingerprint and exported diagnostic.
            String reason = "placement probe raised " + error.getClass().getName();
            return new Result(
                new PlacementSafety("UNEXTRACTED", null, List.of(), List.of()),
                reason
            );
        }
    }

    private static PlacementSafety assessControlled(
        Block block,
        BlockState state
    ) {
        List<String> flags = new ArrayList<>();
        if (block instanceof EntityBlock || state.hasBlockEntity()) {
            flags.add("REQUIRES_BLOCK_ENTITY_INITIALIZATION");
        }
        flags.add("PLACEMENT_CONTEXT_NOT_REPLAYED");
        flags.add("SET_BLOCK_NOT_EXECUTED");

        List<PlacementProbe> probes = new ArrayList<>(7);
        probes.add(probe("empty", List.of(), state));
        for (Direction direction : DIRECTIONS) {
            BlockPos offset = BlockPos.ZERO.relative(direction);
            probes.add(probe(
                "stone-" + direction.getName(),
                List.of(new PlacementNeighbor(
                    "minecraft:stone",
                    Map.of(),
                    new int[] {direction.getStepX(), direction.getStepY(), direction.getStepZ()}
                )),
                state
            ));
        }
        probes.sort(java.util.Comparator.comparing(PlacementProbe::context));
        boolean anySurvives = probes.stream().anyMatch(PlacementProbe::survives);
        boolean allSurvive = probes.stream().allMatch(PlacementProbe::survives);
        flags.sort(String::compareTo);
        String assessment = !anySurvives
            ? "UNSAFE"
            : !allSurvive || !flags.isEmpty() ? "CONDITIONAL" : "SAFE";
        return new PlacementSafety(
            assessment,
            FINGERPRINT,
            List.copyOf(flags),
            List.copyOf(probes)
        );
    }

    private static PlacementProbe probe(
        String context,
        List<PlacementNeighbor> neighbors,
        BlockState state
    ) {
        Map<BlockPos, BlockState> states = new LinkedHashMap<>();
        states.put(BlockPos.ZERO, state);
        for (PlacementNeighbor neighbor : neighbors) {
            int[] offset = neighbor.offset();
            states.put(
                new BlockPos(offset[0], offset[1], offset[2]),
                Blocks.STONE.defaultBlockState()
            );
        }
        boolean survives = state.canSurvive(
            ControlledLevelReader.create(states),
            BlockPos.ZERO
        );
        return new PlacementProbe(context, neighbors, survives);
    }

    record Result(PlacementSafety safety, String diagnosticReason) {
        boolean supported() {
            return diagnosticReason == null;
        }
    }
}
