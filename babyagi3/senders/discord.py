"""
Discord Sender - Send messages via Discord Bot.

Requires DISCORD_BOT_TOKEN and an active Discord listener.
The sender reuses the Discord client from the listener.
"""

import logging

logger = logging.getLogger(__name__)


class DiscordSender:
    """Sender that sends messages via Discord Bot."""

    name = "discord"
    capabilities = ["text", "embeds"]

    def __init__(self, config: dict = None):
        self.config = config or {}
        self._agent = None

    def set_agent(self, agent):
        """Store agent reference to access the shared Discord client."""
        self._agent = agent

    async def send(self, to: str, content: str, **kwargs) -> dict:
        """Send a Discord message.

        Args:
            to: Discord channel ID or user ID (for DMs)
            content: Message text
            is_dm: If True, send as DM to user ID

        Returns:
            dict with sent status
        """
        client = getattr(self._agent, "_discord_client", None) if self._agent else None
        if not client or not client.is_ready():
            return {"error": "Discord bot not connected. Ensure the Discord listener is running."}

        is_dm = kwargs.get("is_dm", False)

        try:
            if is_dm:
                user = await client.fetch_user(int(to))
                dm_channel = await user.create_dm()
                target = dm_channel
            else:
                target = client.get_channel(int(to))
                if not target:
                    target = await client.fetch_channel(int(to))

            if not target:
                return {"error": f"Could not find Discord channel/user: {to}"}

            # Split long messages (Discord limit is 2000 chars)
            msg = None
            for i in range(0, len(content), 2000):
                msg = await target.send(content[i : i + 2000])

            return {
                "sent": True,
                "channel": "discord",
                "to": to,
                "message_id": msg.id if msg else None,
            }
        except Exception as e:
            logger.error("Discord send error: %s", e)
            return {"error": str(e)}
