package dev.meshtocopycats.extractor;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.structure.templatesystem.LiquidSettings;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructurePlaceSettings;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;

/** Places an exported structure into a known-empty loaded region and removes it after verification. */
final class SchematicVerificationService {
    private static final long MAX_COMPRESSED_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_NBT_BYTES = 128L * 1024L * 1024L;
    private static final int MAX_AXIS = 512;
    private static final int MAX_VOLUME = 1_048_576;
    private static final List<String> MATERIAL_KEYS = List.of(
        "id", "material_data", "Material", "Item", "EnableCT"
    );

    private SchematicVerificationService() {}

    static Path safeInputPath(Path gameDirectory, String inputName) {
        try {
            Path gameRoot = gameDirectory.toRealPath();
            Path expectedRoot = gameRoot.resolve("m2c-extractor").normalize();
            Files.createDirectories(expectedRoot);
            Path root = expectedRoot.toRealPath();
            if (!root.equals(expectedRoot) || Files.isSymbolicLink(expectedRoot)) {
                throw new IllegalArgumentException("m2c-extractor must be a real directory");
            }
            Path input = root.resolve(inputName).normalize().toAbsolutePath();
            if (
                !inputName.endsWith(".nbt") || !input.startsWith(root) || input.equals(root) ||
                !input.getParent().equals(root) || Files.isSymbolicLink(input)
            ) {
                throw new IllegalArgumentException(
                    "Input must be a direct, non-linked .nbt file inside m2c-extractor"
                );
            }
            Path real = input.toRealPath(LinkOption.NOFOLLOW_LINKS);
            if (!real.equals(input) || !Files.isRegularFile(real, LinkOption.NOFOLLOW_LINKS)) {
                throw new IllegalArgumentException("Input must be a real regular file");
            }
            long size = Files.size(real);
            if (size < 1 || size > MAX_COMPRESSED_BYTES) {
                throw new IllegalArgumentException("Compressed NBT must be in 1..67108864 bytes");
            }
            return real;
        } catch (IOException error) {
            throw new IllegalStateException("Could not validate schematic input", error);
        }
    }

    static VerificationResult verify(ServerLevel level, Path input, BlockPos origin) {
        LoadedStructure loaded = read(input);
        ParsedStructure parsed = loaded.parsed();
        ensureLoadedAndEmpty(level, origin, parsed.size());
        StructureTemplate template = level.getStructureManager().readStructure(loaded.root().copy());
        StructurePlaceSettings settings = new StructurePlaceSettings()
            .setIgnoreEntities(true)
            .setKnownShape(false)
            .setLiquidSettings(LiquidSettings.IGNORE_WATERLOGGING);
        boolean placementAttempted = false;
        try {
            placementAttempted = true;
            boolean placed = template.placeInWorld(
                level,
                origin,
                origin,
                settings,
                RandomSource.create(0x6d2b79f5L),
                Block.UPDATE_ALL
            );
            if (!placed) throw new IllegalStateException("StructureTemplate refused to place the structure");
            int blockEntities = verifyPlaced(level, origin, parsed.blocks());
            return new VerificationResult(parsed.blocks().size(), blockEntities, parsed.size());
        } finally {
            if (placementAttempted) cleanup(level, origin, parsed.size());
        }
    }

    static LoadedStructure read(Path input) {
        try {
            CompoundTag root = NbtIo.readCompressed(input, NbtAccounter.create(MAX_NBT_BYTES));
            return new LoadedStructure(root, parse(root));
        } catch (IOException error) {
            throw new IllegalStateException("Could not read compressed structure NBT", error);
        }
    }

    static void ensureLoadedAndEmpty(ServerLevel level, BlockPos origin, BlockPos size) {
        BlockPos maximum = origin.offset(size.getX() - 1, size.getY() - 1, size.getZ() - 1);
        if (!level.hasChunksAt(origin, maximum)) {
            throw new IllegalArgumentException("Every chunk in the verification region must already be loaded");
        }
        forEachPosition(origin, size, position -> {
            if (!level.getBlockState(position).isAir() || level.getBlockEntity(position) != null) {
                throw new IllegalArgumentException("Verification region is not empty at " + position.toShortString());
            }
        });
    }

    static void cleanup(ServerLevel level, BlockPos origin, BlockPos size) {
        forEachPosition(origin, size, position ->
            level.setBlock(position, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL));
    }

    static ParsedStructure parse(CompoundTag root) {
        ListTag sizeTag = root.getList("size", Tag.TAG_INT);
        if (sizeTag.size() != 3) throw new IllegalArgumentException("Structure size must contain three integers");
        BlockPos size = new BlockPos(sizeTag.getInt(0), sizeTag.getInt(1), sizeTag.getInt(2));
        long volume = (long) size.getX() * size.getY() * size.getZ();
        if (
            size.getX() < 1 || size.getY() < 1 || size.getZ() < 1 ||
            size.getX() > MAX_AXIS || size.getY() > MAX_AXIS || size.getZ() > MAX_AXIS ||
            volume > MAX_VOLUME
        ) {
            throw new IllegalArgumentException("Structure dimensions exceed the 512-axis / 1048576-volume limit");
        }
        ListTag paletteTag = root.getList("palette", Tag.TAG_COMPOUND);
        if (paletteTag.isEmpty()) throw new IllegalArgumentException("Structure palette is empty");
        List<BlockState> palette = new ArrayList<>(paletteTag.size());
        for (int index = 0; index < paletteTag.size(); index++) {
            palette.add(NbtUtils.readBlockState(BuiltInRegistries.BLOCK.asLookup(), paletteTag.getCompound(index)));
        }
        ListTag blockTags = root.getList("blocks", Tag.TAG_COMPOUND);
        if (blockTags.isEmpty() || blockTags.size() > MAX_VOLUME) {
            throw new IllegalArgumentException("Structure block list is empty or too large");
        }
        List<ExpectedBlock> blocks = new ArrayList<>(blockTags.size());
        Set<BlockPos> occupied = new HashSet<>();
        for (int index = 0; index < blockTags.size(); index++) {
            CompoundTag blockTag = blockTags.getCompound(index);
            ListTag positionTag = blockTag.getList("pos", Tag.TAG_INT);
            if (positionTag.size() != 3) throw new IllegalArgumentException("Block position must contain three integers");
            BlockPos relative = new BlockPos(positionTag.getInt(0), positionTag.getInt(1), positionTag.getInt(2));
            if (
                relative.getX() < 0 || relative.getY() < 0 || relative.getZ() < 0 ||
                relative.getX() >= size.getX() || relative.getY() >= size.getY() || relative.getZ() >= size.getZ() ||
                !occupied.add(relative)
            ) {
                throw new IllegalArgumentException("Block position is out of bounds or duplicated: " + relative.toShortString());
            }
            int state = blockTag.getInt("state");
            if (state < 0 || state >= palette.size()) throw new IllegalArgumentException("Block palette index is out of range");
            blocks.add(new ExpectedBlock(
                relative,
                palette.get(state),
                blockTag.contains("nbt", Tag.TAG_COMPOUND) ? blockTag.getCompound("nbt").copy() : null
            ));
        }
        return new ParsedStructure(size, List.copyOf(blocks));
    }

    static int verifyPlaced(ServerLevel level, BlockPos origin, List<ExpectedBlock> blocks) {
        int blockEntities = 0;
        for (ExpectedBlock expected : blocks) {
            BlockPos position = origin.offset(expected.relative());
            BlockState actualState = level.getBlockState(position);
            if (!actualState.equals(expected.state())) {
                throw new IllegalStateException(
                    "Placed state changed at " + position.toShortString() + ": expected " +
                        expected.state() + ", got " + actualState
                );
            }
            BlockEntity actualEntity = level.getBlockEntity(position);
            if (expected.nbt() == null) {
                if (actualEntity != null) {
                    throw new IllegalStateException("Unexpected block entity at " + position.toShortString());
                }
                continue;
            }
            if (actualEntity == null) throw new IllegalStateException("Missing block entity at " + position.toShortString());
            blockEntities++;
            CompoundTag actualNbt = actualEntity.saveWithFullMetadata(level.registryAccess());
            for (String key : MATERIAL_KEYS) {
                if (
                    expected.nbt().contains(key) &&
                    !matchesExpected(expected.nbt().get(key), actualNbt.get(key))
                ) {
                    throw new IllegalStateException(
                        "Block entity field " + key + " changed at " + position.toShortString() +
                            ": expected " + expected.nbt().get(key) + ", got " + actualNbt.get(key)
                    );
                }
            }
        }
        return blockEntities;
    }

    /**
     * Copycats expands sparse multipart material_data with defaults for inactive slots.
     * Every value written by the exporter must survive, while additional canonical defaults are allowed.
     */
    private static boolean matchesExpected(Tag expected, Tag actual) {
        if (expected instanceof CompoundTag expectedCompound) {
            if (!(actual instanceof CompoundTag actualCompound)) return false;
            for (String key : expectedCompound.getAllKeys()) {
                if (
                    !actualCompound.contains(key) ||
                    !matchesExpected(expectedCompound.get(key), actualCompound.get(key))
                ) return false;
            }
            return true;
        }
        return expected.equals(actual);
    }

    private static void forEachPosition(BlockPos origin, BlockPos size, PositionAction action) {
        for (int y = 0; y < size.getY(); y++) {
            for (int z = 0; z < size.getZ(); z++) {
                for (int x = 0; x < size.getX(); x++) action.accept(origin.offset(x, y, z));
            }
        }
    }

    record VerificationResult(int blocks, int blockEntities, BlockPos size) {}
    record LoadedStructure(CompoundTag root, ParsedStructure parsed) {}
    record ParsedStructure(BlockPos size, List<ExpectedBlock> blocks) {}
    record ExpectedBlock(BlockPos relative, BlockState state, CompoundTag nbt) {}
    @FunctionalInterface
    private interface PositionAction { void accept(BlockPos position); }
}
