import ffprobe from 'ffprobe';
import { ChatInputCommandInteraction, Attachment, User } from 'discord.js';
import { APIEmbed, APIEmbedField } from 'discord-api-types/v10';
import {
  getGlobalUser,
  getConfiguration,
  getUser,
  removeAllJoinsoundsOfUserFromDb,
  removeAllLeavesoundsOfUserFromDb,
  getUserInAllGuilds,
} from '../../dbHelpers';
import {
  getJoinsoundReadableStreamOfUser,
  JoinsoundStoreError,
  removeLocallyStoredJoinsoundOfTarget,
  storeJoinsoundOfTarget,
  getSpaceUsedByTarget,
  joinsoundStorageUserLimit,
  getAllLocallyStoredJoinsoundsOfUser,
  getAllLocallyStoredLeavesoundsOfUser,
  maximumSingleFileSize,
  SoundType,
} from './fileManagement';
import { asyncForEach, interactionConfirmation } from '../../helperFunctions';
import { DeferReply } from '../../types/command';
import { globalUser, User as UserInDb } from '../../db';

// eslint-disable-next-line no-shadow
export const enum JoinsoundOptions {
  'soundFile' = 'sound-file',
  'user' = 'user',
}

const maxJoinsoundTitleCharlength = 30;

function getSoundTitleFromUrl(url?: string) {
  return url
    ? url
      .substring(url.lastIndexOf('/') + 1)
      .substring(0, maxJoinsoundTitleCharlength) // enforce max length
    : undefined;
}

async function setSound(
  userId: string,
  guildId: string,
  soundUrl: string | undefined,
): Promise<JoinsoundStoreError | null> {
  const user = await getUser(userId, guildId);
  if (soundUrl) {
    user.sound = 'local';
    const error = await storeJoinsoundOfTarget({ userId, guildId }, soundUrl);
    if (error) {
      return error;
    }
  } else {
    user.sound = undefined;
    await removeLocallyStoredJoinsoundOfTarget({ userId, guildId });
  }

  user.soundTitle = getSoundTitleFromUrl(soundUrl);
  await user.save();
  return null;
}

export async function removeSound(userId: string, guildId: string) {
  return setSound(userId, guildId, undefined);
}

async function setDefaultSound(
  userId: string,
  soundUrl: string | undefined,
): Promise<JoinsoundStoreError | null> {
  const user = await getGlobalUser(userId);

  if (soundUrl) {
    user.sound = 'local';
    const error = await storeJoinsoundOfTarget(
      { userId, default: true },
      soundUrl,
    );
    if (error) {
      return error;
    }
  } else {
    user.sound = undefined;
    await removeLocallyStoredJoinsoundOfTarget({ userId, default: true });
  }

  user.soundTitle = getSoundTitleFromUrl(soundUrl);
  await user.save();
  return null;
}

export async function removeDefaultSound(userId: string) {
  return setDefaultSound(userId, undefined);
}

async function setDefaultGuildJoinsound(
  guildId: string,
  soundUrl: string | undefined,
): Promise<JoinsoundStoreError | null> {
  const guild = await getConfiguration(guildId);

  if (soundUrl) {
    guild.defaultJoinsound = 'local';
    const error = await storeJoinsoundOfTarget(
      { guildId, default: true },
      soundUrl,
    );
    if (error) {
      return error;
    }
  } else {
    guild.defaultJoinsound = undefined;
    await removeLocallyStoredJoinsoundOfTarget({ guildId, default: true });
  }

  guild.defaultJoinsoundTitle = getSoundTitleFromUrl(soundUrl);
  await guild.save();
  return null;
}

export async function removeDefaultGuildJoinsound(guildId: string) {
  return setDefaultGuildJoinsound(guildId, undefined);
}

async function setLeaveSound(
  userId: string,
  guildId: string,
  soundUrl: string | undefined,
): Promise<JoinsoundStoreError | null> {
  const user = await getUser(userId, guildId);
  if (soundUrl) {
    user.leaveSound = 'local';
    const error = await storeJoinsoundOfTarget({ userId, guildId }, soundUrl, 'leave');
    if (error) {
      return error;
    }
  } else {
    user.leaveSound = undefined;
    await removeLocallyStoredJoinsoundOfTarget({ userId, guildId }, 'leave');
  }

  user.leaveSoundTitle = getSoundTitleFromUrl(soundUrl);
  await user.save();
  return null;
}

export async function removeLeaveSound(userId: string, guildId: string) {
  return setLeaveSound(userId, guildId, undefined);
}

async function setDefaultLeaveSound(
  userId: string,
  soundUrl: string | undefined,
): Promise<JoinsoundStoreError | null> {
  const user = await getGlobalUser(userId);

  if (soundUrl) {
    user.leaveSound = 'local';
    const error = await storeJoinsoundOfTarget(
      { userId, default: true },
      soundUrl,
      'leave',
    );
    if (error) {
      return error;
    }
  } else {
    user.leaveSound = undefined;
    await removeLocallyStoredJoinsoundOfTarget({ userId, default: true }, 'leave');
  }

  user.leaveSoundTitle = getSoundTitleFromUrl(soundUrl);
  await user.save();
  return null;
}

export async function removeDefaultLeaveSound(userId: string) {
  return setDefaultLeaveSound(userId, undefined);
}

async function setDefaultGuildLeavesound(
  guildId: string,
  soundUrl: string | undefined,
): Promise<JoinsoundStoreError | null> {
  const guild = await getConfiguration(guildId);

  if (soundUrl) {
    guild.defaultLeavesound = 'local';
    const error = await storeJoinsoundOfTarget(
      { guildId, default: true },
      soundUrl,
      'leave',
    );
    if (error) {
      return error;
    }
  } else {
    guild.defaultLeavesound = undefined;
    await removeLocallyStoredJoinsoundOfTarget({ guildId, default: true }, 'leave');
  }

  guild.defaultLeavesoundTitle = getSoundTitleFromUrl(soundUrl);
  await guild.save();
  return null;
}

export async function removeDefaultGuildLeavesound(guildId: string) {
  return setDefaultGuildLeavesound(guildId, undefined);
}

const defaultFFProbeLocation = '/usr/bin/ffprobe';

export async function validateAndSaveSound(
  attachment: Attachment,
  interaction: ChatInputCommandInteraction,
  setDefault: boolean,
  soundType: SoundType = 'join',
  user?: User,
  defaultForGuildId?: string,
) {
  if (setDefault && user) {
    throw new Error('Cant set-default sounds for others!');
  }

  const soundLabel = soundType === 'leave' ? 'leavesound' : 'joinsound';

  const isAudioFile = attachment.contentType?.startsWith('audio/');
  if (!isAudioFile) {
    interaction.followUp('The file you sent is not an audio file!');
    return;
  }
  if (attachment.size > maximumSingleFileSize) {
    interaction.followUp(
      `The file you sent is larger than ${maximumSingleFileSize / 1024
      } KB, which is the limit per file!`,
    );
    return;
  }
  const soundUrl = attachment.url;

  const sound = await ffprobe(soundUrl, {
    path: defaultFFProbeLocation,
  }).catch((error) => {
    console.error(error);
  });

  if (!sound) {
    interaction.followUp(
      'Something went wrong when trying to load your file. Make sure the URL links directly to an audio file.',
    );
    return;
  }
  // eslint-disable-next-line prefer-destructuring
  const firstStream = sound.streams[0];
  if (
    firstStream
    && firstStream.codec_name !== 'mp3'
    && firstStream.codec_name !== 'pcm_s16le'
    && firstStream.codec_name !== 'pcm_f32le'
  ) {
    interaction.followUp(
      'You need to use a compatible file! For more info use `help sound`',
    );
    return;
  }
  const duration = firstStream.duration ? Number(firstStream.duration) : null;
  if (!duration || Number.isNaN(duration)) {
    interaction.followUp(
      `Failed to calculate the duration of the ${soundLabel} you're trying to add.`,
    );
    return;
  }
  if (duration > 8) {
    interaction.followUp(
      `The ${soundLabel} you're trying to add is longer than 8 seconds.`,
    );
    return;
  }

  const userId = user ? user.id : interaction.member!.user.id;

  let error: JoinsoundStoreError | null;

  if (soundType === 'leave') {
    if (defaultForGuildId) {
      error = await setDefaultGuildLeavesound(defaultForGuildId, soundUrl);
    } else if (setDefault) {
      error = await setDefaultLeaveSound(userId, soundUrl);
    } else {
      error = await setLeaveSound(userId, interaction.guild!.id, soundUrl);
    }
  } else if (defaultForGuildId) {
    error = await setDefaultGuildJoinsound(defaultForGuildId, soundUrl);
  } else if (setDefault) {
    error = await setDefaultSound(userId, soundUrl);
  } else {
    error = await setSound(userId, interaction.guild!.id, soundUrl);
  }

  if (error) {
    if (error === JoinsoundStoreError.noStorageLeftForUser) {
      interaction.followUp(
        `**You already have more than 1MB (1 MegaByte) worth of sounds!**
In general this is enough to store about 5 different sounds.
To add new sounds you either need to delete some of your old ones, or upload your new ones using the direct-url option, since that will not count towards your storage limit.`,
      );
      return;
    }
    if (error === JoinsoundStoreError.noStorageLeftForGuild) {
      interaction.followUp(
        `**You can't use a ${soundLabel} that is larger than 500KB (500 KiloBytes)!**
This limit only applies to default sounds of guilds. A typical sound will need about 50-200 KB, so it should be no problem to fit within this limit.`,
      );
      return;
    }
    if (error === JoinsoundStoreError.noStorageLeftOnServer) {
      interaction.followUp(
        'This is embarassing. It seems like the server has reached its maximum storage capacity. Feel free to notify the developers about this by using `/bugreport` or on the discord server found in `/info`.',
      );
      return;
    }
  }
  if (defaultForGuildId) {
    interaction.followUp(
      `You successfully changed the default ${soundLabel} for this server!`,
    );
    return;
  }
  if (user) {
    interaction.followUp(`You successfully changed ${user}s ${soundLabel}!`);
    return;
  }
  interaction.followUp(
    `You successfully changed your ${setDefault ? 'default ' : ''}${soundLabel}!`,
  );
}

export async function validateAndSaveJoinsound(
  attachment: Attachment,
  interaction: ChatInputCommandInteraction,
  setDefault: boolean,
  user?: User,
  defaultForGuildId?: string,
) {
  return validateAndSaveSound(
    attachment,
    interaction,
    setDefault,
    'join',
    user,
    defaultForGuildId,
  );
}

export async function validateAndSaveLeavesound(
  attachment: Attachment,
  interaction: ChatInputCommandInteraction,
  setDefault: boolean,
  user?: User,
  defaultForGuildId?: string,
) {
  return validateAndSaveSound(
    attachment,
    interaction,
    setDefault,
    'leave',
    user,
    defaultForGuildId,
  );
}

export async function getJoinsoundOfUser(userId: string, guildId: string) {
  const user = await getUser(userId, guildId);
  if (user.sound && user.sound !== 'false') {
    if (user.sound === 'local') {
      return getJoinsoundReadableStreamOfUser({ userId, guildId });
    }
    return user.sound;
  }
  const defaultUser = await getGlobalUser(userId);
  if (defaultUser.sound && defaultUser.sound !== 'false') {
    if (defaultUser.sound === 'local') {
      return getJoinsoundReadableStreamOfUser({ userId, default: true });
    }
    return defaultUser.sound;
  }
  const defaultGuildSound = await getConfiguration(guildId);
  if (
    defaultGuildSound.defaultJoinsound
    && defaultGuildSound.defaultJoinsound !== 'false'
  ) {
    if (defaultGuildSound.defaultJoinsound === 'local') {
      return getJoinsoundReadableStreamOfUser({ guildId, default: true });
    }
    return defaultGuildSound.defaultJoinsound;
  }
  return null;
}

export async function getLeavesoundOfUser(userId: string, guildId: string) {
  const user = await getUser(userId, guildId);
  if (user.leaveSound && user.leaveSound !== 'false') {
    if (user.leaveSound === 'local') {
      return getJoinsoundReadableStreamOfUser({ userId, guildId }, 'leave');
    }
    return user.leaveSound;
  }
  const defaultUser = await getGlobalUser(userId);
  if (defaultUser.leaveSound && defaultUser.leaveSound !== 'false') {
    if (defaultUser.leaveSound === 'local') {
      return getJoinsoundReadableStreamOfUser({ userId, default: true }, 'leave');
    }
    return defaultUser.leaveSound;
  }
  const defaultGuildSound = await getConfiguration(guildId);
  if (
    defaultGuildSound.defaultLeavesound
    && defaultGuildSound.defaultLeavesound !== 'false'
  ) {
    if (defaultGuildSound.defaultLeavesound === 'local') {
      return getJoinsoundReadableStreamOfUser({ guildId, default: true }, 'leave');
    }
    return defaultGuildSound.defaultLeavesound;
  }
  return null;
}

export async function removeAllJoinsoundsOfUser(
  interaction: ChatInputCommandInteraction,
  deferralType: DeferReply,
) {
  const confirmed = await interactionConfirmation(
    interaction,
    'Are you sure you want to remove all of your joinsounds?',
    deferralType,
    'Cancelled removing all of your joinsounds.',
  );
  if (!confirmed) {
    return;
  }

  const userId = interaction.member!.user.id;
  const guildIds = await getAllLocallyStoredJoinsoundsOfUser(userId);
  await asyncForEach(guildIds, async (guildId) => {
    await removeSound(userId, guildId);
  });
  await removeDefaultSound(userId);
  await removeAllJoinsoundsOfUserFromDb(userId);
  confirmed.followUp('Successfully removed all of your joinsounds!');
}

export async function removeAllLeavesoundsOfUser(
  interaction: ChatInputCommandInteraction,
  deferralType: DeferReply,
) {
  const confirmed = await interactionConfirmation(
    interaction,
    'Are you sure you want to remove all of your leavesounds?',
    deferralType,
    'Cancelled removing all of your leavesounds.',
  );
  if (!confirmed) {
    return;
  }

  const userId = interaction.member!.user.id;
  const guildIds = await getAllLocallyStoredLeavesoundsOfUser(userId);
  await asyncForEach(guildIds, async (guildId) => {
    await removeLeaveSound(userId, guildId);
  });
  await removeDefaultLeaveSound(userId);
  await removeAllLeavesoundsOfUserFromDb(userId);
  confirmed.followUp('Successfully removed all of your leavesounds!');
}

function getJoinsoundOfUserEntry(user: UserInDb | globalUser) {
  if (user.soundTitle) {
    return user.soundTitle;
  }
  if (user.sound) {
    return user.sound.slice(-30);
  }
  return false;
}

const defaultJoinsoundValue = 'None set.';
const maxEmbedCharacters = 4096;

export async function getJoinsoundOverviewOfUser(
  interaction: ChatInputCommandInteraction,
) {
  const { user } = interaction.member!;
  const userId = user.id;
  const guild = interaction.guild!;
  const guildId = guild.id;

  const member = await guild.members.fetch(userId)!;

  const defaultUser = await getGlobalUser(userId);
  // get user for this guild extra as this will create the user entry if it doesn't exist
  const userInThisGuild = await getUser(userId, guildId);
  const userInAllGuilds = await getUserInAllGuilds(userId);
  const storageUsed = await getSpaceUsedByTarget({ userId, guildId });

  const info: Array<APIEmbedField> = [];

  info.push({
    name: 'Storage Used by Joinsounds',
    value: `**${(storageUsed / 1024).toFixed(1)} KB** / ${joinsoundStorageUserLimit / 1024
    } KB`,
    inline: false,
  });

  info.push({
    name: 'Default Joinsound',
    value: getJoinsoundOfUserEntry(defaultUser) || defaultJoinsoundValue,
    inline: false,
  });

  info.push({
    name: 'Joinsound on this guild',
    value: getJoinsoundOfUserEntry(userInThisGuild) || defaultJoinsoundValue,
    inline: false,
  });

  let soundNames = '';
  userInAllGuilds.forEach((userEntry) => {
    if (userEntry.guildID === guildId) {
      return;
    }
    const soundName = getJoinsoundOfUserEntry(userEntry);
    if (soundName) {
      soundNames += `${soundName}\n`;
    }
  });

  info.push({
    name: 'Joinsounds on other guilds',
    value: (soundNames || defaultJoinsoundValue).slice(0, maxEmbedCharacters),
    inline: false,
  });

  const embed: APIEmbed = {
    color: member.displayColor,
    description: `Joinsound overview of ${user}:`,
    fields: info,
    thumbnail: { url: member.user.avatarURL() || '' },
    footer: {
      icon_url: member.user.avatarURL() || '',
      text: member.user.tag,
    },
  };

  interaction.followUp({ embeds: [embed] });
}

function getLeavesoundOfUserEntry(user: UserInDb | globalUser) {
  if (user.leaveSoundTitle) {
    return user.leaveSoundTitle;
  }
  if (user.leaveSound) {
    return user.leaveSound.slice(-30);
  }
  return false;
}

export async function getLeavesoundOverviewOfUser(
  interaction: ChatInputCommandInteraction,
) {
  const { user } = interaction.member!;
  const userId = user.id;
  const guild = interaction.guild!;
  const guildId = guild.id;

  const member = await guild.members.fetch(userId)!;

  const defaultUser = await getGlobalUser(userId);
  const userInThisGuild = await getUser(userId, guildId);
  const userInAllGuilds = await getUserInAllGuilds(userId);
  const storageUsed = await getSpaceUsedByTarget({ userId, guildId });

  const info: Array<APIEmbedField> = [];

  info.push({
    name: 'Storage Used (shared with joinsounds)',
    value: `**${(storageUsed / 1024).toFixed(1)} KB** / ${joinsoundStorageUserLimit / 1024
    } KB`,
    inline: false,
  });

  info.push({
    name: 'Default Leavesound',
    value: getLeavesoundOfUserEntry(defaultUser) || defaultJoinsoundValue,
    inline: false,
  });

  info.push({
    name: 'Leavesound on this guild',
    value: getLeavesoundOfUserEntry(userInThisGuild) || defaultJoinsoundValue,
    inline: false,
  });

  let soundNames = '';
  userInAllGuilds.forEach((userEntry) => {
    if (userEntry.guildID === guildId) {
      return;
    }
    const soundName = getLeavesoundOfUserEntry(userEntry);
    if (soundName) {
      soundNames += `${soundName}\n`;
    }
  });

  info.push({
    name: 'Leavesounds on other guilds',
    value: (soundNames || defaultJoinsoundValue).slice(0, maxEmbedCharacters),
    inline: false,
  });

  const embed: APIEmbed = {
    color: member.displayColor,
    description: `Leavesound overview of ${user}:`,
    fields: info,
    thumbnail: { url: member.user.avatarURL() || '' },
    footer: {
      icon_url: member.user.avatarURL() || '',
      text: member.user.tag,
    },
  };

  interaction.followUp({ embeds: [embed] });
}
