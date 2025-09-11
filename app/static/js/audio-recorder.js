/**
 * Audio Recorder Worklet
 */

let micStream;

// Function to get available audio input devices
export async function getAudioInputDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  } catch (error) {
    console.error('Error getting audio input devices:', error);
    return [];
  }
}

// Function to show microphone selection dialog
export async function selectMicrophone() {
  const devices = await getAudioInputDevices();
  
  if (devices.length === 0) {
    throw new Error('No audio input devices found');
  }
  
  if (devices.length === 1) {
    console.log('Only one microphone found, using it automatically');
    return devices[0].deviceId;
  }
  
  // Create a simple selection dialog
  const deviceNames = devices.map(device => device.label || `Microphone ${device.deviceId.substring(0, 8)}`);
  
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
    `;
    
    content.innerHTML = `
      <h3 style="color: white; margin: 0 0 16px 0; font-size: 18px;">Select Microphone</h3>
      <div style="margin-bottom: 16px;">
        ${devices.map((device, index) => `
          <label style="display: block; color: #d1d5db; margin-bottom: 8px; cursor: pointer;">
            <input type="radio" name="microphone" value="${device.deviceId}" ${index === 0 ? 'checked' : ''} 
                   style="margin-right: 8px;">
            ${device.label || `Microphone ${device.deviceId.substring(0, 8)}`}
          </label>
        `).join('')}
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="cancelMic" style="
          background: #374151;
          color: white;
          border: 1px solid #4b5563;
          border-radius: 6px;
          padding: 8px 16px;
          cursor: pointer;
        ">Cancel</button>
        <button id="selectMic" style="
          background: #3b82f6;
          color: white;
          border: 1px solid #2563eb;
          border-radius: 6px;
          padding: 8px 16px;
          cursor: pointer;
        ">Select</button>
      </div>
    `;
    
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    document.getElementById('selectMic').onclick = () => {
      const selected = document.querySelector('input[name="microphone"]:checked');
      if (selected) {
        document.body.removeChild(dialog);
        resolve(selected.value);
      }
    };
    
    document.getElementById('cancelMic').onclick = () => {
      document.body.removeChild(dialog);
      reject(new Error('Microphone selection cancelled'));
    };
  });
}

export async function startAudioRecorderWorklet(audioRecorderHandler, deviceId = null) {
  // Create an AudioContext
  const audioRecorderContext = new AudioContext({ sampleRate: 16000 });
  console.log("AudioContext sample rate:", audioRecorderContext.sampleRate);

  // Load the AudioWorklet module
  const workletURL = new URL("./pcm-recorder-processor.js", import.meta.url);
  await audioRecorderContext.audioWorklet.addModule(workletURL);

  // Get device ID if not provided
  if (!deviceId) {
    deviceId = await selectMicrophone();
  }

  // Request access to the microphone with selected device
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      latency: 0
    },
  });
  // Hint that this is speech to optimize pipeline
  try {
    const track = micStream.getAudioTracks()[0];
    if (track) track.contentHint = "speech";
  } catch {}
  const source = audioRecorderContext.createMediaStreamSource(micStream);

  // Create an AudioWorkletNode that uses the PCMProcessor
  const audioRecorderNode = new AudioWorkletNode(
    audioRecorderContext,
    "pcm-recorder-processor"
  );

  // Connect the microphone source to the worklet.
  source.connect(audioRecorderNode);
  audioRecorderNode.port.onmessage = (event) => {
    // Convert to 16-bit PCM
    const pcmData = convertFloat32ToPCM(event.data);

    // Send the PCM data to the handler.
    audioRecorderHandler(pcmData);
  };
  return [audioRecorderNode, audioRecorderContext, micStream];
}

/**
 * Stop the microphone.
 */
export function stopMicrophone(micStream) {
  micStream.getTracks().forEach((track) => track.stop());
  console.log("stopMicrophone(): Microphone stopped.");
}

// Convert Float32 samples to 16-bit PCM.
function convertFloat32ToPCM(inputData) {
  // Create an Int16Array of the same length.
  const pcm16 = new Int16Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    // Multiply by 0x7fff (32767) to scale the float value to 16-bit PCM range.
    pcm16[i] = inputData[i] * 0x7fff;
  }
  // Return the underlying ArrayBuffer.
  return pcm16.buffer;
}
