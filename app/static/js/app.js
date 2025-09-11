/**
 * Restored client: SSE connect, mic selection, audio send/playback, debug logs
 */

console.log('app.js loaded');

// ---- Session and endpoints ----
const sessionId = String(Date.now()); // numeric string to match /{user_id:int}
const sse_url = "http://" + window.location.host + "/events/" + sessionId;
const send_url = "http://" + window.location.host + "/send/" + sessionId;

let eventSource = null;
let is_audio = false;
let is_screen_sharing = false;
let screenStream;
const screenPreview = document.getElementById("screenPreview");
const startScreenButton = document.getElementById("startScreenButton");
const stopScreenButton = document.getElementById("stopScreenButton");

// ---- DOM ----
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("message");
const messagesDiv = document.getElementById("messages");
const startAudioButton = document.getElementById("startAudioButton");
const stopAudioButton = document.getElementById("stopAudioButton");
let currentMessageId = null;
let lastAgentMsgAt = 0;

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

// ---- SSE ----
function connectSSE() {
	if (eventSource) try { eventSource.close(); } catch {}
	eventSource = new EventSource(sse_url + "?is_audio=" + is_audio);

	eventSource.onopen = function () {
		console.log("SSE connection opened.");
		if (messagesDiv) messagesDiv.textContent = "Connection opened";
		const sendBtn = document.getElementById("sendButton");
		if (sendBtn) sendBtn.disabled = false;
		addSubmitHandler();
		setAgentState('idle');
	};

	eventSource.onmessage = function (event) {
		const message_from_server = JSON.parse(event.data);
		console.log("[AGENT TO CLIENT] ", message_from_server);
		lastAgentMsgAt = Date.now();

		if (message_from_server.turn_complete === true) {
			currentMessageId = null;
			setAgentState('idle');
			return;
		}

		if (message_from_server.interrupted === true) {
			if (audioPlayerNode) {
				audioPlayerNode.port.postMessage({ command: "endOfAudio" });
			}
			setAgentState('idle');
			return;
		}

		if (message_from_server.mime_type === "audio/pcm" && audioPlayerNode) {
			audioPlayerNode.port.postMessage(base64ToInt16(message_from_server.data));
			setAgentState('talking');
			return;
		}

		if (message_from_server.mime_type === "text/plain") {
			if (currentMessageId == null) {
				currentMessageId = Math.random().toString(36).substring(7);
				const p = document.createElement("p");
				p.id = currentMessageId;
				messagesDiv.appendChild(p);
			}
			const p = document.getElementById(currentMessageId);
			p.textContent += message_from_server.data;
			messagesDiv.scrollTop = messagesDiv.scrollHeight;
			setAgentState('talking');
		}
	};

	eventSource.onerror = function () {
		console.log("SSE connection error or closed.");
		const sendBtn = document.getElementById("sendButton");
		if (sendBtn) sendBtn.disabled = true;
		if (messagesDiv) messagesDiv.textContent = "Connection closed";
		try { eventSource && eventSource.close(); } catch {}
		setTimeout(connectSSE, 3000);
	};
}

// ---- Send text ----
function addSubmitHandler() {
	if (!messageForm) return;
	messageForm.onsubmit = function (e) {
		e.preventDefault();
		const message = messageInput.value;
		if (message) {
			const p = document.createElement("p");
			p.textContent = "> " + message;
			messagesDiv.appendChild(p);
			messageInput.value = "";
			sendMessage({ mime_type: "text/plain", data: message });
			console.log("[CLIENT TO AGENT] ", message);
			setAgentState('thinking');
		}
		return false;
	};
}

async function sendMessage(payload) {
	try {
		await fetch(send_url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	} catch (e) {
		console.error("sendMessage failed", e);
	}
}

// ---- Audio IO ----
import { startAudioPlayerWorklet } from "/static/js/audio-player.js";
import { startAudioRecorderWorklet } from "/static/js/audio-recorder.js";

let audioPlayerNode;
let audioPlayerContext;
let audioRecorderNode;
let audioRecorderContext;
let micStream;

let audioBuffer = [];
let bufferTimer = null;

function base64FromUint8(u8) {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < u8.length; i += chunk) {
		binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function base64ToInt16(b64) {
	const binary = atob(b64);
	const len = binary.length / 2;
	const out = new Int16Array(len);
	for (let i = 0; i < len; i++) {
		const lo = binary.charCodeAt(i * 2);
		const hi = binary.charCodeAt(i * 2 + 1);
		out[i] = (hi << 8) | lo;
	}
	return out;
}

function audioRecorderHandler(pcmData) {
	audioBuffer.push(new Uint8Array(pcmData));
	console.log("Audio data received:", pcmData.byteLength, "bytes");
	setAgentState('listening');
}

function startBufferedSender() {
	if (bufferTimer) return;
	bufferTimer = setInterval(() => {
		if (audioBuffer.length === 0) return;
		let total = 0;
		for (const chunk of audioBuffer) total += chunk.length;
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const chunk of audioBuffer) { merged.set(chunk, offset); offset += chunk.length; }
		audioBuffer = [];
		sendMessage({ mime_type: "audio/pcm;rate=16000", data: base64FromUint8(merged) });
	}, 80);
}

function stopBufferedSender() {
	if (bufferTimer) { clearInterval(bufferTimer); bufferTimer = null; }
}

// ---- Screen Share ----
let screenSenderTimer = null;
async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        is_screen_sharing = true;
        if (screenPreview) {
            screenPreview.srcObject = screenStream;
            screenPreview.style.display = 'block';
        }
        const track = screenStream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);
        // send a frame ~1/sec as JPEG
        screenSenderTimer = setInterval(async () => {
            if (!is_screen_sharing) return;
            try {
                const bitmap = await imageCapture.grabFrame();
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width; canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.75));
                const u8 = new Uint8Array(await blob.arrayBuffer());
                // post as image/jpeg
                await sendMessage({ mime_type: 'image/jpeg', data: base64FromUint8(u8) });
            } catch {}
        }, 1000);
        if (stopScreenButton) stopScreenButton.disabled = false;
    } catch (e) {
        console.error('Failed to start screen share', e);
    }
}

function stopScreenShare() {
    is_screen_sharing = false;
    if (screenSenderTimer) { clearInterval(screenSenderTimer); screenSenderTimer = null; }
    try { if (screenStream) screenStream.getTracks().forEach(t => t.stop()); } catch {}
    if (screenPreview) {
        screenPreview.srcObject = null;
        screenPreview.style.display = 'none';
    }
}

async function startAudio() {
	try {
		[audioPlayerNode, audioPlayerContext] = await startAudioPlayerWorklet();
		[audioRecorderNode, audioRecorderContext, micStream] = await startAudioRecorderWorklet(audioRecorderHandler);

		// derive selected deviceId from the stream
		let deviceId = null;
		try {
			const track = micStream && micStream.getAudioTracks && micStream.getAudioTracks()[0];
			const settings = track && track.getSettings ? track.getSettings() : {};
			const constraints = track && track.getConstraints ? track.getConstraints() : {};
			deviceId = (constraints.deviceId && constraints.deviceId.exact) || settings.deviceId || null;
		} catch {}
		if (deviceId) updateMicrophoneDisplay(deviceId);

		is_audio = true;
		if (eventSource) { try { eventSource.close(); } catch {} }
		connectSSE();
		startBufferedSender();
		stopAudioButton.disabled = false;
		console.log('Audio started with mic:', deviceId);
	} catch (e) {
		console.error('Failed to start audio', e);
		startAudioButton.disabled = false;
	}
}

function stopAudio() {
	stopBufferedSender();
	// flush any pending audio before stopping contexts
	if (audioBuffer && audioBuffer.length > 0) {
		let total = 0;
		for (const chunk of audioBuffer) total += chunk.length;
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const chunk of audioBuffer) { merged.set(chunk, offset); offset += chunk.length; }
		audioBuffer = [];
		sendMessage({ mime_type: "audio/pcm;rate=16000", data: base64FromUint8(merged) });
	}
	try { if (audioRecorderContext) audioRecorderContext.close(); } catch {}
	try { if (audioPlayerContext) audioPlayerContext.close(); } catch {}
	try { if (micStream) micStream.getTracks().forEach(t => t.stop()); } catch {}
	audioRecorderNode = audioRecorderContext = micStream = undefined;
	audioPlayerNode = audioPlayerContext = undefined;
	is_audio = false;
	sendMessage({ mime_type: "audio/pcm;rate=16000", data: "" });
	setAgentState('thinking');
	// Fallback: if no agent message arrives within ~1.2s, nudge again
	const snapshot = lastAgentMsgAt;
	setTimeout(() => {
		if (lastAgentMsgAt === snapshot) {
			// resend empty frame once to trigger finalization on server
			sendMessage({ mime_type: "audio/pcm;rate=16000", data: "" });
		}
	}, 1200);
}

function updateMicrophoneDisplay(deviceId) {
	const micState = document.getElementById('micState');
	const micName = document.getElementById('micName');
	if (!micState || !micName) return;
	if (!deviceId) { micState.style.display = 'none'; return; }
	navigator.mediaDevices.enumerateDevices().then(devices => {
		const d = devices.find(x => x.deviceId === deviceId);
		micName.textContent = d ? (d.label || ("Microphone " + deviceId.substring(0,8))) : deviceId.substring(0,8);
		micState.style.display = 'flex';
	});
}

if (startAudioButton) {
	startAudioButton.addEventListener('click', () => {
		startAudioButton.disabled = true;
		startAudio();
	});
}
if (stopAudioButton) {
	stopAudioButton.addEventListener('click', () => {
		stopAudioButton.disabled = true;
		stopAudio();
		setTimeout(() => { stopAudioButton.disabled = false; }, 300);
	});
}

if (startScreenButton) {
    startScreenButton.addEventListener('click', () => {
        startScreenShare();
    });
}
if (stopScreenButton) {
    stopScreenButton.addEventListener('click', () => {
        stopScreenShare();
        stopScreenButton.disabled = true;
    });
}

connectSSE();

window.addEventListener('beforeunload', () => { try { eventSource && eventSource.close(); } catch {} });