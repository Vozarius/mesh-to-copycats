package dev.meshtocopycats.extractor;

import com.simibubi.create.AllDataComponents;
import com.simibubi.create.content.schematics.SchematicItem;
import com.simibubi.create.content.schematics.cannon.SchematicannonBlockEntity;
import com.simibubi.create.foundation.utility.CreatePaths;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Vec3i;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.neoforged.neoforge.items.ItemStackHandler;

/** Runs an exported structure through the real pinned Create Schematicannon lifecycle. */
final class SchematicannonVerificationService {
    private static final ResourceLocation CANNON_ID =
        ResourceLocation.fromNamespaceAndPath("create", "schematicannon");
    private static final String STAGING_OWNER = "m2c-runtime";
    private static final int MAX_BLOCKS = 4_096;
    private static final int MAX_MATERIAL_ITEMS = 65_536;
    private static final int MAX_TICKS = 8_192;

    private SchematicannonVerificationService() {}

    static VerificationResult verify(
        ServerLevel level,
        Path input,
        BlockPos cannonPosition,
        BlockPos targetOrigin
    ) {
        SchematicVerificationService.LoadedStructure loaded =
            SchematicVerificationService.read(input);
        SchematicVerificationService.ParsedStructure parsed = loaded.parsed();
        if (parsed.blocks().size() > MAX_BLOCKS) {
            throw new IllegalArgumentException("Schematicannon verification is limited to 4096 blocks");
        }
        ensurePositions(level, parsed, cannonPosition, targetOrigin);
        Map<String, Integer> expectedPartMaterials = expectedPartMaterials(parsed);
        boolean worldMutationAttempted = false;
        try (StagedSchematic staged = stage(input)) {
            worldMutationAttempted = true;
            Block cannonBlock = BuiltInRegistries.BLOCK.get(CANNON_ID);
            if (cannonBlock == Blocks.AIR) {
                throw new IllegalStateException("Pinned create:schematicannon block is unavailable");
            }
            if (!level.setBlock(cannonPosition, cannonBlock.defaultBlockState(), Block.UPDATE_ALL)) {
                throw new IllegalStateException("Could not place the verification Schematicannon");
            }
            if (!(level.getBlockEntity(cannonPosition) instanceof SchematicannonBlockEntity cannon)) {
                throw new IllegalStateException("Placed Schematicannon did not create its block entity");
            }

            ItemStack schematic = SchematicItem.create(level, staged.fileName(), STAGING_OWNER);
            Vec3i bounds = schematic.get(AllDataComponents.SCHEMATIC_BOUNDS);
            if (bounds == null || !bounds.equals(parsed.size())) {
                throw new IllegalStateException(
                    "Create loaded unexpected schematic bounds: expected " + parsed.size() + ", got " + bounds
                );
            }
            schematic.set(AllDataComponents.SCHEMATIC_ANCHOR, targetOrigin);
            schematic.set(AllDataComponents.SCHEMATIC_DEPLOYED, true);
            cannon.inventory.setStackInSlot(0, schematic);
            cannon.inventory.setStackInSlot(4, new ItemStack(Items.GUNPOWDER));
            cannon.state = SchematicannonBlockEntity.State.RUNNING;

            // The first real cannon tick loads the deployed schematic and computes its own checklist.
            cannon.tick();
            if (!cannon.printer.isLoaded() || cannon.printer.isErrored()) {
                throw new IllegalStateException("Schematicannon rejected the staged schematic: " + cannon.statusMsg);
            }
            if (!cannon.inventory.getStackInSlot(4).isEmpty() || cannon.remainingFuel <= 0) {
                throw new IllegalStateException("Schematicannon did not consume its gunpowder fuel");
            }
            if (!cannon.checklist.damageRequired.isEmpty()) {
                throw new IllegalArgumentException("Damage-based Schematicannon requirements are unsupported by this verifier");
            }

            List<MaterialRequirement> requirements = sortedRequirements(cannon);
            verifyExpectedPartMaterials(requirements, expectedPartMaterials);
            ItemStackHandler suppliedMaterials = supply(requirements);
            cannon.attachedInventories.add(suppliedMaterials);
            // Keep the controlled handler installed; normal neighbour discovery would replace it.
            cannon.neighbourCheckCooldown = Integer.MAX_VALUE;
            cannon.state = SchematicannonBlockEntity.State.RUNNING;

            int ticks = runUntilFinished(cannon);
            int remainingItems = countItems(suppliedMaterials);
            if (remainingItems != 0) {
                throw new IllegalStateException(
                    "Schematicannon left " + remainingItems + " checklist material items unconsumed"
                );
            }
            int blockEntities = SchematicVerificationService.verifyPlaced(
                level,
                targetOrigin,
                parsed.blocks()
            );
            return new VerificationResult(
                parsed.blocks().size(),
                blockEntities,
                requirements,
                requirements.stream().mapToInt(MaterialRequirement::count).sum(),
                expectedPartMaterials.values().stream().mapToInt(Integer::intValue).sum(),
                parsed.size(),
                ticks
            );
        } finally {
            if (worldMutationAttempted) {
                SchematicVerificationService.cleanup(level, targetOrigin, parsed.size());
                level.setBlock(cannonPosition, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL);
            }
        }
    }

    private static void ensurePositions(
        ServerLevel level,
        SchematicVerificationService.ParsedStructure parsed,
        BlockPos cannonPosition,
        BlockPos targetOrigin
    ) {
        if (!level.isLoaded(cannonPosition)) {
            throw new IllegalArgumentException("The Schematicannon position must already be loaded");
        }
        if (!level.getBlockState(cannonPosition).isAir() || level.getBlockEntity(cannonPosition) != null) {
            throw new IllegalArgumentException("The Schematicannon position must be empty");
        }
        if (!cannonPosition.closerThan(targetOrigin, 256.0)) {
            throw new IllegalArgumentException("The target must be within the pinned Schematicannon range");
        }
        for (SchematicVerificationService.ExpectedBlock block : parsed.blocks()) {
            if (cannonPosition.closerThan(targetOrigin.offset(block.relative()), 2.0)) {
                throw new IllegalArgumentException("Every target block must be at least two blocks from the cannon");
            }
        }
        BlockPos maximum = targetOrigin.offset(
            parsed.size().getX() - 1,
            parsed.size().getY() - 1,
            parsed.size().getZ() - 1
        );
        if (
            cannonPosition.getX() >= targetOrigin.getX() && cannonPosition.getX() <= maximum.getX() &&
            cannonPosition.getY() >= targetOrigin.getY() && cannonPosition.getY() <= maximum.getY() &&
            cannonPosition.getZ() >= targetOrigin.getZ() && cannonPosition.getZ() <= maximum.getZ()
        ) {
            throw new IllegalArgumentException("The Schematicannon cannot be inside the target volume");
        }
        SchematicVerificationService.ensureLoadedAndEmpty(level, targetOrigin, parsed.size());
    }

    private static List<MaterialRequirement> sortedRequirements(SchematicannonBlockEntity cannon) {
        List<MaterialRequirement> requirements = new ArrayList<>();
        for (Item item : cannon.checklist.required.keySet()) {
            int count = cannon.checklist.required.getInt(item);
            if (count <= 0) continue;
            requirements.add(new MaterialRequirement(BuiltInRegistries.ITEM.getKey(item).toString(), count));
        }
        requirements.sort(Comparator.comparing(MaterialRequirement::itemId));
        int total = requirements.stream().mapToInt(MaterialRequirement::count).sum();
        if (requirements.isEmpty() || total > MAX_MATERIAL_ITEMS) {
            throw new IllegalArgumentException("Checklist must contain 1..65536 material items");
        }
        return List.copyOf(requirements);
    }

    private static ItemStackHandler supply(List<MaterialRequirement> requirements) {
        List<ItemStack> stacks = new ArrayList<>();
        for (MaterialRequirement requirement : requirements) {
            ResourceLocation itemId = ResourceLocation.parse(requirement.itemId());
            Item item = BuiltInRegistries.ITEM.get(itemId);
            if (item == Items.AIR) throw new IllegalStateException("Checklist references unknown item " + itemId);
            int remaining = requirement.count();
            int stackLimit = new ItemStack(item).getMaxStackSize();
            while (remaining > 0) {
                int count = Math.min(remaining, stackLimit);
                stacks.add(new ItemStack(item, count));
                remaining -= count;
            }
        }
        ItemStackHandler inventory = new ItemStackHandler(stacks.size());
        for (int slot = 0; slot < stacks.size(); slot++) inventory.setStackInSlot(slot, stacks.get(slot));
        return inventory;
    }

    private static int runUntilFinished(SchematicannonBlockEntity cannon) {
        for (int tick = 1; tick <= MAX_TICKS; tick++) {
            cannon.tick();
            if (cannon.printer.isErrored()) {
                throw new IllegalStateException("Schematicannon printer errored: " + cannon.statusMsg);
            }
            if (cannon.positionNotLoaded) {
                throw new IllegalStateException("Schematicannon target became unloaded");
            }
            if (cannon.missingItem != null) {
                throw new IllegalStateException(
                    "Schematicannon reported missing item " +
                        BuiltInRegistries.ITEM.getKey(cannon.missingItem.getItem())
                );
            }
            if (
                cannon.state == SchematicannonBlockEntity.State.STOPPED &&
                "finished".equals(cannon.statusMsg) &&
                cannon.flyingBlocks.isEmpty()
            ) return tick;
        }
        throw new IllegalStateException("Schematicannon did not finish within 8192 controlled ticks");
    }

    private static int countItems(ItemStackHandler inventory) {
        int count = 0;
        for (int slot = 0; slot < inventory.getSlots(); slot++) {
            count += inventory.getStackInSlot(slot).getCount();
        }
        return count;
    }

    private static Map<String, Integer> expectedPartMaterials(
        SchematicVerificationService.ParsedStructure parsed
    ) {
        Map<String, Integer> expected = new LinkedHashMap<>();
        for (SchematicVerificationService.ExpectedBlock block : parsed.blocks()) {
            if (block.nbt() != null) collectConsumedItems(block.nbt(), expected);
        }
        return expected;
    }

    private static void collectConsumedItems(Tag tag, Map<String, Integer> expected) {
        if (tag instanceof CompoundTag compound) {
            if (compound.contains("consumedItem", Tag.TAG_COMPOUND)) {
                CompoundTag consumed = compound.getCompound("consumedItem");
                String itemId = consumed.getString("id");
                int count = consumed.contains("count", Tag.TAG_ANY_NUMERIC) ? consumed.getInt("count") : 1;
                if (!itemId.isEmpty() && count > 0) expected.merge(itemId, count, Integer::sum);
            }
            for (String key : compound.getAllKeys()) {
                if (!"consumedItem".equals(key)) collectConsumedItems(compound.get(key), expected);
            }
            return;
        }
        if (tag instanceof ListTag list) {
            for (Tag child : list) collectConsumedItems(child, expected);
        }
    }

    private static void verifyExpectedPartMaterials(
        List<MaterialRequirement> requirements,
        Map<String, Integer> expectedPartMaterials
    ) {
        if (expectedPartMaterials.isEmpty()) {
            throw new IllegalArgumentException(
                "The Schematicannon verifier requires at least one exported Copycats consumedItem"
            );
        }
        Map<String, Integer> checklist = new LinkedHashMap<>();
        for (MaterialRequirement requirement : requirements) {
            checklist.put(requirement.itemId(), requirement.count());
        }
        for (Map.Entry<String, Integer> expected : expectedPartMaterials.entrySet()) {
            if (checklist.getOrDefault(expected.getKey(), 0) < expected.getValue()) {
                throw new IllegalStateException(
                    "Schematicannon checklist lost Copycats material " + expected.getKey() +
                        ": expected at least " + expected.getValue() +
                        ", got " + checklist.getOrDefault(expected.getKey(), 0)
                );
            }
        }
    }

    private static StagedSchematic stage(Path input) {
        Path staged = null;
        try {
            Path expectedRoot = CreatePaths.UPLOADED_SCHEMATICS_DIR.toAbsolutePath().normalize();
            Files.createDirectories(expectedRoot);
            Path root = expectedRoot.toRealPath();
            if (!root.equals(expectedRoot) || Files.isSymbolicLink(expectedRoot)) {
                throw new IllegalArgumentException("Create uploaded schematics path must be a real directory");
            }
            Path expectedOwner = root.resolve(STAGING_OWNER).normalize();
            Files.createDirectories(expectedOwner);
            Path owner = expectedOwner.toRealPath();
            if (!owner.equals(expectedOwner) || Files.isSymbolicLink(expectedOwner)) {
                throw new IllegalArgumentException("Schematicannon staging owner must be a real directory");
            }
            staged = Files.createTempFile(owner, "m2c-", ".nbt");
            Files.copy(input, staged, StandardCopyOption.REPLACE_EXISTING);
            return new StagedSchematic(staged, staged.getFileName().toString());
        } catch (IOException error) {
            if (staged != null) {
                try {
                    Files.deleteIfExists(staged);
                } catch (IOException ignored) {
                    error.addSuppressed(ignored);
                }
            }
            throw new IllegalStateException("Could not stage the schematic for Create", error);
        }
    }

    record MaterialRequirement(String itemId, int count) {}
    record VerificationResult(
        int blocks,
        int blockEntities,
        List<MaterialRequirement> requirements,
        int consumedChecklistItems,
        int consumedCopycatsPartItems,
        BlockPos size,
        int ticks
    ) {}

    private record StagedSchematic(Path path, String fileName) implements AutoCloseable {
        @Override
        public void close() {
            try {
                Files.deleteIfExists(path);
            } catch (IOException error) {
                throw new IllegalStateException("Could not remove staged Create schematic", error);
            }
        }
    }
}
