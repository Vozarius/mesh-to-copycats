package dev.meshtocopycats.extractor;

import com.copycatsplus.copycats.foundation.copycat.ICopycatBlock;
import com.copycatsplus.copycats.foundation.copycat.multistate.IMultiStateCopycatBlock;
import com.simibubi.create.AllTags;
import com.simibubi.create.content.decoration.bracket.BracketBlock;
import com.simibubi.create.content.kinetics.simpleRelays.CogWheelBlock;
import com.simibubi.create.content.kinetics.simpleRelays.ShaftBlock;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.EntityBlock;
import net.minecraft.world.level.block.StairBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.phys.shapes.Shapes;

/**
 * A fail-closed reproduction of the material predicate loaded from the exact
 * Create 6.0.10 / Copycats+ 3.0.4 pins. No candidate block ever receives a
 * live {@link Level}; shape reads use a finite, immutable {@link ControlledBlockGetter}.
 */
final class VersionPinnedMaterialPredicate {
    static final String FINGERPRINT =
        "create-6.0.10+copycats-3.0.4:controlled-material-predicate-v1;"
            + "center=candidate-default;outside=air;block-entity=null;"
            + "overrides=reflection-owner-allowlist;unknown=unsupported";

    private static final Set<String> BASE_ACCEPTED_OWNERS = Set.of(
        "com.copycatsplus.copycats.foundation.copycat.ICopycatBlock",
        "com.simibubi.create.content.decoration.copycat.CopycatBlock",
        "com.copycatsplus.copycats.content.copycat.fluid_pipe.CopycatFluidPipeBlock",
        "com.copycatsplus.copycats.content.copycat.fluid_pipe.CopycatGlassFluidPipeBlock",
        "com.copycatsplus.copycats.content.copycat.shaft.CopycatShaftBlock",
        "com.copycatsplus.copycats.content.copycat.sliding_door.CopycatSlidingDoorBlock"
    );
    private static final Set<String> BRACKET_REJECTING_OWNERS = Set.of(
        "com.copycatsplus.copycats.content.copycat.fluid_pipe.CopycatFluidPipeBlock",
        "com.copycatsplus.copycats.content.copycat.fluid_pipe.CopycatGlassFluidPipeBlock",
        "com.copycatsplus.copycats.content.copycat.shaft.CopycatShaftBlock"
    );
    private static final String MULTIPART_BASE_OWNER =
        "com.copycatsplus.copycats.foundation.copycat.multistate.IMultiStateCopycatBlock";
    private static final String COGWHEEL_OWNER =
        "com.copycatsplus.copycats.content.copycat.cogwheel.CopycatCogWheelBlock";
    private static final Set<String> PURE_REGARDLESS_OWNERS = Set.of(
        "com.copycatsplus.copycats.foundation.copycat.ICopycatBlock",
        "com.simibubi.create.content.decoration.copycat.CopycatBlock",
        "com.simibubi.create.content.decoration.copycat.CopycatPanelBlock",
        "com.copycatsplus.copycats.content.copycat.button.CopycatButtonBlock",
        "com.copycatsplus.copycats.content.copycat.door.CopycatDoorBlock",
        "com.copycatsplus.copycats.content.copycat.fence.CopycatFenceBlock",
        "com.copycatsplus.copycats.content.copycat.fence_gate.CopycatFenceGateBlock",
        "com.copycatsplus.copycats.content.copycat.ladder.CopycatLadderBlock",
        "com.copycatsplus.copycats.content.copycat.pane.CopycatPaneBlock",
        "com.copycatsplus.copycats.content.copycat.pressure_plate.CopycatPressurePlateBlock",
        "com.copycatsplus.copycats.content.copycat.pressure_plate.CopycatWeightedPressurePlate",
        "com.copycatsplus.copycats.content.copycat.shaft.CopycatShaftBlock",
        "com.copycatsplus.copycats.content.copycat.trapdoor.CopycatTrapdoorBlock",
        "com.copycatsplus.copycats.content.copycat.wall.CopycatWallBlock"
    );

    private final ICopycatBlock copycat;
    private final String acceptedOwner;
    private final String regardlessOwner;
    private final String multipartOwner;

    private VersionPinnedMaterialPredicate(
        ICopycatBlock copycat,
        String acceptedOwner,
        String regardlessOwner,
        String multipartOwner
    ) {
        this.copycat = copycat;
        this.acceptedOwner = acceptedOwner;
        this.regardlessOwner = regardlessOwner;
        this.multipartOwner = multipartOwner;
    }

    static Validation validate(Block copycatBlock, String partKey) {
        if (!(copycatBlock instanceof ICopycatBlock copycat)) {
            return Validation.unsupported("not-an-icopycat-block");
        }
        try {
            String acceptedOwner = owner(copycatBlock.getClass().getMethod(
                "getAcceptedBlockState",
                Level.class,
                BlockPos.class,
                ItemStack.class,
                Direction.class
            ));
            if (!BASE_ACCEPTED_OWNERS.contains(acceptedOwner)) {
                return Validation.unsupported("unknown-accepted-owner=" + acceptedOwner);
            }

            String regardlessOwner = owner(copycatBlock.getClass().getMethod(
                "isAcceptedRegardless",
                BlockState.class
            ));
            if (!PURE_REGARDLESS_OWNERS.contains(regardlessOwner)) {
                return Validation.unsupported("unknown-regardless-owner=" + regardlessOwner);
            }

            String multipartOwner = "none";
            if (copycatBlock instanceof IMultiStateCopycatBlock) {
                if (partKey.isEmpty()) {
                    return Validation.unsupported("multipart-part-key-required");
                }
                multipartOwner = owner(copycatBlock.getClass().getMethod(
                    "getAcceptedBlockState",
                    String.class,
                    Level.class,
                    BlockPos.class,
                    ItemStack.class,
                    Direction.class
                ));
                if (
                    !MULTIPART_BASE_OWNER.equals(multipartOwner) &&
                    !COGWHEEL_OWNER.equals(multipartOwner)
                ) {
                    return Validation.unsupported(
                        "unknown-multipart-accepted-owner=" + multipartOwner
                    );
                }
            }
            return Validation.supported(new VersionPinnedMaterialPredicate(
                copycat,
                acceptedOwner,
                regardlessOwner,
                multipartOwner
            ));
        } catch (ReflectiveOperationException | SecurityException error) {
            return Validation.unsupported(
                "predicate-reflection-failed=" + error.getClass().getName()
            );
        }
    }

    BlockState evaluate(String partKey, ItemStack stack, Direction direction) {
        if (!(stack.getItem() instanceof BlockItem blockItem)) return null;
        Block material = blockItem.getBlock();

        if (COGWHEEL_OWNER.equals(multipartOwner)) {
            if (material instanceof BracketBlock) return null;
            if (material instanceof ShaftBlock && !(material instanceof ICopycatBlock)) {
                return "shaft".equals(partKey) ? material.defaultBlockState() : null;
            }
            if (
                material instanceof CogWheelBlock cogwheel &&
                !(material instanceof ICopycatBlock)
            ) {
                Block copycatBlock = (Block) copycat;
                boolean copycatIsLarge = ((CogWheelBlock) copycatBlock).isLargeCog();
                return "cogwheel".equals(partKey) && cogwheel.isLargeCog() == copycatIsLarge
                    ? material.defaultBlockState()
                    : null;
            }
        } else if (BRACKET_REJECTING_OWNERS.contains(acceptedOwner)) {
            if (material instanceof BracketBlock) return null;
        }

        return evaluateBase(material, direction);
    }

    String auditIdentity() {
        return "accepted-owner=" + acceptedOwner
            + ";regardless-owner=" + regardlessOwner
            + ";multipart-owner=" + multipartOwner;
    }

    private BlockState evaluateBase(Block material, Direction direction) {
        // Copycats' mixin widens Create's self-copy rejection from CopycatBlock to
        // every ICopycatBlock. Reproduce the transformed runtime semantics directly.
        if (material instanceof ICopycatBlock) return null;

        BlockState result = material.defaultBlockState();
        boolean acceptedRegardless = copycat.isAcceptedRegardless(result);
        if (
            !AllTags.AllBlockTags.COPYCAT_ALLOW.matches(material) &&
            !acceptedRegardless
        ) {
            if (
                AllTags.AllBlockTags.COPYCAT_DENY.matches(material) ||
                material instanceof EntityBlock ||
                material instanceof StairBlock
            ) {
                return null;
            }
            ControlledBlockGetter controlled = new ControlledBlockGetter(
                Map.of(BlockPos.ZERO, result)
            );
            var shape = result.getShape(controlled, BlockPos.ZERO);
            if (shape.isEmpty() || !shape.bounds().equals(Shapes.block().bounds())) {
                return null;
            }
            if (result.getCollisionShape(controlled, BlockPos.ZERO).isEmpty()) {
                return null;
            }
        }

        Direction.Axis axis = direction.getAxis();
        if (result.hasProperty(BlockStateProperties.FACING)) {
            result = result.setValue(BlockStateProperties.FACING, direction);
        }
        if (
            result.hasProperty(BlockStateProperties.HORIZONTAL_FACING) &&
            axis != Direction.Axis.Y
        ) {
            result = result.setValue(BlockStateProperties.HORIZONTAL_FACING, direction);
        }
        if (result.hasProperty(BlockStateProperties.AXIS)) {
            result = result.setValue(BlockStateProperties.AXIS, axis);
        }
        if (
            result.hasProperty(BlockStateProperties.HORIZONTAL_AXIS) &&
            axis != Direction.Axis.Y
        ) {
            result = result.setValue(BlockStateProperties.HORIZONTAL_AXIS, axis);
        }
        return result;
    }

    private static String owner(Method method) {
        return method.getDeclaringClass().getName();
    }

    record Validation(VersionPinnedMaterialPredicate predicate, String reason) {
        static Validation supported(VersionPinnedMaterialPredicate predicate) {
            return new Validation(predicate, null);
        }

        static Validation unsupported(String reason) {
            return new Validation(null, reason);
        }

        boolean supported() {
            return predicate != null;
        }
    }
}
