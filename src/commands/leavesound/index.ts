import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction } from 'discord.js';
import { isShadowBanned, shadowBannedLevel } from '../../shared_assets';
import { DeferReply, MagibotSlashCommand } from '../../types/command';
import {
  getLeavesoundOverviewOfUser,
  JoinsoundOptions,
  removeAllLeavesoundsOfUser,
  removeDefaultLeaveSound,
  removeLeaveSound,
  validateAndSaveLeavesound,
} from '../joinsound/management';

const slashCommand = new SlashCommandBuilder()
  .setName('leavesound')
  .setDescription('Manage your leavesounds.')
  .setDMPermission(false)
  .addSubcommand((subcommand) => subcommand
    .setName('set')
    .setDescription('Set your leavesound.')
    .addAttachmentOption((option) => option
      .setName(JoinsoundOptions.soundFile)
      .setDescription(
        'The sound you want to use. Mp3 or wav, max length of 8 seconds.',
      )
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName('remove').setDescription('Remove your leavesound.'))
  .addSubcommand((subcommand) => subcommand
    .setName('set-default')
    .setDescription('Set your default leavesound.')
    .addAttachmentOption((option) => option
      .setName(JoinsoundOptions.soundFile)
      .setDescription(
        'The sound you want to use per default in all guilds. Mp3 or wav, max length of 8 seconds.',
      )
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('remove-default')
    .setDescription('Remove your default leavesound.'))
  .addSubcommand((subcommand) => subcommand
    .setName('remove-all')
    .setDescription('Remove all of your leavesounds.'))
  .addSubcommand((subcommand) => subcommand
    .setName('overview')
    .setDescription('Get an overview of your leavesound setup.'));

const deferralType = DeferReply.public;

async function runCommand(interaction: ChatInputCommandInteraction) {
  const { user } = interaction.member!;
  const guild = interaction.guild!;
  if (
    isShadowBanned(user.id, guild.id, guild.ownerId) !== shadowBannedLevel.not
  ) {
    interaction.followUp('You cant do this.');
    return;
  }
  const subcommand = interaction.options.getSubcommand(true) as
    | 'set'
    | 'set-default'
    | 'remove'
    | 'remove-default'
    | 'remove-all'
    | 'overview';

  if (subcommand === 'set') {
    const attachment = interaction.options.getAttachment(
      JoinsoundOptions.soundFile,
      true,
    );
    await validateAndSaveLeavesound(attachment, interaction, false);
    return;
  }
  if (subcommand === 'set-default') {
    const attachment = interaction.options.getAttachment(
      JoinsoundOptions.soundFile,
      true,
    );
    await validateAndSaveLeavesound(attachment, interaction, true);
    return;
  }
  if (subcommand === 'remove') {
    await removeLeaveSound(user.id, guild.id);
    interaction.followUp('Successfully removed your leavesound!');
    return;
  }
  if (subcommand === 'remove-default') {
    await removeDefaultLeaveSound(user.id);
    interaction.followUp('Successfully removed your default leavesound!');
  }
  if (subcommand === 'remove-all') {
    await removeAllLeavesoundsOfUser(interaction, deferralType);
  }
  if (subcommand === 'overview') {
    await getLeavesoundOverviewOfUser(interaction);
  }
}

export const leavesound: MagibotSlashCommand = {
  permissions: [],
  definition: slashCommand.toJSON(),
  run: runCommand,
  defer: deferralType,
};
