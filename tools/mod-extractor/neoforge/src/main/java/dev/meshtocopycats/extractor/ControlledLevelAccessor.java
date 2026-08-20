package dev.meshtocopycats.extractor;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.ticks.LevelTickAccess;
import net.minecraft.world.ticks.ScheduledTick;

/**
 * A deliberately small, fail-closed {@link LevelAccessor} used for update-shape probes.
 *
 * <p>Block/fluid/entity reads are served exclusively from the immutable snapshot. Tick
 * scheduling is explicitly absorbed because it cannot affect the synchronous return value of
 * {@code BlockState.updateShape}. Every other operation that could expose or mutate the command
 * world is rejected, making the enclosing probe UNSUPPORTED rather than silently consulting live
 * world state.</p>
 */
final class ControlledLevelAccessor {
    private static final LevelTickAccess<Object> NO_TICKS = new LevelTickAccess<>() {
        @Override
        public void schedule(ScheduledTick<Object> tick) {
            // updateShape commonly schedules fluid ticks. They are intentionally not replayed.
        }

        @Override
        public boolean hasScheduledTick(BlockPos position, Object value) {
            return false;
        }

        @Override
        public boolean willTickThisTick(BlockPos position, Object value) {
            return false;
        }

        @Override
        public int count() {
            return 0;
        }
    };

    private ControlledLevelAccessor() {}

    static LevelAccessor create(Map<BlockPos, BlockState> states) {
        Map<BlockPos, BlockState> snapshot = Map.copyOf(states);
        InvocationHandler handler = (proxy, method, arguments) -> {
            String name = method.getName();
            int argumentCount = arguments == null ? 0 : arguments.length;

            if (name.equals("toString") && argumentCount == 0) {
                return "ControlledLevelAccessor[states=" + snapshot.size() + "]";
            }
            if (name.equals("hashCode") && argumentCount == 0) {
                return System.identityHashCode(proxy);
            }
            if (name.equals("equals") && argumentCount == 1) {
                return proxy == arguments[0];
            }

            if (argumentCount >= 1 && arguments[0] instanceof BlockPos position) {
                BlockState state = snapshot.getOrDefault(
                    position.immutable(),
                    Blocks.AIR.defaultBlockState()
                );
                if (name.equals("getBlockState")) return state;
                if (name.equals("getFluidState")) return state.getFluidState();
                if (name.equals("getBlockEntity")) {
                    return method.getReturnType() == Optional.class ? Optional.empty() : null;
                }
                if (name.equals("isEmptyBlock")) return state.isAir();
                if (name.equals("isStateAtPosition") && argumentCount == 2) {
                    @SuppressWarnings("unchecked")
                    Predicate<BlockState> predicate = (Predicate<BlockState>) arguments[1];
                    return predicate.test(state);
                }
                if (name.equals("isFluidAtPosition") && argumentCount == 2) {
                    @SuppressWarnings("unchecked")
                    Predicate<FluidState> predicate = (Predicate<FluidState>) arguments[1];
                    return predicate.test(state.getFluidState());
                }
            }

            if (name.equals("scheduleTick")) {
                // Scheduling is an asynchronous side effect and cannot change updateShape's result.
                return null;
            }
            if (name.equals("getBlockTicks") || name.equals("getFluidTicks")) {
                return NO_TICKS;
            }

            // Entity collision queries see the same intentionally empty controlled environment.
            if (name.equals("getEntities") || name.equals("getEntityCollisions") || name.equals("players")) {
                return List.of();
            }

            // Only fixed scalars whose values are part of the probe contract are exposed. Live
            // level objects and environment-dependent values (server, level data, time, sky,
            // difficulty, dimension/registry objects, and build bounds) deliberately fail
            // closed: any of them could let updateShape observe state not represented here.
            return switch (name) {
                case "isClientSide" -> false;
                case "nextSubTickCount" -> 0L;
                default -> throw unsupported(method.toGenericString());
            };
        };
        return (LevelAccessor) Proxy.newProxyInstance(
            ControlledLevelAccessor.class.getClassLoader(),
            new Class<?>[] {LevelAccessor.class},
            handler
        );
    }

    private static UnsupportedOperationException unsupported(String method) {
        return new UnsupportedOperationException(
            "Controlled updateShape probe rejected LevelAccessor method: " + method
        );
    }
}
