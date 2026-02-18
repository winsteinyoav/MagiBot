import { Readable } from 'stream';
import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  DiscordGatewayAdapterCreator,
  joinVoiceChannel,
  VoiceConnection,
} from '@discordjs/voice';
import {
  Guild, PermissionFlagsBits, VoiceBasedChannel, VoiceState,
} from 'discord.js';
import { getJoinsoundOfUser, getLeavesoundOfUser } from './commands/joinsound/management';
import { StillMutedModel } from './db';
import { isJoinableVc, toggleStillMuted } from './dbHelpers';
import { catchErrorOnDiscord } from './sendToMyDiscord';
import {
  isShadowBanned,
  shadowBannedLevel,
  shadowBannedSound,
} from './shared_assets';
import { saveJoinsoundsPlayedOfShard } from './statTracking';
import { trackJoinsoundPlayed, trackGenericEvent } from './analytics';

async function isStillMuted(userID: string, guildID: string) {
  const find = await StillMutedModel.findOne({
    userid: userID,
    guildid: guildID,
  });
  return Boolean(find);
}

function clearConnectionAndPlayer(
  connection: VoiceConnection,
  player: AudioPlayer,
  // eslint-disable-next-line no-undef
  timeout?: NodeJS.Timeout,
) {
  if (timeout) {
    clearTimeout(timeout);
  }
  connection.destroy();
  player.removeAllListeners().stop(true); // To be sure noone listens to this anymore
}

function playSoundInChannel(
  // eslint-disable-next-line no-shadow
  sound: string | Readable,
  channel: VoiceBasedChannel,
  guild: Guild,
) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild
      .voiceAdapterCreator as DiscordGatewayAdapterCreator,
  });
  const player = createAudioPlayer();
  try {
    connection.subscribe(player);
    const resource = createAudioResource(sound, {
      inlineVolume: true,
    });
    player.play(resource);

    resource.volume!.setVolume(0.5);
    saveJoinsoundsPlayedOfShard(-1);

    // 8 seconds is max play time:
    // so when something goes wrong this will time out latest 4 seconds after;
    // this also gives the bot 4 seconds to connect and start playing when it actually works
    const timeout = setTimeout(() => {
      clearConnectionAndPlayer(connection, player);
    }, 12 * 1000);
    player.on('stateChange', (state) => {
      if (state.status === AudioPlayerStatus.Playing) {
        if (state.playbackDuration > 0) {
          // this occurs *after* the sound has finished
          clearConnectionAndPlayer(connection, player, timeout);
        }
      }
    });
    player.on('error', (err) => {
      clearConnectionAndPlayer(connection, player, timeout);
      catchErrorOnDiscord(
        `**Dispatcher Error (${
          (err.toString && err.toString()) || 'NONE'
        }):**\n\`\`\`
        ${err.stack || 'NO STACK'}
        \`\`\``,
      );
    });
  } catch (err) {
    console.error(err);
    clearConnectionAndPlayer(connection, player);
  }
}

function channelHasNonBotMembers(channel: VoiceBasedChannel) {
  return channel.members.some((member) => !member.user.bot);
}

async function tryPlayJoinsound(newState: VoiceState, newVc: VoiceBasedChannel): Promise<boolean> {
  const shadowBanned = isShadowBanned(
    newState.member!.id,
    newState.guild.id,
    newState.guild.ownerId,
  );
  if (
    !newState.guild.members.me
    || newState.guild.members.me.voice.channel
    || newState.id === newState.guild.members.me.user.id
    || !newVc.joinable
    || (!(await isJoinableVc(newState.guild.id, newVc.id))
      && shadowBanned !== shadowBannedLevel.guild)
  ) {
    return false;
  }

  trackGenericEvent({
    userId: newState.member!.id,
    event: 'voice_channel_should_play_joinsound',
    properties: {
      guildId: newState.guild.id,
    },
  });

  const perms = newVc.permissionsFor(newState.guild.members.me);
  if (!perms || !perms.has(PermissionFlagsBits.Connect)) {
    return false;
  }

  let sound = await getJoinsoundOfUser(newState.id, newState.guild.id);
  if (shadowBanned !== shadowBannedLevel.not) {
    sound = shadowBannedSound;
  }

  trackGenericEvent({
    userId: newState.member!.id,
    event: 'voice_channel_loaded_joinsound',
    properties: {
      guildId: newState.guild.id,
      hasSound: Boolean(sound),
    },
  });

  if (!sound) {
    return false;
  }

  trackJoinsoundPlayed({
    userId: newState.member!.id,
    properties: {
      guildId: newState.guild.id,
    },
  });

  playSoundInChannel(sound, newVc, newVc.guild);
  return true;
}

async function tryPlayLeavesound(
  oldState: VoiceState,
  oldChannel: VoiceBasedChannel,
): Promise<boolean> {
  if (
    !oldState.guild.members.me
    || oldState.guild.members.me.voice.channel
    || !oldChannel.joinable
    || !channelHasNonBotMembers(oldChannel)
    || !(await isJoinableVc(oldState.guild.id, oldChannel.id))
  ) {
    return false;
  }

  const perms = oldChannel.permissionsFor(oldState.guild.members.me);
  if (!perms || !perms.has(PermissionFlagsBits.Connect)) {
    return false;
  }

  const shadowBanned = isShadowBanned(
    oldState.member!.id,
    oldState.guild.id,
    oldState.guild.ownerId,
  );

  let sound = await getLeavesoundOfUser(oldState.id, oldState.guild.id);
  if (shadowBanned !== shadowBannedLevel.not) {
    sound = shadowBannedSound;
  }

  if (!sound) {
    return false;
  }

  trackGenericEvent({
    userId: oldState.member!.id,
    event: 'voice_channel_leavesound_played',
    properties: {
      guildId: oldState.guild.id,
    },
  });

  playSoundInChannel(sound, oldChannel, oldChannel.guild);
  return true;
}

export async function onVoiceStateChange(
  oldState: VoiceState,
  newState: VoiceState,
) {
  const newVc = newState.channel;
  const oldVc = oldState.channel;
  if (
    !newState.member
    || newState.member.user.bot
    || (oldVc && newVc && oldVc.id === newVc.id)
  ) {
    return;
  }

  trackGenericEvent({
    userId: newState.member.id,
    event: 'voice_channel_change_detected',
    properties: {
      guildId: newState.guild.id,
    },
  });

  // is muted and joined a vc? maybe still muted from queue
  if (
    newState.serverMute
    && (await isStillMuted(newState.id, newState.guild.id))
  ) {
    newState.setMute(false, 'was still muted from old queue system');
    toggleStillMuted(newState.id, newState.guild.id, false);
  }

  // join sound takes priority over leave sound
  if (newVc) {
    const played = await tryPlayJoinsound(newState, newVc);
    if (played) {
      return;
    }
  }

  if (oldVc) {
    await tryPlayLeavesound(oldState, oldVc);
  }
}
