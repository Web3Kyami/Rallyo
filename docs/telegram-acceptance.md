# Telegram acceptance notes

Rallyo reads ordinary typed quiz answers through grammY's `message:text` route. The bot must receive ordinary group messages for typed Project Quiz, Word Seek, and Scramble answers to work.

Telegram delivery is controlled outside the application. In BotFather, disable privacy mode for Rallyo when the bot needs to receive every group message, or give the bot sufficient group access for the intended setup. The exact Telegram setting is an operator concern, and Rallyo does not try to change it through application logic.

Commands and inline button callbacks are delivered independently of ordinary typed messages. A real acceptance check should therefore verify both a button answer and a plain text answer in the community group.
