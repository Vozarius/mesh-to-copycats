package dev.meshtocopycats.extractor;

import com.simibubi.create.AllTags;
import dev.meshtocopycats.extractor.CatalogDocument.AcceptedMaterial;
import dev.meshtocopycats.extractor.CatalogDocument.MaterialAcceptanceProfile;
import dev.meshtocopycats.extractor.CatalogDocument.MaterialCandidate;
import dev.meshtocopycats.extractor.CatalogDocument.MaterialDirectionResults;
import dev.meshtocopycats.extractor.CatalogDocument.MaterialResult;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Evaluates the version-pinned Copycats material predicate against every registered
 * {@link BlockItem}. The candidate universe and profiles deliberately use item registry
 * identities: two BlockItems for the same block are separate interaction inputs.
 */
final class MaterialAcceptanceProbe {
    private static final List<Direction> DIRECTIONS = List.of(
        Direction.DOWN,
        Direction.EAST,
        Direction.NORTH,
        Direction.SOUTH,
        Direction.UP,
        Direction.WEST
    );
    private static final String METHOD_FINGERPRINT =
        VersionPinnedMaterialPredicate.FINGERPRINT + ";"
            + "directions=down,east,north,south,up,west;stack=registered-item-default;"
            + "coverage=all-registered-block-items;sparse=omit-all-rejected";

    private MaterialAcceptanceProbe() {}

    static CandidateUniverse enumerateCandidates() {
        List<Candidate> candidates = BuiltInRegistries.ITEM.entrySet().stream()
            .filter(entry -> entry.getValue() instanceof BlockItem)
            .map(entry -> {
                String itemId = entry.getKey().location().toString();
                BlockItem item = (BlockItem) entry.getValue();
                String materialBlockId = registeredBlockId(item.getBlock(), itemId);
                return new Candidate(itemId, materialBlockId, item);
            })
            .sorted(Comparator.comparing(Candidate::itemId))
            .toList();

        Set<String> itemIds = new HashSet<>();
        for (Candidate candidate : candidates) {
            if (!itemIds.add(candidate.itemId())) {
                throw new IllegalStateException(
                    "ITEM registry contains duplicate identity " + candidate.itemId()
                );
            }
        }

        MessageDigest digest = sha256();
        List<MaterialCandidate> documentCandidates = new ArrayList<>(candidates.size());
        for (Candidate candidate : candidates) {
            documentCandidates.add(new MaterialCandidate(
                candidate.itemId(),
                candidate.materialBlockId()
            ));
            Block material = candidate.item().getBlock();
            update(digest, candidate.itemId());
            update(digest, candidate.materialBlockId());
            update(digest, Boolean.toString(AllTags.AllBlockTags.COPYCAT_ALLOW.matches(material)));
            update(digest, Boolean.toString(AllTags.AllBlockTags.COPYCAT_DENY.matches(material)));
        }
        String fingerprint = "count=" + candidates.size() + ";sha256="
            + HexFormat.of().formatHex(digest.digest());
        return new CandidateUniverse(
            List.copyOf(candidates),
            List.copyOf(documentCandidates),
            fingerprint
        );
    }

    static MaterialAcceptanceProfile extract(
        Block copycatBlock,
        String copycatBlockId,
        String partKey,
        CandidateUniverse universe
    ) {
        String profileId = profileId(copycatBlockId, partKey);
        String fingerprint = METHOD_FINGERPRINT + ";candidate-universe="
            + universe.fingerprint();
        VersionPinnedMaterialPredicate.Validation validation =
            VersionPinnedMaterialPredicate.validate(copycatBlock, partKey);
        if (!validation.supported()) {
            return unsupported(
                copycatBlockId,
                partKey,
                profileId,
                fingerprint + ";reason=" + validation.reason()
            );
        }
        VersionPinnedMaterialPredicate predicate = validation.predicate();
        fingerprint += ";" + predicate.auditIdentity();

        List<MaterialResult> acceptedResults = new ArrayList<>();
        for (Candidate candidate : universe.runtimeCandidates()) {
            List<AcceptedMaterial> directions = new ArrayList<>(DIRECTIONS.size());
            for (Direction direction : DIRECTIONS) {
                try {
                    BlockState result = predicate.evaluate(
                        partKey,
                        candidate.item().getDefaultInstance(),
                        direction
                    );
                    directions.add(result == null ? null : acceptedMaterial(result));
                } catch (RuntimeException error) {
                    return unsupported(
                        copycatBlockId,
                        partKey,
                        profileId,
                        fingerprint + ";exception-item=" + candidate.itemId()
                            + ";exception-direction=" + direction.getName()
                            + ";exception-class=" + error.getClass().getName()
                    );
                }
            }
            if (directions.stream().anyMatch(result -> result != null)) {
                acceptedResults.add(new MaterialResult(
                    candidate.itemId(),
                    new MaterialDirectionResults(
                        directions.get(0),
                        directions.get(1),
                        directions.get(2),
                        directions.get(3),
                        directions.get(4),
                        directions.get(5)
                    )
                ));
            }
        }
        return new MaterialAcceptanceProfile(
            copycatBlockId,
            partKey,
            profileId,
            fingerprint,
            "SUPPORTED",
            List.copyOf(acceptedResults)
        );
    }

    static String profileId(String copycatBlockId, String partKey) {
        return copycatBlockId + "#" + partKey;
    }

    private static MaterialAcceptanceProfile unsupported(
        String copycatBlockId,
        String partKey,
        String profileId,
        String fingerprint
    ) {
        return new MaterialAcceptanceProfile(
            copycatBlockId,
            partKey,
            profileId,
            fingerprint,
            "UNSUPPORTED",
            List.of()
        );
    }

    private static AcceptedMaterial acceptedMaterial(BlockState state) {
        Block block = state.getBlock();
        ResourceLocation blockId = BuiltInRegistries.BLOCK.getResourceKey(block)
            .orElseThrow(() -> new IllegalStateException(
                "Copycats accepted an unregistered result block " + block.getClass().getName()
            ))
            .location();
        return new AcceptedMaterial(
            blockId.toString(),
            ExtractionService.stateProperties(state)
        );
    }

    private static String registeredBlockId(Block block, String itemId) {
        return BuiltInRegistries.BLOCK.getResourceKey(block)
            .orElseThrow(() -> new IllegalStateException(
                "Registered BlockItem " + itemId + " points to an unregistered block "
                    + block.getClass().getName()
            ))
            .location()
            .toString();
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("The Java runtime has no SHA-256 provider", error);
        }
    }

    private static void update(MessageDigest digest, String value) {
        digest.update(value.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) 0);
    }

    record CandidateUniverse(
        List<Candidate> runtimeCandidates,
        List<MaterialCandidate> documentCandidates,
        String fingerprint
    ) {}

    private record Candidate(String itemId, String materialBlockId, BlockItem item) {}
}
