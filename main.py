import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any
from anthropic import Anthropic
from duckduckgo_search import DDGS

# ==========================================
# 1. SETUP & CONFIGURATION
# ==========================================
app = FastAPI()

# Make sure to set your Anthropic API Key in your terminal before running!
# Mac/Linux: export ANTHROPIC_API_KEY="sk-ant-..."
# Windows: set ANTHROPIC_API_KEY="sk-ant-..."
api_key = os.getenv("ANTHROPIC_API_KEY")
if not api_key:
    print("⚠️ WARNING: ANTHROPIC_API_KEY environment variable not set!")

client = Anthropic(api_key=api_key)

# ==========================================
# 2. DATA MODELS (What the frontend sends)
# ==========================================
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    system: str
    web_search: bool
    code_mode: bool

# ==========================================
# 3. WEB SEARCH TOOL (DuckDuckGo)
# ==========================================
def search_web(query: str) -> str:
    """Performs a live web search using DuckDuckGo."""
    print(f"🔍 Searching the web for: {query}")
    try:
        results = DDGS().text(query, max_results=4)
        if not results:
            return "No results found."
        
        # Format results for Claude to read
        formatted_results = "\n\n".join([f"Title: {r['title']}\nSnippet: {r['body']}" for r in results])
        return formatted_results
    except Exception as e:
        return f"Search failed: {str(e)}"

# Define the tool structure for Claude
SEARCH_TOOL = {
    "name": "search_web",
    "description": "Search the web for real-time information, recent events, or tech trends.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to look up (e.g., 'Latest React features 2026')"
            }
        },
        "required": ["query"]
    }
}

# ==========================================
# 4. ENDPOINTS
# ==========================================

# Serve the HTML frontend
@app.get("/")
async def serve_frontend():
    return FileResponse("index.html")

# Handle chat requests
@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    try:
        # Convert Pydantic messages to a list of dicts for Anthropic
        anthropic_messages = [{"role": m.role, "content": m.content} for m in request.messages]
        
        # Determine if we should give Claude the Search Tool
        tools = [SEARCH_TOOL] if request.web_search else []

        # 1st API Call to Claude
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022", # Latest Claude 3.5 Sonnet
            max_tokens=2048,
            system=request.system,
            messages=anthropic_messages,
            tools=tools
        )

        # ---------------------------------------------------------
        # TOOL USE LOOP: Did Claude decide to search the web?
        # ---------------------------------------------------------
        while response.stop_reason == "tool_use":
            # Extract Claude's tool call request
            tool_call = next(b for b in response.content if b.type == "tool_use")
            
            if tool_call.name == "search_web":
                query = tool_call.input["query"]
                search_results = search_web(query)
                
                # Append Claude's thought process to our message history
                anthropic_messages.append({"role": "assistant", "content": response.content})
                
                # Append the raw search results back to Claude
                anthropic_messages.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_call.id,
                            "content": search_results
                        }
                    ]
                })

                # 2nd API Call: Claude reads the search results and generates a final answer
                response = client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=2048,
                    system=request.system,
                    messages=anthropic_messages,
                    tools=tools
                )

        # Extract the final text reply
        final_text = next((block.text for block in response.content if block.type == "text"), "No response.")
        
        return {"reply": final_text}

    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Run the server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
