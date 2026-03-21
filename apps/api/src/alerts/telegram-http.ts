import { Agent } from 'node:https';
import { Telegraf } from 'telegraf';

const clients = new Map<string, Telegraf>();

export async function sendTelegramRequest(
  token: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string; providerMessageId?: string }> {
  const bot = getTelegramBot(token);

  try {
    const response = await bot.telegram.sendMessage(
      String(payload.chat_id),
      String(payload.text ?? ''),
      {
        ...(payload.message_thread_id
          ? { message_thread_id: Number(payload.message_thread_id) }
          : {}),
        ...(payload.parse_mode === 'HTML' ? { parse_mode: 'HTML' as const } : {}),
      },
    );

    return {
      ok: true,
      status: 200,
      text: JSON.stringify(response),
      providerMessageId: String(response.message_id),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'telegram send failed';
    return {
      ok: false,
      status: 500,
      text: message,
    };
  }
}

function getTelegramBot(token: string): Telegraf {
  const existing = clients.get(token);
  if (existing) {
    return existing;
  }

  const bot = new Telegraf(token, {
    telegram: {
      agent: new Agent({
        family: 4,
        keepAlive: true,
      }),
    },
  });
  clients.set(token, bot);
  return bot;
}
