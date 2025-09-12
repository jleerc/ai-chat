"""Tools module for the customer service agent."""

import logging
import uuid
from datetime import datetime, timedelta
from google.adk.tools import ToolContext

import asyncio

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from google.adk.tools import VertexAiSearchTool

logger = logging.getLogger(__name__)

# ____________________________________________________________ #
### -- Knowledge Search Tool -- ###
# Replace with your Vertex AI Search Datastore ID, and respective region (e.g. us-central1 or global).
# Format: projects/<PROJECT_ID>/locations/<REGION>/collections/default_collection/dataStores/<DATASTORE_ID>
DATASTORE_PATH = "projects/supportbotiva/locations/global/collections/default_collection/dataStores/ringcentral-help-center_1756491818728"

# Constants
APP_NAME_VSEARCH = "mmtest"
USER_ID_VSEARCH = "user_vsearch_1"
SESSION_ID_VSEARCH = "session_vsearch_1"
AGENT_NAME_VSEARCH = "doc_qa_agent"
GEMINI_2_FLASH = "gemini-2.0-flash"

# Tool Instantiation
# You MUST provide your datastore ID here.
vertex_search_tool = VertexAiSearchTool(data_store_id=DATASTORE_PATH)

# Agent Definition
doc_qa_agent = LlmAgent(
    name=AGENT_NAME_VSEARCH,
    model=GEMINI_2_FLASH, # Requires Gemini model
    tools=[vertex_search_tool],
    instruction=f"""You are a helpful assistant that answers questions based on information found in the document store: {DATASTORE_PATH}.
    Use the search tool to find relevant information before answering.
    If the answer isn't in the documents, say that you couldn't find the information.
    """,
    description="Answers questions using a specific Vertex AI Search datastore.",
)

# Session and Runner Setup
session_service_vsearch = InMemorySessionService()
runner_vsearch = Runner(
    agent=doc_qa_agent, app_name=APP_NAME_VSEARCH, session_service=session_service_vsearch
)

# Agent Interaction Function
async def call_vsearch_agent_async(query):
    print("\n--- Running Vertex AI Search Agent ---")
    print(f"Query: {query}")
    if "DATASTORE_PATH_HERE" in DATASTORE_PATH:
        print("Skipping execution: Please replace DATASTORE_PATH_HERE with your actual datastore ID.")
        print("-" * 30)
        return

    # Ensure session exists; create it if needed
    await session_service_vsearch.create_session(
        app_name=APP_NAME_VSEARCH,
        user_id=USER_ID_VSEARCH,
        session_id=SESSION_ID_VSEARCH,
    )

    content = types.Content(role='user', parts=[types.Part(text=query)])
    final_response_text = "No response received."
    try:
        async for event in runner_vsearch.run_async(
            user_id=USER_ID_VSEARCH, session_id=SESSION_ID_VSEARCH, new_message=content
        ):
            # Like Google Search, results are often embedded in the model's response.
            if event.is_final_response() and event.content and event.content.parts:
                final_response_text = event.content.parts[0].text.strip()
                print(f"Agent Response: {final_response_text}")
                # You can inspect event.grounding_metadata for source citations
                if event.grounding_metadata:
                    print(f"  (Grounding metadata found with {len(event.grounding_metadata.grounding_attributions)} attributions)")

    except Exception as e:
        print(f"An error occurred: {e}")
        print("Ensure your datastore ID is correct and the service account has permissions.")
    print("-" * 30)

# --- Run Example ---
async def run_vsearch_example():
    # Replace with a question relevant to YOUR datastore content
    await call_vsearch_agent_async("Summarize the main points about the Q2 strategy document.")
    await call_vsearch_agent_async("What safety procedures are mentioned for lab X?")

if __name__ == "__main__":
    try:
        asyncio.run(run_vsearch_example())
    except RuntimeError as e:
        if "cannot be called from a running event loop" in str(e):
            print("Skipping execution in running event loop (like Colab/Jupyter). Run locally.")
        else:
            raise e
