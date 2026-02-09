import os

from tools import tool, tool_error
from tools.optional.http_utils import request_json


@tool(env=["BRAVE_API_KEY"], packages=["httpx"])
def brave_web_search(query: str, count: int = 5) -> dict:
    """Search the web using Brave Search API. Fast, privacy-focused search.

    Args:
        query: Search query string
        count: Number of results to return (default 5, max 20)
    """
    api_key = os.getenv("BRAVE_API_KEY")
    if not api_key:
        return tool_error("BRAVE_API_KEY is not set")

    return request_json(
        "GET",
        "https://api.search.brave.com/res/v1/web/search",
        headers={
            "X-Subscription-Token": api_key,
            "Accept": "application/json",
        },
        params={"q": query, "count": min(count, 20)},
    )
