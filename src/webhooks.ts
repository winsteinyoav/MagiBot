import Discord from 'discord.js';
import { doNothingOnError } from './helperFunctions';

const {
  WEBHOOK_ID_EX,
  WEBHOOK_TOKEN_EX,
  WEBHOOK_ID_JOIN,
  WEBHOOK_TOKEN_JOIN,
  WEBHOOK_ID_BUG,
  WEBHOOK_TOKEN_BUG,
  WEBHOOK_ID_STARTUP,
  WEBHOOK_TOKEN_STARTUP,
} = process.env;

const exceptionsWebhook = WEBHOOK_ID_EX && WEBHOOK_TOKEN_EX
  ? new Discord.WebhookClient({ id: WEBHOOK_ID_EX, token: WEBHOOK_TOKEN_EX })
  : null;
const joinsWebhook = WEBHOOK_ID_JOIN && WEBHOOK_TOKEN_JOIN
  ? new Discord.WebhookClient({ id: WEBHOOK_ID_JOIN, token: WEBHOOK_TOKEN_JOIN })
  : null;
const bugreportWebhook = WEBHOOK_ID_BUG && WEBHOOK_TOKEN_BUG
  ? new Discord.WebhookClient({ id: WEBHOOK_ID_BUG, token: WEBHOOK_TOKEN_BUG })
  : null;
const startupWebhook = WEBHOOK_ID_STARTUP && WEBHOOK_TOKEN_STARTUP
  ? new Discord.WebhookClient({ id: WEBHOOK_ID_STARTUP, token: WEBHOOK_TOKEN_STARTUP })
  : null;

export async function sendException(value: string, shardId?: number) {
  return exceptionsWebhook?.send(`Shard ${shardId}: ${value}`).catch(doNothingOnError);
}
export async function sendJoinEvent(value: string, shardId?: number) {
  return joinsWebhook?.send(`Shard ${shardId}: ${value}`).catch(doNothingOnError);
}
export async function sendBugreport(value: string, shardId?: number) {
  return bugreportWebhook?.send(`Shard ${shardId}: ${value}`).catch(doNothingOnError);
}
export async function sendStartupEvent(
  shardId: number,
  justStartingUp = false,
) {
  return startupWebhook?.send(
    justStartingUp
      ? `Shard ${shardId} is starting...!`
      : `Shard ${shardId} is up!`,
  ).catch(doNothingOnError);
}
