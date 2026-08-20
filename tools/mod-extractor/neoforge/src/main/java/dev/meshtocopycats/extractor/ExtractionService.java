package dev.meshtocopycats.extractor;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonSerializationContext;
import dev.meshtocopycats.extractor.CatalogDocument.ExtractionDiagnostic;
import dev.meshtocopycats.extractor.CatalogDocument.ExtractedPart;
import dev.meshtocopycats.extractor.CatalogDocument.ExtractedShape;
import dev.meshtocopycats.extractor.CatalogDocument.MaterialAcceptanceProfile;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.shapes.CollisionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class ExtractionService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ExtractionService.class);
    private static final int PROGRESS_INTERVAL_STATES = 500;
    private static final Gson JSON = new GsonBuilder()
        .disableHtmlEscaping()
        // Only rejected material directions need explicit nulls. A local adapter avoids
        // turning unrelated optional record fields (for example parts) into JSON nulls.
        .registerTypeAdapter(
            CatalogDocument.MaterialDirectionResults.class,
            (com.google.gson.JsonSerializer<CatalogDocument.MaterialDirectionResults>)
                ExtractionService::serializeMaterialDirections
        )
        .create();

    private ExtractionService() {}

    private static JsonObject serializeMaterialDirections(
        CatalogDocument.MaterialDirectionResults directions,
        java.lang.reflect.Type ignoredType,
        JsonSerializationContext context
    ) {
        JsonObject result = new JsonObject();
        result.add("down", context.serialize(directions.down()));
        result.add("east", context.serialize(directions.east()));
        result.add("north", context.serialize(directions.north()));
        result.add("south", context.serialize(directions.south()));
        result.add("up", context.serialize(directions.up()));
        result.add("west", context.serialize(directions.west()));
        return result;
    }

    static Path safeOutputPath(Path gameDirectory, String outputName) {
        try {
            Path gameRoot = gameDirectory.toRealPath();
            Path expectedOutputRoot = gameRoot.resolve("m2c-extractor").normalize();
            Files.createDirectories(expectedOutputRoot);
            Path outputRoot = expectedOutputRoot.toRealPath();
            if (!outputRoot.equals(expectedOutputRoot) || Files.isSymbolicLink(expectedOutputRoot)) {
                throw new IllegalArgumentException(
                    "m2c-extractor must be a real directory, not a link or junction"
                );
            }

            Path output = outputRoot.resolve(outputName).normalize().toAbsolutePath();
            if (
                !output.startsWith(outputRoot) ||
                output.equals(outputRoot) ||
                !output.getParent().equals(outputRoot)
            ) {
                throw new IllegalArgumentException(
                    "Output must be a file directly inside the m2c-extractor directory"
                );
            }
            Path realParent = output.getParent().toRealPath();
            if (!realParent.equals(output.getParent()) || !realParent.startsWith(outputRoot)) {
                throw new IllegalArgumentException(
                    "Output parent must not traverse a link or junction"
                );
            }
            if (
                Files.exists(output, LinkOption.NOFOLLOW_LINKS) &&
                Files.isSymbolicLink(output)
            ) {
                throw new IllegalArgumentException("Output file must not be a symbolic link");
            }
            return output;
        } catch (IOException error) {
            throw new IllegalStateException("Could not prepare the extractor output directory", error);
        }
    }

    static CatalogDocument extract(Path output, ServerLevel level) {
        // Validate exact runtime pins before invoking any version-sensitive upstream APIs.
        Map<String, String> sources = pinnedSources();
        sources.put("environment", EnvironmentProvenance.fingerprint(level));
        MaterialAcceptanceProbe.CandidateUniverse materialCandidates =
            MaterialAcceptanceProbe.enumerateCandidates();
        List<Block> blocks = BuiltInRegistries.BLOCK.stream()
            .sorted(Comparator.comparing(block -> BuiltInRegistries.BLOCK.getKey(block).toString()))
            .toList();
        int totalStates = blocks.stream()
            .mapToInt(block -> block.getStateDefinition().getPossibleStates().size())
            .sum();
        long extractionStarted = System.nanoTime();
        LOGGER.info(
            "Starting catalog extraction: {} blocks, {} states, {} material candidates",
            blocks.size(),
            totalStates,
            materialCandidates.runtimeCandidates().size()
        );
        List<ExtractedShape> shapes = new ArrayList<>();
        List<ExtractionDiagnostic> diagnostics = new ArrayList<>();
        Map<String, MaterialAcceptanceProfile> materialAcceptanceProfiles = new LinkedHashMap<>();
        int processedStates = 0;
        for (Block block : blocks) {
            String blockId = BuiltInRegistries.BLOCK.getKey(block).toString();
            List<BlockState> states = block.getStateDefinition().getPossibleStates().stream()
                .sorted(Comparator.comparing(ExtractionService::canonicalState))
                .toList();
            for (BlockState state : states) {
                processedStates++;
                if (processedStates % PROGRESS_INTERVAL_STATES == 0) {
                    LOGGER.info(
                        "Catalog extraction progress: {}/{} states; current block {}; {} profiles",
                        processedStates,
                        totalStates,
                        blockId,
                        materialAcceptanceProfiles.size()
                    );
                }
                String stateIdentity = blockId + canonicalState(state);
                Map<String, String> properties = stateProperties(state);
                String family = FamilyTable.familyFor(blockId);
                List<int[]> boxes;
                try {
                    boxes = ExactVoxelShape.boxes(
                        state.getShape(
                            new ControlledBlockGetter(Map.of(BlockPos.ZERO, state)),
                            BlockPos.ZERO,
                            CollisionContext.empty()
                        ),
                        stateIdentity
                    );
                } catch (RuntimeException error) {
                    diagnostics.add(new ExtractionDiagnostic(
                        blockId,
                        properties,
                        "GEOMETRY_UNSUPPORTED",
                        diagnosticReason(error)
                    ));
                    continue;
                }
                NeighbourShapeProbe.Result neighbor = NeighbourShapeProbe.extract(
                    state,
                    stateIdentity
                );
                var parts = CopycatsMultipartAdapter.extract(
                    blockId,
                    block,
                    state,
                    states,
                    boxes
                );
                if (parts.status() == CopycatsMultipartAdapter.Status.UNSUPPORTED) {
                    diagnostics.add(new ExtractionDiagnostic(
                        blockId,
                        properties,
                        "COPYCATS_MULTIPART_UNSUPPORTED",
                        parts.omissionReason()
                    ));
                    continue;
                }
                List<ExtractedPart> extractedParts;
                if (parts.status() == CopycatsMultipartAdapter.Status.SUPPORTED) {
                    extractedParts = parts.parts().stream().map(part -> new ExtractedPart(
                        part.boxes(),
                        part.key(),
                        part.materialSlot(),
                        materialAcceptanceProfileId(
                            materialAcceptanceProfiles,
                            materialCandidates,
                            blockId,
                            block,
                            part.key()
                        )
                    )).toList();
                } else if (
                    block instanceof com.copycatsplus.copycats.foundation.copycat.ICopycatBlock &&
                    !boxes.isEmpty()
                ) {
                    extractedParts = List.of(new ExtractedPart(
                        boxes,
                        "material",
                        0,
                        materialAcceptanceProfileId(
                            materialAcceptanceProfiles,
                            materialCandidates,
                            blockId,
                            block,
                            "material"
                        )
                    ));
                } else {
                    extractedParts = null;
                }
                PlacementSafetyProbe.Result placement = PlacementSafetyProbe.assess(
                    block,
                    state
                );
                if (!placement.supported()) {
                    diagnostics.add(new ExtractionDiagnostic(
                        blockId,
                        properties,
                        "PLACEMENT_PROBE_UNSUPPORTED",
                        placement.diagnosticReason()
                    ));
                }
                shapes.add(new ExtractedShape(
                    blockId,
                    properties,
                    family,
                    boxes.size(),
                    neighbor.dependent(),
                    RouteKeyTable.keysFor(family, properties, boxes),
                    boxes,
                    extractedParts,
                    neighbor.evidence(),
                    placement.safety()
                ));
            }
        }
        LOGGER.info(
            "Catalog extraction computed {} shapes, {} diagnostics and {} profiles in {} ms; writing {}",
            shapes.size(),
            diagnostics.size(),
            materialAcceptanceProfiles.size(),
            elapsedMillis(extractionStarted),
            output
        );
        CatalogDocument document = new CatalogDocument(
            CatalogDocument.SCHEMA,
            CatalogDocument.VERSION,
            sources,
            materialCandidates.documentCandidates(),
            materialAcceptanceProfiles.values().stream()
                .sorted(Comparator.comparing(MaterialAcceptanceProfile::profileId))
                .toList(),
            List.copyOf(shapes),
            List.copyOf(diagnostics)
        );
        write(document, output);
        LOGGER.info("Catalog extraction finished in {} ms", elapsedMillis(extractionStarted));
        return document;
    }

    private static String materialAcceptanceProfileId(
        Map<String, MaterialAcceptanceProfile> profiles,
        MaterialAcceptanceProbe.CandidateUniverse candidates,
        String blockId,
        Block block,
        String partKey
    ) {
        String profileId = MaterialAcceptanceProbe.profileId(blockId, partKey);
        if (!profiles.containsKey(profileId)) {
            long profileStarted = System.nanoTime();
            LOGGER.info("Extracting material profile {}", profileId);
            MaterialAcceptanceProfile profile = MaterialAcceptanceProbe.extract(
                block,
                blockId,
                partKey,
                candidates
            );
            profiles.put(profileId, profile);
            LOGGER.info(
                "Extracted material profile {} ({}, {} accepted items) in {} ms",
                profileId,
                profile.status(),
                profile.results().size(),
                elapsedMillis(profileStarted)
            );
        }
        return profileId;
    }

    private static long elapsedMillis(long started) {
        return (System.nanoTime() - started) / 1_000_000L;
    }

    private static String diagnosticReason(RuntimeException error) {
        String message = error.getMessage();
        return message == null || message.isEmpty()
            ? error.getClass().getName()
            : error.getClass().getName() + ": " + message;
    }

    private static Map<String, String> pinnedSources() {
        Map<String, String> sources = new LinkedHashMap<>();
        sources.put("minecraft", loadedVersion("minecraft", "1.21.1"));
        sources.put("loader", "neoforge-" + loadedVersion("neoforge", "21.1.219"));
        sources.put("create", loadedVersion("create", "6.0.10"));
        sources.put("copycats", loadedVersion(
            "copycats",
            "3.0.4+mc.1.21.1-neoforge"
        ));
        sources.put("extractor", loadedVersion(
            MeshToCopycatsExtractor.MOD_ID,
            "0.2.0"
        ));
        return sources;
    }

    private static String loadedVersion(String modId, String expected) {
        var container = net.neoforged.fml.ModList.get().getModContainerById(modId)
            .orElseThrow(() -> new IllegalStateException(
                "Required loaded mod is absent: " + modId
            ));
        String actual = container.getModInfo().getVersion().toString();
        if (!expected.equals(actual)) {
            throw new IllegalStateException(
                "Extractor source pin mismatch for " + modId + ": expected "
                    + expected + ", loaded " + actual
            );
        }
        return actual;
    }

    static String canonicalState(BlockState state) {
        Map<String, String> properties = stateProperties(state);
        if (properties.isEmpty()) return "";
        return properties.entrySet().stream()
            .map(entry -> entry.getKey() + "=" + entry.getValue())
            .reduce((left, right) -> left + "," + right)
            .map(serialized -> "[" + serialized + "]")
            .orElse("");
    }

    static Map<String, String> stateProperties(BlockState state) {
        Map<String, String> result = new LinkedHashMap<>();
        state.getValues().entrySet().stream()
            .sorted(Comparator.comparing(entry -> entry.getKey().getName()))
            .forEach(entry -> result.put(
                entry.getKey().getName(),
                propertyValueName(entry.getKey(), entry.getValue())
            ));
        return result;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static String propertyValueName(Property property, Comparable value) {
        return property.getName(value);
    }

    private static void write(CatalogDocument document, Path output) {
        Path temporary = null;
        try {
            Path expectedParent = output.getParent().toAbsolutePath().normalize();
            Path realParent = expectedParent.toRealPath();
            if (!realParent.equals(expectedParent)) {
                throw new IllegalArgumentException(
                    "Output parent became a link or junction before writing"
                );
            }
            if (
                Files.exists(output, LinkOption.NOFOLLOW_LINKS) &&
                Files.isSymbolicLink(output)
            ) {
                throw new IllegalArgumentException("Output file became a symbolic link");
            }
            temporary = Files.createTempFile(
                realParent,
                "." + output.getFileName() + ".",
                ".tmp"
            );
            try (Writer writer = Files.newBufferedWriter(
                temporary,
                StandardCharsets.UTF_8,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE
            )) {
                JSON.toJson(document, writer);
                writer.write('\n');
            }
            try {
                Files.move(
                    temporary,
                    output,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
                );
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING);
            }
            temporary = null;
        } catch (IOException error) {
            throw new IllegalStateException("Could not write extracted catalog to " + output, error);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // Preserve the original extraction failure. The unique temp name cannot
                    // replace the requested output and is safe to remove manually.
                }
            }
        }
    }
}
