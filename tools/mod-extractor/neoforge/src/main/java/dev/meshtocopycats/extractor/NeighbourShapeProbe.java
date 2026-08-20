package dev.meshtocopycats.extractor;

import dev.meshtocopycats.extractor.CatalogDocument.NeighborDependencies;
import dev.meshtocopycats.extractor.CatalogDocument.NeighborProbe;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.CollisionContext;

final class NeighbourShapeProbe {
    private static final List<Direction> DIRECTIONS = List.of(
        Direction.DOWN,
        Direction.EAST,
        Direction.NORTH,
        Direction.SOUTH,
        Direction.UP,
        Direction.WEST
    );
    static final String FINGERPRINT =
        "minecraft-1.21.1:updateShape+getShape;accessor=controlled-air-fail-closed;"
            + "center=0,0,0;directions=down,east,north,south,up,west;"
            + "neighbors=air,same,minecraft:stone;scheduled-ticks=suppressed;"
            + "fixed-scalars=isClientSide:false,nextSubTickCount:0;"
            + "comparison=input-state+input-air-shape;"
            + "classification=conservative-neighbor-dependent;world-mutation=none";

    private NeighbourShapeProbe() {}

    static Result extract(BlockState state, String identity) {
        try {
            return extractControlled(state, identity);
        } catch (RuntimeException error) {
            return new Result(
                true,
                new NeighborDependencies(
                    "UNSUPPORTED",
                    FINGERPRINT + ";exception=" + error.getClass().getName(),
                    List.of()
                )
            );
        }
    }

    private static Result extractControlled(
        BlockState state,
        String identity
    ) {
        List<int[]> inputAirShape = boxes(
            state,
            new ControlledBlockGetter(Map.of(BlockPos.ZERO, state)),
            identity + "@input-air"
        );
        List<NeighborProbe> probes = new ArrayList<>(DIRECTIONS.size() * 3);
        for (Direction direction : DIRECTIONS) {
            Map<String, BlockState> distinctNeighbors = new LinkedHashMap<>();
            distinctNeighbors.put(
                stateIdentity(Blocks.AIR.defaultBlockState()),
                Blocks.AIR.defaultBlockState()
            );
            distinctNeighbors.put(stateIdentity(state), state);
            distinctNeighbors.put(
                stateIdentity(Blocks.STONE.defaultBlockState()),
                Blocks.STONE.defaultBlockState()
            );
            for (BlockState neighbor : distinctNeighbors.values()) {
                addProbe(
                    probes,
                    state,
                    identity,
                    inputAirShape,
                    direction,
                    neighbor
                );
            }
        }
        return new Result(
            // A finite air/same/stone sample is evidence, not a proof of independence for every
            // registered neighbour state. Keep the runtime classification conservative.
            true,
            new NeighborDependencies("SUPPORTED", FINGERPRINT, List.copyOf(probes))
        );
    }

    private static boolean addProbe(
        List<NeighborProbe> probes,
        BlockState center,
        String identity,
        List<int[]> inputAirShape,
        Direction direction,
        BlockState neighbor
    ) {
        BlockPos offset = BlockPos.ZERO.relative(direction);
        Map<BlockPos, BlockState> inputStates = new LinkedHashMap<>();
        inputStates.put(BlockPos.ZERO, center);
        inputStates.put(offset, neighbor);
        LevelAccessor accessor = ControlledLevelAccessor.create(inputStates);
        BlockState resolved = center.updateShape(
            direction,
            neighbor,
            accessor,
            BlockPos.ZERO,
            offset
        );

        Map<BlockPos, BlockState> resolvedStates = new LinkedHashMap<>(inputStates);
        resolvedStates.put(BlockPos.ZERO, resolved);
        List<int[]> result = boxes(
            resolved,
            new ControlledBlockGetter(resolvedStates),
            identity + "@updateShape:" + stateIdentity(neighbor) + ":" + direction.getName()
        );
        boolean changesShape = !ExactVoxelShape.equalBoxes(inputAirShape, result);
        boolean changesState = !center.equals(resolved);
        probes.add(new NeighborProbe(
            result,
            changesShape,
            changesState,
            BuiltInRegistries.BLOCK.getKey(neighbor.getBlock()).toString(),
            stateProperties(neighbor),
            new int[] {direction.getStepX(), direction.getStepY(), direction.getStepZ()},
            BuiltInRegistries.BLOCK.getKey(resolved.getBlock()).toString(),
            stateProperties(resolved)
        ));
        return changesShape || changesState;
    }

    private static List<int[]> boxes(
        BlockState state,
        ControlledBlockGetter getter,
        String identity
    ) {
        return ExactVoxelShape.boxes(
            state.getShape(getter, BlockPos.ZERO, CollisionContext.empty()),
            identity
        );
    }

    private static Map<String, String> stateProperties(BlockState state) {
        return ExtractionService.stateProperties(state);
    }

    private static String stateIdentity(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock()) +
            ExtractionService.canonicalState(state);
    }

    record Result(boolean dependent, NeighborDependencies evidence) {}
}
