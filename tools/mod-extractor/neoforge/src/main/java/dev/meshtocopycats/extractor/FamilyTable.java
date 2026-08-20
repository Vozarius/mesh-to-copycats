package dev.meshtocopycats.extractor;

import java.util.Map;

final class FamilyTable {
    private static final Map<String, String> FAMILY_BY_BLOCK_ID = Map.ofEntries(
        Map.entry("minecraft:air", "AIR"),
        Map.entry("minecraft:cave_air", "AIR"),
        Map.entry("minecraft:void_air", "AIR"),
        Map.entry("copycats:copycat_block", "FULL_CUBE"),
        Map.entry("copycats:copycat_slab", "SLAB"),
        Map.entry("copycats:copycat_stairs", "STAIRS"),
        Map.entry("copycats:copycat_vertical_stairs", "VERTICAL_STAIRS"),
        Map.entry("copycats:copycat_layer", "LAYER"),
        Map.entry("copycats:copycat_half_layer", "HALF_LAYER"),
        Map.entry("copycats:copycat_slice", "SLICE"),
        Map.entry("copycats:copycat_vertical_slice", "VERTICAL_SLICE"),
        Map.entry("copycats:copycat_corner_slice", "CORNER_SLICE"),
        Map.entry("copycats:copycat_byte", "BYTE"),
        Map.entry("copycats:copycat_byte_panel", "BYTE_PANEL"),
        Map.entry("copycats:copycat_board", "BOARD")
    );

    private FamilyTable() {}

    static String familyFor(String blockId) {
        return FAMILY_BY_BLOCK_ID.getOrDefault(blockId, "GENERIC");
    }
}
