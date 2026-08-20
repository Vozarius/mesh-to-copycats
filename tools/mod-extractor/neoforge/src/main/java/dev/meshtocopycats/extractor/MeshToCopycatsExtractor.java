package dev.meshtocopycats.extractor;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.nio.file.Path;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

@Mod(MeshToCopycatsExtractor.MOD_ID)
public final class MeshToCopycatsExtractor {
    public static final String MOD_ID = "mesh_to_copycats_extractor";

    public MeshToCopycatsExtractor(IEventBus modBus) {
        NeoForge.EVENT_BUS.addListener(this::registerCommands);
    }

    private void registerCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(
            Commands.literal("m2c_extract_catalog")
                .requires(source -> source.hasPermission(4))
                .executes(context -> runExtraction(context.getSource(), "m2c-extracted-catalog.json"))
                .then(Commands.argument("output", StringArgumentType.string())
                    .executes(context -> runExtraction(
                        context.getSource(),
                        StringArgumentType.getString(context, "output")
                    )))
        );
    }

    private int runExtraction(
        net.minecraft.commands.CommandSourceStack source,
        String outputName
    ) {
        try {
            Path gameDirectory = source.getServer().getServerDirectory();
            Path output = ExtractionService.safeOutputPath(gameDirectory, outputName);
            CatalogDocument catalog = ExtractionService.extract(output, source.getLevel());
            source.sendSuccess(
                () -> Component.literal(
                    "Extracted " + catalog.shapes().size() + " states (" +
                        catalog.diagnostics().size() + " omitted with diagnostics) to " + output
                ),
                false
            );
            return Command.SINGLE_SUCCESS;
        } catch (RuntimeException error) {
            source.sendFailure(Component.literal("Catalog extraction failed: " + error.getMessage()));
            return 0;
        }
    }
}
