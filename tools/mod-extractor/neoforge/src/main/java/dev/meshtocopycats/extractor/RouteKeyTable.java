package dev.meshtocopycats.extractor;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/** Builds the exact route vocabulary consumed by the TypeScript optimizer. */
final class RouteKeyTable {
    private static final List<String> BYTE_KEYS = List.of(
        "bottom_northwest",
        "bottom_northeast",
        "top_northwest",
        "top_northeast",
        "bottom_southwest",
        "bottom_southeast",
        "top_southwest",
        "top_southeast"
    );
    private static final List<String> BYTE_PANEL_KEYS = List.of(
        "bottom_left",
        "bottom_right",
        "top_left",
        "top_right"
    );
    private static final List<String> BOARD_KEYS = List.of(
        "down",
        "up",
        "north",
        "south",
        "west",
        "east"
    );

    private RouteKeyTable() {}

    static List<String> keysFor(
        String family,
        Map<String, String> state,
        List<int[]> boxes
    ) {
        LinkedHashSet<String> keys = new LinkedHashSet<>();
        VoxelMask16 mask = VoxelMask16.fromBoxes(boxes);
        if (mask.isEmpty()) keys.add("AIR");
        if (mask.isFull()) keys.add("FULL");

        switch (family) {
            case "AIR" -> keys.add("AIR");
            case "FULL_CUBE" -> keys.add("FULL");
            case "SLAB" -> add(keys, "SLAB", state, "axis", "type");
            case "STAIRS" -> add(keys, "STAIRS", state, "facing", "half", "shape");
            case "VERTICAL_STAIRS" -> add(
                keys,
                "VERTICAL_STAIRS",
                state,
                "facing",
                "side",
                "vertical_stair_shape"
            );
            case "LAYER" -> add(keys, "LAYER", state, "facing", "layers");
            case "HALF_LAYER" -> add(
                keys,
                "HALF_LAYER",
                state,
                "axis",
                "half",
                "negative_layers",
                "positive_layers"
            );
            case "SLICE" -> add(keys, "SLICE", state, "facing", "half", "layers");
            case "VERTICAL_SLICE" -> add(
                keys,
                "VERTICAL_SLICE",
                state,
                "facing",
                "layers"
            );
            case "CORNER_SLICE" -> add(
                keys,
                "CORNER_SLICE",
                state,
                "facing",
                "half",
                "layers"
            );
            case "BYTE" -> addBitMask(keys, "BYTE", state, BYTE_KEYS, null);
            case "BYTE_PANEL" -> addBitMask(
                keys,
                "BYTE_PANEL",
                state,
                BYTE_PANEL_KEYS,
                state.get("facing")
            );
            case "BOARD" -> addBitMask(keys, "BOARD", state, BOARD_KEYS, null);
            default -> {
                // GENERIC shapes are still covered by AIR/FULL anchors and the coarse index.
            }
        }
        return keys.stream().sorted().toList();
    }

    private static void add(
        LinkedHashSet<String> keys,
        String prefix,
        Map<String, String> state,
        String... propertyNames
    ) {
        List<String> values = new ArrayList<>(propertyNames.length);
        for (String propertyName : propertyNames) {
            String value = state.get(propertyName);
            if (value == null) return;
            values.add(value);
        }
        keys.add(prefix + ":" + String.join(":", values));
    }

    private static void addBitMask(
        LinkedHashSet<String> keys,
        String prefix,
        Map<String, String> state,
        List<String> propertyNames,
        String qualifier
    ) {
        int bits = 0;
        for (int bit = 0; bit < propertyNames.size(); bit++) {
            String value = state.get(propertyNames.get(bit));
            if (value == null) return;
            if (Boolean.parseBoolean(value)) bits |= 1 << bit;
        }
        if (bits == 0 || (qualifier != null && qualifier.isEmpty())) return;
        keys.add(
            qualifier == null
                ? prefix + ":" + bits
                : prefix + ":" + qualifier + ":" + bits
        );
    }
}
