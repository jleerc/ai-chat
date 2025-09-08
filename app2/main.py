import os
import asyncio
import json
import base64
import warnings

from pathlib import Path
from dotenv import load_dotenv

from google.genai.types import (
    Part,
    Content,
    Blob,
)

from google.adk.runners import InMemoryRunner
from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.genai import types

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from csagent.agent import root_agent as csagent_root_agent  

warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

#
# ADK Streaming
#

# Load Gemini API Key
load_dotenv()

APP_NAME = "ADK LiveAPI Demo"


async def start_agent_session(user_id, is_audio=False):
    """Starts an agent session"""

    # Create a Runner
    runner = InMemoryRunner(
        app_name=APP_NAME,
        agent=csagent_root_agent,
    )

    # Create a Session
    session = await runner.session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,  # Replace with actual user ID
    )

    # Set response modality
    # Live models expect a single response modality
    run_config = RunConfig(
        response_modalities=["AUDIO"],
        session_resumption=types.SessionResumptionConfig()
    )

    # Create a LiveRequestQueue for this session
    live_request_queue = LiveRequestQueue()

    # Start agent session
    live_events = runner.run_live(
        session=session,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )
    return live_events, live_request_queue


async def agent_to_client_messaging(websocket, live_events):
    """Agent to client communication"""
    async for event in live_events:

        # If the turn complete or interrupted, send it
        if event.turn_complete or event.interrupted:
            message = {
                "turn_complete": event.turn_complete,
                "interrupted": event.interrupted,
            }
            await websocket.send_text(json.dumps(message))
            print(f"[AGENT TO CLIENT]: {message}")
            continue

        # Read the Content and its first Part
        part: Part = (
            event.content and event.content.parts and event.content.parts[0]
        )
        if not part:
            continue

        # If it's audio, send Base64 encoded audio data
        is_audio = part.inline_data and part.inline_data.mime_type.startswith("audio/pcm")
        if is_audio:
            audio_data = part.inline_data and part.inline_data.data
            if audio_data:
                message = {
                    "mime_type": "audio/pcm",
                    "data": base64.b64encode(audio_data).decode("ascii")
                }
                await websocket.send_text(json.dumps(message))
                print(f"[AGENT TO CLIENT]: audio/pcm: {len(audio_data)} bytes.")
                continue

        # If it's text, send partials and finals alike
        if part.text:
            message = {
                "mime_type": "text/plain",
                "data": part.text
            }
            await websocket.send_text(json.dumps(message))
            print(f"[AGENT TO CLIENT]: text/plain: {message}")


# Connection-scoped state for end-of-utterance handling
class WsSessionState:
    def __init__(self, queue: LiveRequestQueue):
        self.queue = queue
        self.activity_started = False
        self.silence_task = None
        self.last_image_ts = None

    def cancel_silence_task(self):
        if self.silence_task and not self.silence_task.done():
            self.silence_task.cancel()
        self.silence_task = None


async def client_to_agent_messaging(websocket, state: 'WsSessionState'):
    """Client to agent communication"""
    while True:
        # Decode JSON message
        message_json = await websocket.receive_text()
        message = json.loads(message_json)
        mime_type = message["mime_type"]
        data = message["data"]

        # Send the message to the agent
        if mime_type == "text/plain":
            # Send a text message
            content = Content(role="user", parts=[Part.from_text(text=data)])
            state.queue.send_content(content=content)
            print(f"[CLIENT TO AGENT]: {data}")
        elif mime_type.startswith("audio/pcm"):
            # Send audio data; mark start/end of utterance using a short silence window
            decoded_data = base64.b64decode(data)
            if not state.activity_started:
                state.activity_started = True
                state.queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))
            else:
                state.queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))

            # Schedule end-of-utterance if no more audio arrives within 200ms
            state.cancel_silence_task()

            async def end_after_silence():
                try:
                    await asyncio.sleep(0.2)
                    state.activity_started = False
                except asyncio.CancelledError:
                    pass

            state.silence_task = asyncio.create_task(end_after_silence())
        elif mime_type.startswith("image/"):
            # Screen-share frames (rate limit to avoid backpressure)
            now = asyncio.get_event_loop().time()
            if state.last_image_ts is None or (now - state.last_image_ts) >= 1.5:
                decoded_data = base64.b64decode(data)
                state.queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))
                state.last_image_ts = now
        else:
            raise ValueError(f"Mime type not supported: {mime_type}")


#
# FastAPI web app
#

app = FastAPI()

STATIC_DIR = Path("static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root():
    """Serves the index.html"""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, is_audio: str):
    """Client websocket endpoint"""

    # Wait for client connection
    await websocket.accept()
    print(f"Client #{user_id} connected, audio mode: {is_audio}")

    # Start agent session
    user_id_str = str(user_id)
    live_events, live_request_queue = await start_agent_session(user_id_str, is_audio == "true")
    state = WsSessionState(live_request_queue)

    # Start tasks
    agent_to_client_task = asyncio.create_task(
        agent_to_client_messaging(websocket, live_events)
    )
    client_to_agent_task = asyncio.create_task(
        client_to_agent_messaging(websocket, state)
    )

    # Wait until the websocket is disconnected or an error occurs
    tasks = [agent_to_client_task, client_to_agent_task]
    await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)

    # Close LiveRequestQueue and cancel timers
    state.cancel_silence_task()
    live_request_queue.close()

    # Disconnected
    print(f"Client #{user_id} disconnected")