package dev.meshtocopycats.extractor;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

final class ControlledLevelReader {
    private ControlledLevelReader() {}

    static LevelReader create(Map<BlockPos, BlockState> states) {
        Map<BlockPos, BlockState> snapshot = Map.copyOf(states);
        return (LevelReader) Proxy.newProxyInstance(
            ControlledLevelReader.class.getClassLoader(),
            new Class<?>[] {LevelReader.class},
            (proxy, method, arguments) -> {
                String name = method.getName();
                if (arguments != null && arguments.length >= 1 && arguments[0] instanceof BlockPos position) {
                    BlockState state = snapshot.getOrDefault(position, Blocks.AIR.defaultBlockState());
                    if (name.equals("getBlockState")) return state;
                    if (name.equals("getFluidState")) return state.getFluidState();
                    if (name.equals("getBlockEntity")) {
                        return method.getReturnType() == Optional.class ? Optional.empty() : null;
                    }
                    if (name.equals("isEmptyBlock")) return state.isAir();
                }
                if (name.equals("toString") && (arguments == null || arguments.length == 0)) {
                    return "ControlledLevelReader[states=" + snapshot.size() + "]";
                }
                if (name.equals("hashCode") && (arguments == null || arguments.length == 0)) {
                    return System.identityHashCode(proxy);
                }
                if (name.equals("equals") && arguments != null && arguments.length == 1) {
                    return proxy == arguments[0];
                }

                // Default LevelReader methods are safe to execute on the proxy: their block,
                // fluid, entity, and signal reads are routed back through this controlled
                // snapshot. Unknown abstract methods fail closed instead of consulting the
                // command world behind the context fingerprint.
                if (method.isDefault()) {
                    return InvocationHandler.invokeDefault(
                        proxy,
                        method,
                        arguments == null ? new Object[0] : arguments
                    );
                }

                if (name.equals("getEntityCollisions")) return List.of();

                // Fixed vanilla 1.21.1 scalar values are part of the placement-probe contract.
                // Registry, biome, dimension, feature, chunk, light-engine, and world-border
                // access fails closed because none of those live objects belongs to the snapshot.
                return switch (name) {
                    case "isClientSide" -> false;
                    case "getMinBuildHeight" -> -64;
                    case "getHeight" -> 384;
                    case "getSeaLevel" -> 63;
                    default -> throw new UnsupportedOperationException(
                        "Controlled placement probe rejected LevelReader method: "
                            + method.toGenericString()
                    );
                };
            }
        );
    }
}
