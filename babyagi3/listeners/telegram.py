"""
Telegram Listener - Receive messages via Telegram Bot API (long polling).

Uses the python-telegram-bot library for async long-polling.
Requires TELEGRAM_BOT_TOKEN environment variable.

Setup:
1. Create a bot via @BotFather on Telegram
2. Set TELEGRAM_BOT_TOKEN in your .env
3. Enable the telegram channel in config.yaml:
   channels:
     telegram:
       enabled: true
       allowed_user_ids: []  # empty = allow all, or list Telegram user IDs
"""

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# Telegram message character limit
TELEGRAM_MAX_LENGTH = 4096


def _split_message(text: str, max_length: int = TELEGRAM_MAX_LENGTH) -> list[str]:
    """Split a message into chunks that fit within Telegram's character limit.

    Tries to split at paragraph boundaries, then sentence boundaries, then
    word boundaries to avoid breaking markdown formatting.
    """
    if len(text) <= max_length:
        return [text]

    chunks = []
    remaining = text

    while remaining:
        if len(remaining) <= max_length:
            chunks.append(remaining)
            break

        # Try to find a good split point within the limit
        chunk = remaining[:max_length]

        # Priority 1: Split at double newline (paragraph boundary)
        split_pos = chunk.rfind("\n\n")
        if split_pos > max_length // 4:
            chunks.append(remaining[:split_pos].rstrip())
            remaining = remaining[split_pos:].lstrip("\n")
            continue

        # Priority 2: Split at single newline
        split_pos = chunk.rfind("\n")
        if split_pos > max_length // 4:
            chunks.append(remaining[:split_pos].rstrip())
            remaining = remaining[split_pos:].lstrip("\n")
            continue

        # Priority 3: Split at last space
        split_pos = chunk.rfind(" ")
        if split_pos > max_length // 4:
            chunks.append(remaining[:split_pos])
            remaining = remaining[split_pos + 1:]
            continue

        # Fallback: hard split at max_length
        chunks.append(remaining[:max_length])
        remaining = remaining[max_length:]

    return [c for c in chunks if c.strip()]


async def _send_telegram_message(message, text: str):
    """Send a message via Telegram with robust parse_mode fallback.

    Tries Markdown parse mode first, then falls back to plain text if
    Telegram rejects the markdown formatting (which often happens with
    tool output containing unmatched backticks, underscores in URLs, etc.).
    """
    chunks = _split_message(text)

    for chunk in chunks:
        # Try Markdown first for nicer formatting
        try:
            await message.reply_text(chunk, parse_mode="Markdown")
            continue
        except Exception as md_err:
            logger.debug(
                "Telegram Markdown parse failed, falling back to plain text: %s",
                md_err,
            )

        # Fallback: send without any parse_mode (plain text always works)
        try:
            await message.reply_text(chunk)
        except Exception as plain_err:
            logger.error("Failed to send Telegram message even as plain text: %s", plain_err)
            raise


async def run_telegram_listener(agent, config: dict = None):
    """Run the Telegram listener using long polling.

    Args:
        agent: The Agent instance
        config: Configuration dict with:
            - bot_token: Telegram bot token (or use TELEGRAM_BOT_TOKEN env)
            - allowed_user_ids: List of allowed Telegram user IDs (empty = all)
            - owner_user_id: Owner's Telegram user ID for owner detection
    """
    config = config or {}
    bot_token = config.get("bot_token") or os.environ.get("TELEGRAM_BOT_TOKEN")

    if not bot_token:
        logger.warning("Telegram listener disabled: TELEGRAM_BOT_TOKEN not set")
        return

    try:
        from telegram import Update
        from telegram.ext import (
            ApplicationBuilder,
            MessageHandler,
            CommandHandler,
            ContextTypes,
            filters,
        )
    except ImportError:
        logger.error(
            "Telegram listener requires python-telegram-bot. "
            "Install with: pip install python-telegram-bot"
        )
        return

    allowed_user_ids = set(config.get("allowed_user_ids", []))
    owner_user_id = config.get("owner_user_id") or os.environ.get("TELEGRAM_OWNER_USER_ID")
    if owner_user_id:
        owner_user_id = int(owner_user_id)

    async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle incoming Telegram messages."""
        if not update.message or not update.message.text:
            return

        user = update.message.from_user
        user_id = user.id
        username = user.username or user.first_name or str(user_id)

        # Access control
        if allowed_user_ids and user_id not in allowed_user_ids:
            await update.message.reply_text(
                "Sorry, you're not authorized to use this bot."
            )
            return

        text = update.message.text
        is_owner = owner_user_id is not None and user_id == owner_user_id
        thread_id = f"telegram_{user_id}"

        context_info = {
            "channel": "telegram",
            "sender": username,
            "sender_id": str(user_id),
            "is_owner": is_owner,
        }

        logger.info("Telegram message from %s (%s): %s", username, user_id, text[:80])

        try:
            response = await agent.run_async(
                text,
                thread_id=thread_id,
                context=context_info,
            )
            if response:
                await _send_telegram_message(update.message, response)
        except Exception as e:
            logger.error("Error processing Telegram message: %s", e, exc_info=True)
            try:
                await update.message.reply_text(
                    "Sorry, I encountered an error processing your message."
                )
            except Exception:
                pass

    async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /start command."""
        if update.message:
            user = update.message.from_user
            await _send_telegram_message(
                update.message,
                f"Hi {user.first_name}! I'm BabyAGI. Send me a message and I'll help you out.\n\n"
                f"Your Telegram user ID is: {user.id}",
            )

    # Build application
    app = ApplicationBuilder().token(bot_token).build()
    app.add_handler(CommandHandler("start", handle_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Telegram listener started (long polling)")

    # Run polling in a way that doesn't block the event loop
    await app.initialize()
    await app.start()
    try:
        await app.updater.start_polling(drop_pending_updates=True)
        # Keep running until cancelled
        while True:
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        pass
    finally:
        await app.updater.stop()
        await app.stop()
        await app.shutdown()
