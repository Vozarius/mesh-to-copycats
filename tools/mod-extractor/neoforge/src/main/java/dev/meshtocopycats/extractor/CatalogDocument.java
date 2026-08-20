package dev.meshtocopycats.extractor;

import java.util.List;
import java.util.Map;

public record CatalogDocument(
    String schema,
    int version,
    Map<String, String> sources,
    List<MaterialCandidate> materialCandidates,
    List<MaterialAcceptanceProfile> materialAcceptanceProfiles,
    List<ExtractedShape> shapes,
    List<ExtractionDiagnostic> diagnostics
) {
    public static final String SCHEMA = "mesh-to-copycats.extracted-catalog";
    public static final int VERSION = 1;

    public record ExtractedShape(
        String blockId,
        Map<String, String> state,
        String family,
        int complexity,
        boolean neighborDependent,
        List<String> routeKeys,
        List<int[]> boxes,
        List<ExtractedPart> parts,
        NeighborDependencies neighborDependencies,
        PlacementSafety placementSafety
    ) {}

    public record ExtractedPart(
        List<int[]> boxes,
        String key,
        int materialSlot,
        String materialAcceptanceProfileId
    ) {}

    public record MaterialCandidate(
        String itemId,
        String materialBlockId
    ) {}

    public record MaterialAcceptanceProfile(
        String copycatBlockId,
        String partKey,
        String profileId,
        String fingerprint,
        String status,
        List<MaterialResult> results
    ) {}

    public record MaterialResult(
        String itemId,
        MaterialDirectionResults directions
    ) {}

    public record MaterialDirectionResults(
        AcceptedMaterial down,
        AcceptedMaterial east,
        AcceptedMaterial north,
        AcceptedMaterial south,
        AcceptedMaterial up,
        AcceptedMaterial west
    ) {}

    public record AcceptedMaterial(
        String blockId,
        Map<String, String> state
    ) {}

    public record NeighborDependencies(
        String status,
        String fingerprint,
        List<NeighborProbe> probes
    ) {}

    public record NeighborProbe(
        List<int[]> boxes,
        boolean changesShape,
        boolean changesState,
        String neighborBlockId,
        Map<String, String> neighborState,
        int[] offset,
        String resolvedBlockId,
        Map<String, String> resolvedState
    ) {}

    public record PlacementSafety(
        String assessment,
        String fingerprint,
        List<String> flags,
        List<PlacementProbe> probes
    ) {}

    public record PlacementProbe(
        String context,
        List<PlacementNeighbor> neighbors,
        boolean survives
    ) {}

    public record PlacementNeighbor(
        String blockId,
        Map<String, String> state,
        int[] offset
    ) {}

    public record ExtractionDiagnostic(
        String blockId,
        Map<String, String> state,
        String code,
        String reason
    ) {}
}
