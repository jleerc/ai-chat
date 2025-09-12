import os
import uuid
import base64
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import VertexAiSearchTool
from google.genai import types

import requests
from google.auth.transport.requests import Request as GAuthRequest
import google.auth

load_dotenv()

GOOGLE_GENAI_USE_VERTEXAI = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
CSAGENT_MODEL = os.getenv("CSAGENT_MODEL", "gemini-2.0-flash-exp")

DATASTORE_PATH = (
    "projects/supportbotiva/locations/global/collections/default_collection/dataStores/"
    "ringcentral-help-center_1756491818728"
)

vertex_search_tool = VertexAiSearchTool(data_store_id=DATASTORE_PATH)

class CustomerProfile(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    plan: Optional[str] = None
    purchases: Optional[list] = None
    location: Optional[str] = None

    def to_json(self) -> str:
        return self.model_dump_json()

CURRENT_CUSTOMER = CustomerProfile(
    id="cust_123",
    name="Alex Parker",
    email="alex.parker@example.com",
    plan="RingCentral MVP",
    purchases=["RingCentral Phone", "RingCentral Video"],
    location="San Francisco, CA",
)

GLOBAL_INSTRUCTION = f"""
The profile of the current customer is:  {CURRENT_CUSTOMER.to_json()}
"""

INSTRUCTION = """
You are a RingCentral support agent. Your task is to help customers troubleshoot or set up RingCentral products. 
You MUST ONLY use the provided datastore to answer questions. 
Always include the link to the relevant article in your response. 
The link should always come directly from the datastore and be the exact link provided. 
Do not create your own link. 
Use the context from the conversation so far to rewrite the query you use to search the database for the most accurate response.
Always use conversation context/state or tools to get information. Prefer tools over your own internal knowledge

**Core Capabilities:**

1.  **Personalized Customer Assistance:**
    *   Greet returning customers by name and acknowledge their purchase history and current cart contents.  Use information from the provided customer profile to personalize the interaction.
    *   Maintain a friendly, empathetic, and helpful tone.

2.  **Customer Support and Engagement:**
    *   Send RingCentral support instructions relevant to the customer's purchases and location.
    *   Offer support articles or suggestions based on the conversation so far.
    *   View the user's screen when they screen share.
    *   Respond to the user via voice or text. When using the user is using voice, you should respond via voice. When using text, you should respond via text. 
    *   Don't read urls aloud.
    *   Use the prior conversation context and screen sharing to answer the question.

**Tools:**
You have access to the following tools to assist you:

*   call_vsearch_agent_async: Searches the RingCentral support database for the most relevant article based on the conversation so far.

**Constraints:**

*   Never mention "tool_code", "tool_outputs", or "print statements" to the user. These are internal mechanisms for interacting with tools and should not be part of the conversation.  Focus solely on providing a natural and helpful customer experience.  Do not reveal the underlying implementation details.
*   Always confirm actions with the user before executing them.
*   Be proactive in offering help and anticipating customer needs.
*   Don't output code even if user asks for it.
"""

customer_service_agent = LlmAgent(
    name="customer_service_agent",
    model=CSAGENT_MODEL,
    tools=[vertex_search_tool],
    instruction=GLOBAL_INSTRUCTION + "\n" + INSTRUCTION,
    description="RingCentral support assistant using Vertex AI Search datastore.",
)

session_service = InMemorySessionService()
runner = Runner(agent=customer_service_agent, app_name="adk_support_app", session_service=session_service)

app = FastAPI(title="ADK Multimodal Support App", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None

class ChatResponse(BaseModel):
    session_id: str
    response: str

@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    user_id = req.user_id or "user_1"

    await session_service.create_session(app_name="adk_support_app", user_id=user_id, session_id=session_id)

    content = types.Content(role='user', parts=[types.Part(text=req.message)])
    final_text = ""
    async for event in runner.run_async(user_id=user_id, session_id=session_id, new_message=content):
        if event.is_final_response() and event.content and event.content.parts:
            final_text = event.content.parts[0].text or ""
    return ChatResponse(session_id=session_id, response=final_text)

@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    user_id = "user_ws"
    await session_service.create_session(app_name="adk_support_app", user_id=user_id, session_id=session_id)
    try:
        while True:
            text = await websocket.receive_text()
            content = types.Content(role='user', parts=[types.Part(text=text)])
            async for event in runner.run_async(user_id=user_id, session_id=session_id, new_message=content):
                if event.is_final_response() and event.content and event.content.parts:
                    await websocket.send_text(event.content.parts[0].text or "")
    except WebSocketDisconnect:
        pass

class ScreenNote(BaseModel):
    note: Optional[str] = None

@app.post("/api/screen/frame")
async def screen_frame(file: UploadFile = File(...), note: Optional[str] = Form(None), session_id: Optional[str] = Form(None)):
    sid = session_id or str(uuid.uuid4())
    await session_service.create_session(app_name="adk_support_app", user_id="user_screen", session_id=sid)
    filename = file.filename or "frame.jpg"
    data = await file.read()
    b64 = base64.b64encode(data[:4096]).decode("utf-8")
    caption = note or "Screen frame shared by user."
    text = f"User shared a screen frame: {filename}. Thumbnail (first 4KB b64): {b64[:120]}... Caption: {caption}"
    content = types.Content(role='user', parts=[types.Part(text=text)])
    final_text = ""
    async for event in runner.run_async(user_id="user_screen", session_id=sid, new_message=content):
        if event.is_final_response() and event.content and event.content.parts:
            final_text = event.content.parts[0].text or ""
    return {"session_id": sid, "ack": True, "response": final_text}

@app.post("/api/live/sdp")
async def live_sdp(request: Request):
    offer_sdp = await request.body()
    if not offer_sdp:
        return Response(status_code=400, content="Missing SDP offer")

    use_vertex = (GOOGLE_GENAI_USE_VERTEXAI or "TRUE").upper() == "TRUE"

    if use_vertex:
        # Acquire access token via ADC
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        credentials.refresh(GAuthRequest())
        token = credentials.token
        url = f"https://{GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1/projects/{GOOGLE_CLOUD_PROJECT}/locations/{GOOGLE_CLOUD_LOCATION}/publishers/google/models/{CSAGENT_MODEL}:streamGenerateContent?alt=sdp"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/sdp"}
        resp = requests.post(url, data=offer_sdp, headers=headers, timeout=30)
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/sdp")
    else:
        # Google AI Studio API key flow
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{CSAGENT_MODEL}:streamGenerateContent?alt=sdp&key={GOOGLE_API_KEY}"
        headers = {"Content-Type": "application/sdp"}
        resp = requests.post(url, data=offer_sdp, headers=headers, timeout=30)
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/sdp")

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
