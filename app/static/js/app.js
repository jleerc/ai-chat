/**
 * app.js: JS code for the adk-streaming sample app.
 */

/**
 * SSE (Server-Sent Events) handling
 */

// Connect the server with SSE
const sessionId = Math.random().toString().substring(10);
const sse_url =
  "http://" + window.location.host + "/events/" + sessionId;
const send_url =
  "http://" + window.location.host + "/send/" + sessionId;
let eventSource = null;
let is_audio = false;
let is_screen_sharing = false;

// Get DOM elements
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("message");
const messagesDiv = document.getElementById("messages");
let currentMessageId = null;

function setAgentState(state) {
  const el = document.getElementById("agentState");
  if (!el) return;
  const dot = el.querySelector('.dot');
  const label = el.querySelector('.label');
  if (!dot || !label) return;
  dot.classList.remove('idle','listening','thinking','talking');
  if (state === 'listening') { dot.classList.add('listening'); label.textContent = 'Listening'; }
  else if (state === 'thinking') { dot.classList.add('thinking'); label.textContent = 'Thinking'; }
  else if (state === 'talking') { dot.classList.add('talking'); label.textContent = 'Talking'; }
  else { dot.classList.add('idle'); label.textContent = 'Idle'; }
}

// SSE handlers
function connectSSE() {
  // Connect to SSE endpoint
  eventSource = new EventSource(sse_url + "?is_audio=" + is_audio);

  // Handle connection open
  eventSource.onopen = function () {
    // Connection opened messages
    console.log("SSE connection opened.");
    document.getElementById("messages").textContent = "Connection opened";

    // Enable the Send button
    document.getElementById("sendButton").disabled = false;
    addSubmitHandler();
    setAgentState('idle');
  };

  // Handle incoming messages
  eventSource.onmessage = function (event) {
    // Parse the incoming message
    const message_from_server = JSON.parse(event.data);
    console.log("[AGENT TO CLIENT] ", message_from_server);

    // Check if the turn is complete
    // if turn complete, add new message
    if (
      message_from_server.turn_complete &&
      message_from_server.turn_complete == true
    ) {
      currentMessageId = null;
      setAgentState('idle');
      return;
    }

    // Check for interrupt message
    if (
      message_from_server.interrupted &&
      message_from_server.interrupted === true
    ) {
      // Stop audio playback if it's playing
      if (audioPlayerNode) {
        audioPlayerNode.port.postMessage({ command: "endOfAudio" });
      }
      setAgentState('idle');
      return;
    }

    // If it's audio, play it
    if (message_from_server.mime_type == "audio/pcm" && audioPlayerNode) {
      audioPlayerNode.port.postMessage(base64ToArray(message_from_server.data));
      setAgentState('talking');
    }

    // If it's a text, print it
    if (message_from_server.mime_type == "text/plain") {
      // add a new message for a new turn
      if (currentMessageId == null) {
        currentMessageId = Math.random().toString(36).substring(7);
        const message = document.createElement("p");
        message.id = currentMessageId;
        // Append the message element to the messagesDiv
        messagesDiv.appendChild(message);
      }

      // Add message text to the existing message element
      const message = document.getElementById(currentMessageId);
      message.textContent += message_from_server.data;

      // Scroll down to the bottom of the messagesDiv
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      // Mirror agent text to agent transcript panel
      const agentTranscript = document.getElementById("agentTranscript");
      if (agentTranscript) {
        agentTranscript.textContent += message_from_server.data;
      }
      setAgentState('talking');
    }
  };

  // Handle connection close
  eventSource.onerror = function (event) {
    console.log("SSE connection error or closed.");
    document.getElementById("sendButton").disabled = true;
    document.getElementById("messages").textContent = "Connection closed";
    eventSource.close();
    setTimeout(function () {
      console.log("Reconnecting...");
      connectSSE();
    }, 5000);
  };
}
connectSSE();

// Add submit handler to the form
function addSubmitHandler() {
  messageForm.onsubmit = function (e) {
    e.preventDefault();
    const message = messageInput.value;
    if (message) {
      const p = document.createElement("p");
      p.textContent = "> " + message;
      messagesDiv.appendChild(p);
      messageInput.value = "";
      sendMessage({
        mime_type: "text/plain",
        data: message,
      });
      console.log("[CLIENT TO AGENT] " + message);
      setAgentState('thinking');
    }
    return false;
  };
}

// Send a message to the server via HTTP POST
async function sendMessage(message) {
  try {
    const response = await fetch(send_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message)
    });
    
    if (!response.ok) {
      console.error('Failed to send message:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Decode Base64 data to Array
function base64ToArray(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Audio handling
 */

let audioPlayerNode;
let audioPlayerContext;
let audioRecorderNode;
let audioRecorderContext;
let micStream;
let speechRecognition;
let is_asr_active = false;
let listeningSilenceTimer = null;

// Audio buffering (tuned for lower latency)
let audioBuffer = [];
let bufferTimer = null;
let selectedMicrophoneId = null;
const MIN_SEND_INTERVAL_MS = 20; // smaller chunks for faster partials
const MIN_SEND_BYTES = 640;      // ~20ms @ 16kHz, 16-bit mono

// Import the audio worklets
import { startAudioPlayerWorklet } from "./audio-player.js";
import { startAudioRecorderWorklet, getAudioInputDevices, selectMicrophone } from "./audio-recorder.js";


// Start audio
async function startAudio() {
  try {
    // Always show microphone selection dialog
    selectedMicrophoneId = await selectMicrophone();
    
    // Start audio output
    startAudioPlayerWorklet().then(([node, ctx]) => {
      audioPlayerNode = node;
      audioPlayerContext = ctx;
    });
    
    // Start audio input with selected microphone
    startAudioRecorderWorklet(audioRecorderHandler, selectedMicrophoneId).then(
      ([node, ctx, stream]) => {
        audioRecorderNode = node;
        audioRecorderContext = ctx;
        micStream = stream;
      }
    ).catch(error => {
      console.error('Error starting audio recorder:', error);
      alert('Failed to start microphone: ' + error.message);
      // Re-enable the start button if there was an error
      startAudioButton.disabled = false;
    });
  } catch (error) {
    console.error('Error selecting microphone:', error);
    if (error.message !== 'Microphone selection cancelled') {
      alert('Failed to select microphone: ' + error.message);
    }
    // Re-enable the start button if there was an error
    startAudioButton.disabled = false;
  }
}

// Start the audio only when the user clicked the button
// (due to the gesture requirement for the Web Audio API)
const startAudioButton = document.getElementById("startAudioButton");
const stopAudioButton = document.getElementById("stopAudioButton");
const startScreenButton = document.getElementById("startScreenButton");
const stopScreenButton = document.getElementById("stopScreenButton");
const screenPreview = document.getElementById("screenPreview");
startAudioButton.addEventListener("click", () => {
  startAudioButton.disabled = true;
  startAudio();
  is_audio = true;
  eventSource.close(); // close current connection
  connectSSE(); // reconnect with the audio mode
  stopAudioButton.disabled = false;
  startUserASR();
});

// Stop audio (mic + buffering)
stopAudioButton.addEventListener("click", () => {
  stopAudioButton.disabled = true;
  try {
    stopAudioRecording();
    if (micStream) {
      // Stop microphone tracks and clear
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (audioRecorderContext) {
      audioRecorderContext.close();
      audioRecorderContext = null;
    }
  } catch (e) {
    console.warn("stopAudioRecording error:", e);
  }
  // Switch back to text mode
  is_audio = false;
  eventSource.close();
  connectSSE();
  startAudioButton.disabled = false;
  stopUserASR();
});

// Audio recorder handler
function audioRecorderHandler(pcmData) {
  // Add audio data to buffer
  audioBuffer.push(new Uint8Array(pcmData));
  setAgentState('listening');
  if (listeningSilenceTimer) {
    clearTimeout(listeningSilenceTimer);
    listeningSilenceTimer = null;
  }
  listeningSilenceTimer = setTimeout(() => {
    setAgentState('thinking');
  }, 120);
  
  // Start timer if not already running (lower interval for lower latency)
  if (!bufferTimer) {
    bufferTimer = setInterval(sendBufferedAudio, MIN_SEND_INTERVAL_MS);
    // Send immediately so the model starts responding sooner
    sendBufferedAudio();
  }

  // If we've accumulated enough data for ~50ms, flush immediately
  let pendingBytes = 0;
  for (const chunk of audioBuffer) pendingBytes += chunk.length;
  if (pendingBytes >= MIN_SEND_BYTES) {
    sendBufferedAudio();
  }
}

// Send buffered audio data every 0.2 seconds
function sendBufferedAudio() {
  if (audioBuffer.length === 0) {
    return;
  }
  
  // Calculate total length
  let totalLength = 0;
  for (const chunk of audioBuffer) {
    totalLength += chunk.length;
  }
  
  // Combine all chunks into a single buffer
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioBuffer) {
    combinedBuffer.set(chunk, offset);
    offset += chunk.length;
  }
  
  // Send the combined audio data with explicit sample rate for Live API
  sendMessage({
    mime_type: "audio/pcm;rate=16000",
    data: arrayBufferToBase64(combinedBuffer.buffer),
  });
  console.log("[CLIENT TO AGENT] sent %s bytes", combinedBuffer.byteLength);
  
  // Clear the buffer
  audioBuffer = [];
}

// Stop audio recording and cleanup
function stopAudioRecording() {
  if (bufferTimer) {
    clearInterval(bufferTimer);
    bufferTimer = null;
  }
  if (listeningSilenceTimer) {
    clearTimeout(listeningSilenceTimer);
    listeningSilenceTimer = null;
  }
  
  // Send any remaining buffered audio
  if (audioBuffer.length > 0) {
    sendBufferedAudio();
  }
}

/**
 * Web Speech API (user ASR)
 */
function startUserASR() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Web Speech API not supported in this browser.");
    return;
  }
  if (is_asr_active) return;
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = "en-US";
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interimText += res[0].transcript;
    }
    const userTranscript = document.getElementById("userTranscript");
    const userTranscriptInterim = document.getElementById("userTranscriptInterim");
    if (userTranscript && finalText) userTranscript.textContent += finalText + "\n";
    if (userTranscriptInterim) userTranscriptInterim.textContent = interimText;
  };
  speechRecognition.onerror = (e) => console.warn("ASR error", e);
  speechRecognition.onend = () => {
    // Auto-restart if still active for resilience
    if (is_asr_active) {
      try { speechRecognition.start(); } catch {}
    }
  };
  try {
    speechRecognition.start();
    is_asr_active = true;
  } catch (e) {
    console.warn("ASR start failed", e);
  }
}

function stopUserASR() {
  is_asr_active = false;
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch {}
    speechRecognition = null;
  }
  const userTranscriptInterim = document.getElementById("userTranscriptInterim");
  if (userTranscriptInterim) userTranscriptInterim.textContent = "";
}

// Encode an array buffer with Base64
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Screen share handling (getDisplayMedia)
 */
let screenStream;
let screenCaptureInterval;

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    is_screen_sharing = true;
    screenPreview.srcObject = screenStream;
    screenPreview.style.display = "block";
    startScreenButton.disabled = true;
    stopScreenButton.disabled = false;

    const track = screenStream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);

    // Capture and send a frame every ~1s
    screenCaptureInterval = setInterval(async () => {
      if (!is_screen_sharing) return;
      try {
        const bitmap = await imageCapture.grabFrame();
        const canvas = document.createElement("canvas");
        // Scale down to reduce payload size
        const targetW = Math.min(1280, bitmap.width);
        const targetH = Math.round((bitmap.height / bitmap.width) * targetW);
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        // Encode as JPEG with moderate quality to control size
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
        const base64Data = dataUrl.split(",")[1];
        sendMessage({
          mime_type: "image/jpeg",
          data: base64Data,
        });
      } catch (e) {
        console.error("Error capturing screen frame:", e);
      }
    }, 1000);
  } catch (err) {
    console.error("Failed to start screen share:", err);
    is_screen_sharing = false;
    startScreenButton.disabled = false;
    stopScreenButton.disabled = true;
  }
}

function stopScreenShare() {
  is_screen_sharing = false;
  if (screenCaptureInterval) {
    clearInterval(screenCaptureInterval);
    screenCaptureInterval = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  screenPreview.srcObject = null;
  screenPreview.style.display = "none";
  startScreenButton.disabled = false;
  stopScreenButton.disabled = true;
}

startScreenButton.addEventListener("click", startScreenShare);
stopScreenButton.addEventListener("click", stopScreenShare);
