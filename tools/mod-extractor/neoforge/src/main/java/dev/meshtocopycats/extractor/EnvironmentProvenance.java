package dev.meshtocopycats.extractor;

import com.simibubi.create.AllTags;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.neoforged.fml.ModList;

/**
 * Produces a compact identity for runtime inputs which can change extraction without
 * changing the four required dependency pins. Values are sorted before hashing so the
 * result does not depend on mod loading or registry iteration order.
 */
final class EnvironmentProvenance {
    private static final String FORMAT = "m2c-environment-v1";

    private EnvironmentProvenance() {}

    static String fingerprint(ServerLevel level) {
        MessageDigest digest = sha256();
        update(digest, "format", FORMAT);

        List<String> mods = ModList.get().getMods().stream()
            .map(info -> info.getModId() + "\0" + info.getVersion())
            .sorted()
            .toList();
        for (String mod : mods) update(digest, "mod", mod);

        BuiltInRegistries.BLOCK.entrySet().stream()
            .map(entry -> new BlockIdentity(
                entry.getKey().location().toString(),
                AllTags.AllBlockTags.COPYCAT_ALLOW.matches(entry.getValue()),
                AllTags.AllBlockTags.COPYCAT_DENY.matches(entry.getValue())
            ))
            .sorted(Comparator.comparing(BlockIdentity::id))
            .forEach(block -> update(
                digest,
                "block",
                block.id(),
                block.copycatAllow() ? "allow=1" : "allow=0",
                block.copycatDeny() ? "deny=1" : "deny=0"
            ));

        BuiltInRegistries.ITEM.keySet().stream()
            .map(Object::toString)
            .sorted()
            .forEach(itemId -> update(digest, "item", itemId));

        level.getServer().getPackRepository().getSelectedIds().stream()
            .sorted()
            .forEach(packId -> update(digest, "datapack", packId));

        return FORMAT + ":sha256:" + HexFormat.of().formatHex(digest.digest());
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("The Java runtime has no SHA-256 provider", error);
        }
    }

    private static void update(MessageDigest digest, String... fields) {
        for (String field : fields) {
            byte[] encoded = field.getBytes(StandardCharsets.UTF_8);
            digest.update((byte) (encoded.length >>> 24));
            digest.update((byte) (encoded.length >>> 16));
            digest.update((byte) (encoded.length >>> 8));
            digest.update((byte) encoded.length);
            digest.update(encoded);
        }
    }

    private record BlockIdentity(String id, boolean copycatAllow, boolean copycatDeny) {}
}
