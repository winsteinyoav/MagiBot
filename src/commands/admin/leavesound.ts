import { ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import {
  adminDeferralType,
  isShadowBanned,
  shadowBannedLevel,
} from '../../shared_assets';
import { interactionConfirmation } from '../../helperFunctions';
import { MagibotAdminSlashCommand } from '../../types/command';
import {
  JoinsoundOptions,
  removeDefaultGuildLeavesound,
  removeLeaveSound,
  validateAndSaveLeavesound,
} from '../joinsound/management';

async function runCommand(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild!;
  if (
    isShadowBanned(interaction.member!.user.id, guild.id, guild.ownerId)
    !== shadowBannedLevel.not
  ) {
    interaction.followUp('You can\'t do this.');
    return;
  }

  const subcommand = interaction.options.getSubcommand(true) as
    | 'set'
    | 'set-default'
    | 'remove'
    | 'remove-default';

  if (subcommand === 'set') {
    const user = interaction.options.getUser(JoinsoundOptions.user, true);
    const attachment = interaction.options.getAttachment(
      JoinsoundOptions.soundFile,
      true,
    );
    validateAndSaveLeavesound(attachment, interaction, false, user);
    return;
  }
  if (subcommand === 'set-default') {
    const attachment = interaction.options.getAttachment(
      JoinsoundOptions.soundFile,
      true,
    );
    validateAndSaveLeavesound(attachment, interaction, true, undefined, guild.id);
    return;
  }
  if (subcommand === 'remove') {
    const user = interaction.options.getUser(JoinsoundOptions.user, true);
    await removeLeaveSound(user.id, guild.id);
    interaction.followUp(`You successfully removed ${user}s leavesound!`);
    return;
  }
  if (subcommand === 'remove-default') {
    const confirmed = await interactionConfirmation(
      interaction,
      'Do you want to remove the default leavesound of this server?',
      adminDeferralType,
    );
    if (!confirmed) {
      return;
    }
    await removeDefaultGuildLeavesound(guild.id);
    confirmed.followUp('You successfully removed the default leavesound of this server!');
  }
}

function registerSlashCommand(builder: SlashCommandBuilder) {
  return builder.addSubcommandGroup((subcommandGroup) => subcommandGroup
    .setName('leavesound')
    .setDescription('Manage leavesounds on this guild.')
    .addSubcommand((subcommand) => subcommand
      .setName('set')
      .setDescription('Set someones leavesound.')
      .addUserOption((option) => option
        .setName(JoinsoundOptions.user)
        .setDescription('The user you want to set the sound for.')
        .setRequired(true))
      .addAttachmentOption((option) => option
        .setName(JoinsoundOptions.soundFile)
        .setDescription(
          'A direct link to the sound you want to use. Max length of 8 seconds.',
        )
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove')
      .setDescription('Remove someones leavesound.')
      .addUserOption((option) => option
        .setName(JoinsoundOptions.user)
        .setDescription('Remove the leavesound of a user on this guild.')
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('set-default')
      .setDescription('Set the default leavesound for this server.')
      .addAttachmentOption((option) => option
        .setName(JoinsoundOptions.soundFile)
        .setDescription(
          'The sound you want to use per default on this guild. Mp3 or wav, max length of 8 seconds.',
        )
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove-default')
      .setDescription('Remove the default leavesound of this guild.')));
}

export const leavesound: MagibotAdminSlashCommand = {
  permissions: [],
  run: runCommand,
  registerSlashCommand,
};
