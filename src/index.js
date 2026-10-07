import { config } from './config.js';
import { bot, setupProfile } from './bot.js';
import { startWebApp } from './webapp.js';

await bot.init();
if (!bot.botInfo.supports_inline_queries) {
  console.warn('⚠️  Inline mode is OFF. Turn it on in @BotFather: /setinline → pick the bot → set a placeholder.');
}
await setupProfile().catch((err) => console.warn('Could not update bot name/commands:', err.message));

const webApp = config.webappUrl ? startWebApp() : null;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    webApp?.close();
    bot.stop();
  });
}

await bot.start({
  allowed_updates: ['message', 'inline_query', 'callback_query'],
  onStart: (me) => console.log(`@${me.username} (${config.botName}) is running`),
});
