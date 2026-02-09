"""
Discord Listener - Receive messages via Discord Bot.

Uses the discord.py library.
Requires DISCORD_BOT_TOKEN environment variable.

Setup:
1. Create a bot at https://discord.com/developers/applications
2. Enable MESSAGE CONTENT intent in the Bot settings
3. Invite bot to your server with appropriate permissions
4. Set DISCORD_BOT_TOKEN in your .env
5. Enable the discord channel in config.yaml:
   channels:
     discord:
       enabled: true
       allowed_channel_ids: []  # empty = respond in all channels, or list channel IDs
       allowed_user_ids: []     # empty = allow all, or list Discord user IDs
"""

import asyncio
import logging
import os

logger = logging.getLogger(__name__)


async def run_discord_listener(agent, config: dict = None):
    """Run the Discord listener.

    Args:
        agent: The Agent instance
        config: Configuration dict with:
            - bot_token: Discord bot token (or use DISCORD_BOT_TOKEN env)
            - allowed_channel_ids: List of allowed Discord channel IDs (empty = all)
            - allowed_user_ids: List of allowed Discord user IDs (empty = all)
            - owner_user_id: Owner's Discord user ID for owner detection
    """
    config = config or {}
    bot_token = config.get("bot_token") or os.environ.get("DISCORD_BOT_TOKEN")

    if not bot_token:
        logger.warning("Discord listener disabled: DISCORD_BOT_TOKEN not set")
        return

    try:
        import discord
    except ImportError:
        logger.error(
            "Discord listener requires discord.py. "
            "Install with: pip install discord.py"
        )
        return

    allowed_channel_ids = set(config.get("allowed_channel_ids", []))
    allowed_user_ids = set(config.get("allowed_user_ids", []))
    owner_user_id = config.get("owner_user_id") or os.environ.get("DISCORD_OWNER_USER_ID")
    if owner_user_id:
        owner_user_id = int(owner_user_id)

    # Set up intents
    intents = discord.Intents.default()
    intents.message_content = True

    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        logger.info("Discord bot connected as %s (ID: %s)", client.user.name, client.user.id)

    @client.event
    async def on_message(message: discord.Message):
        # Ignore own messages
        if message.author == client.user:
            return

        # Ignore bot messages
        if message.author.bot:
            return

        # Check if bot is mentioned or in DM
        is_dm = isinstance(message.channel, discord.DMChannel)
        is_mentioned = client.user in message.mentions

        # In servers, only respond when mentioned or in allowed channels
        if not is_dm:
            if allowed_channel_ids and message.channel.id not in allowed_channel_ids:
                if not is_mentioned:
                    return
            elif not is_mentioned:
                return

        # Access control
        if allowed_user_ids and message.author.id not in allowed_user_ids:
            return

        # Strip bot mention from message
        text = message.content
        if client.user:
            text = text.replace(f"<@{client.user.id}>", "").replace(f"<@!{client.user.id}>", "").strip()

        if not text:
            return

        user_id = message.author.id
        username = str(message.author)
        is_owner = owner_user_id is not None and user_id == owner_user_id

        # Use channel-specific thread for servers, user-specific for DMs
        if is_dm:
            thread_id = f"discord_dm_{user_id}"
        else:
            thread_id = f"discord_{message.channel.id}"

        context_info = {
            "channel": "discord",
            "sender": username,
            "sender_id": str(user_id),
            "is_owner": is_owner,
            "is_dm": is_dm,
            "server": message.guild.name if message.guild else None,
            "channel_name": getattr(message.channel, "name", "DM"),
        }

        logger.info(
            "Discord message from %s (%s) in %s: %s",
            username,
            user_id,
            context_info.get("channel_name"),
            text[:80],
        )

        try:
            async with message.channel.typing():
                response = await agent.run_async(
                    text,
                    thread_id=thread_id,
                    context=context_info,
                )

            if response:
                # Split long messages (Discord limit is 2000 chars)
                for i in range(0, len(response), 2000):
                    await message.channel.send(response[i : i + 2000])
        except Exception as e:
            logger.error("Error processing Discord message: %s", e)
            try:
                await message.channel.send(
                    "Sorry, I encountered an error processing your message."
                )
            except Exception:
                pass

    # Store client on agent for sender access
    agent._discord_client = client

    logger.info("Discord listener starting...")

    try:
        await client.start(bot_token)
    except asyncio.CancelledError:
        await client.close()
    except Exception as e:
        logger.error("Discord listener error: %s", e)
        await client.close()
