"""
Telegram Sender - Send messages via Telegram Bot API.

Requires TELEGRAM_BOT_TOKEN environment variable.
"""

import logging
import os

logger = logging.getLogger(__name__)


class TelegramSender:
    """Sender that sends messages via Telegram Bot API."""

    name = "telegram"
    capabilities = ["text", "markdown", "media"]

    def __init__(self, config: dict = None):
        self.config = config or {}
        self._bot_token = None
        self._bot = None

    def _get_bot(self):
        """Get or create Telegram Bot instance."""
        if self._bot is not None:
            return self._bot

        try:
            from telegram import Bot
        except ImportError:
            logger.error("python-telegram-bot not installed")
            return None

        self._bot_token = (
            self.config.get("bot_token") or os.environ.get("TELEGRAM_BOT_TOKEN")
        )
        if not self._bot_token:
            return None

        self._bot = Bot(token=self._bot_token)
        return self._bot

    async def send(self, to: str, content: str, **kwargs) -> dict:
        """Send a Telegram message.

        Args:
            to: Telegram chat ID (user ID or group ID)
            content: Message text
            parse_mode: Optional parse mode ("Markdown" or "HTML")

        Returns:
            dict with sent status
        """
        bot = self._get_bot()
        if not bot:
            return {
                "error": "Telegram not configured. Set TELEGRAM_BOT_TOKEN."
            }

        parse_mode = kwargs.get("parse_mode", "Markdown")

        try:
            # Split long messages (Telegram limit is 4096 chars)
            for i in range(0, len(content), 4096):
                msg = await bot.send_message(
                    chat_id=int(to),
                    text=content[i : i + 4096],
                    parse_mode=parse_mode,
                )

            return {
                "sent": True,
                "channel": "telegram",
                "to": to,
                "message_id": msg.message_id,
            }
        except Exception as e:
            logger.error("Telegram send error: %s", e)
            # Retry without parse_mode in case of markdown errors
            if parse_mode:
                try:
                    msg = await bot.send_message(
                        chat_id=int(to), text=content[:4096]
                    )
                    return {
                        "sent": True,
                        "channel": "telegram",
                        "to": to,
                        "message_id": msg.message_id,
                        "note": "Sent without formatting due to parse error",
                    }
                except Exception as retry_err:
                    return {"error": str(retry_err)}
            return {"error": str(e)}
