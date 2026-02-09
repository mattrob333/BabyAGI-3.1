import os

from tools import tool, tool_error
from tools.optional.http_utils import request_json


@tool(env=["FIRECRAWL_API_KEY"], packages=["httpx"])
def firecrawl_search(query: str, num_results: int = 5) -> dict:
    """Search the web using FireCrawl's search API. Returns scraped content from search results.

    Args:
        query: Search query string
        num_results: Maximum number of results to return (default 5)
    """
    api_key = os.getenv("FIRECRAWL_API_KEY")
    if not api_key:
        return tool_error("FIRECRAWL_API_KEY is not set")

    payload = {
        "query": query,
        "limit": num_results,
        "scrapeOptions": {"formats": ["markdown"]},
    }
    return request_json(
        "POST",
        "https://api.firecrawl.dev/v1/search",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json_body=payload,
        timeout=60.0,
    )


@tool(env=["FIRECRAWL_API_KEY"], packages=["httpx"])
def firecrawl_scrape(url: str) -> dict:
    """Scrape a single URL using FireCrawl and return its content as markdown.

    Args:
        url: The URL to scrape
    """
    api_key = os.getenv("FIRECRAWL_API_KEY")
    if not api_key:
        return tool_error("FIRECRAWL_API_KEY is not set")

    payload = {
        "url": url,
        "formats": ["markdown"],
    }
    return request_json(
        "POST",
        "https://api.firecrawl.dev/v1/scrape",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json_body=payload,
        timeout=60.0,
    )
