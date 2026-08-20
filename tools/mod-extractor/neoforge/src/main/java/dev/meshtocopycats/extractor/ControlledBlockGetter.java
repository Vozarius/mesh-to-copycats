package dev.meshtocopycats.extractor;

import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.FluidState;

final class ControlledBlockGetter implements BlockGetter {
    private final Map<BlockPos, BlockState> states;

    ControlledBlockGetter(Map<BlockPos, BlockState> states) {
        this.states = Map.copyOf(states);
    }

    @Override
    public BlockEntity getBlockEntity(BlockPos position) {
        return null;
    }

    @Override
    public BlockState getBlockState(BlockPos position) {
        return states.getOrDefault(position, Blocks.AIR.defaultBlockState());
    }

    @Override
    public FluidState getFluidState(BlockPos position) {
        return getBlockState(position).getFluidState();
    }

    @Override
    public int getMinBuildHeight() {
        return -64;
    }

    @Override
    public int getHeight() {
        return 384;
    }
}
