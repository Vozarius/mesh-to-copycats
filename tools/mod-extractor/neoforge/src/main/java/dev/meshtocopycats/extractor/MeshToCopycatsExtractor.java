package dev.meshtocopycats.extractor;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.nio.file.Path;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.BlockPos;
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
        event.getDispatcher().register(
            Commands.literal("m2c_verify_schematic")
                .requires(source -> source.hasPermission(4))
                .then(Commands.argument("input", StringArgumentType.string())
                    .then(Commands.argument("position", BlockPosArgument.blockPos())
                        .executes(context -> runSchematicVerification(
                            context.getSource(),
                            StringArgumentType.getString(context, "input"),
                            BlockPosArgument.getLoadedBlockPos(context, "position")
                        ))))
        );
        event.getDispatcher().register(
            Commands.literal("m2c_verify_schematicannon")
                .requires(source -> source.hasPermission(4))
                .then(Commands.argument("input", StringArgumentType.string())
                    .then(Commands.argument("cannonPosition", BlockPosArgument.blockPos())
                        .then(Commands.argument("targetPosition", BlockPosArgument.blockPos())
                            .executes(context -> runSchematicannonVerification(
                                context.getSource(),
                                StringArgumentType.getString(context, "input"),
                                BlockPosArgument.getLoadedBlockPos(context, "cannonPosition"),
                                BlockPosArgument.getLoadedBlockPos(context, "targetPosition")
                            )))))
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

    private int runSchematicVerification(
        net.minecraft.commands.CommandSourceStack source,
        String inputName,
        BlockPos origin
    ) {
        try {
            Path gameDirectory = source.getServer().getServerDirectory();
            Path input = SchematicVerificationService.safeInputPath(gameDirectory, inputName);
            SchematicVerificationService.VerificationResult result =
                SchematicVerificationService.verify(source.getLevel(), input, origin);
            source.sendSuccess(
                () -> Component.literal(
                    "Verified and cleaned " + result.blocks() + " blocks / " +
                        result.blockEntities() + " block entities at " + origin.toShortString() +
                        " (size " + result.size().toShortString() + ")"
                ),
                true
            );
            return Command.SINGLE_SUCCESS;
        } catch (RuntimeException error) {
            source.sendFailure(Component.literal("Schematic verification failed: " + error.getMessage()));
            return 0;
        }
    }

    private int runSchematicannonVerification(
        net.minecraft.commands.CommandSourceStack source,
        String inputName,
        BlockPos cannonPosition,
        BlockPos targetPosition
    ) {
        try {
            Path gameDirectory = source.getServer().getServerDirectory();
            Path input = SchematicVerificationService.safeInputPath(gameDirectory, inputName);
            SchematicannonVerificationService.VerificationResult result =
                SchematicannonVerificationService.verify(
                    source.getLevel(),
                    input,
                    cannonPosition,
                    targetPosition
                );
            String requirements = result.requirements().stream()
                .map(requirement -> requirement.itemId() + "×" + requirement.count())
                .reduce((left, right) -> left + ", " + right)
                .orElse("none");
            source.sendSuccess(
                () -> Component.literal(
                    "Schematicannon verified and cleaned " + result.blocks() + " blocks / " +
                        result.blockEntities() + " block entities in " + result.ticks() +
                        " controlled ticks; consumed " + result.consumedChecklistItems() +
                        " checklist items (" + result.consumedCopycatsPartItems() +
                        " Copycats part items): " + requirements
                ),
                true
            );
            return Command.SINGLE_SUCCESS;
        } catch (RuntimeException error) {
            source.sendFailure(Component.literal("Schematicannon verification failed: " + error.getMessage()));
            return 0;
        }
    }
}
