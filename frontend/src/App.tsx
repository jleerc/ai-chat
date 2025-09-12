import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { startLiveWithMic } from './live'

interface ChatItem { role: 'user' | 'ai'; text: string }

type SpeechRec = typeof window extends any ? any : never

async function postChat(message: string, sessionId?: string){
  const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message, session_id: sessionId }) })
  if(!res.ok) throw new Error('chat failed')
  return res.json() as Promise<{ session_id: string; response: string }>
}

async function uploadFrame(blob: Blob, sessionId?: string, note?: string){
  const fd = new FormData()
  fd.append('file', new File([blob], 'frame.jpg', { type: 'image/jpeg' }))
  if(sessionId) fd.append('session_id', sessionId)
  if(note) fd.append('note', note)
  const res = await fetch('/api/screen/frame',{ method:'POST', body: fd })
  if(!res.ok) throw new Error('frame failed')
  return res.json() as Promise<{ session_id: string; ack: boolean; response: string }>
}

export default function App(){
  const [messages,setMessages]=useState<ChatItem[]>([])
  const [input,setInput]=useState('')
  const [sessionId,setSessionId]=useState<string>()
  const [sending,setSending]=useState(false)

  const [audioDevices,setAudioDevices]=useState<MediaDeviceInfo[]>([])
  const [selectedMic,setSelectedMic]=useState<string>('')
  const [micStream,setMicStream]=useState<MediaStream>()

  const [outputDevices,setOutputDevices]=useState<MediaDeviceInfo[]>([])
  const [selectedOutput,setSelectedOutput]=useState<string>('')
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  const [screenStream,setScreenStream]=useState<MediaStream>()
  const screenVideoRef = useRef<HTMLVideoElement>(null)

  const [voiceMode,setVoiceMode]=useState(false)
  const [liveEnabled,setLiveEnabled]=useState(false)
  const [autoSend,setAutoSend]=useState(true)
  const pcRef = useRef<RTCPeerConnection|null>(null)

  const recRef = useRef<any|null>(null)
  const speakingRef = useRef(false)
  const voiceBufferRef = useRef<string>('')
  const voiceTimerRef = useRef<number | null>(null)

  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([])
  const [selectedVoice,setSelectedVoice]=useState<string>('')

  useEffect(()=>{ (async()=>{
    try{
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audIns = devices.filter(d=>d.kind==='audioinput')
      const audOuts = devices.filter(d=>d.kind==='audiooutput')
      setAudioDevices(audIns)
      setOutputDevices(audOuts)
      if(audIns[0]) setSelectedMic(audIns[0].deviceId)
      if(audOuts[0]) setSelectedOutput(audOuts[0].deviceId)
    }catch(e){ console.warn(e) }
  })() },[])

  const applyOutputDevice = useCallback(async()=>{
    const el = remoteAudioRef.current as any
    if(!el) return
    if(typeof el.setSinkId === 'function' && selectedOutput){
      try{ await el.setSinkId(selectedOutput) }catch(e){ console.warn('setSinkId failed', e) }
    }
  },[selectedOutput])

  useEffect(()=>{ applyOutputDevice() },[selectedOutput, applyOutputDevice])

  const startMic = useCallback(async()=>{
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: selectedMic? { deviceId: { exact: selectedMic } } : true })
      setMicStream(stream)
      if(liveEnabled){
        pcRef.current?.close()
        const pc = await startLiveWithMic(stream)
        pcRef.current = pc
        pc.ontrack = (e)=>{
          const audioEl = remoteAudioRef.current
          if(!audioEl) return
          const mediaStream = e.streams?.[0] || new MediaStream([e.track])
          audioEl.srcObject = mediaStream
          audioEl.play().catch(()=>{})
          void applyOutputDevice()
        }
      }
    }catch(e){ console.error(e) }
  },[selectedMic, liveEnabled, applyOutputDevice])

  const stopMic = useCallback(()=>{
    micStream?.getTracks().forEach(t=>t.stop())
    setMicStream(undefined)
    pcRef.current?.close(); pcRef.current=null
  },[micStream])

  const startScreenShare = useCallback(async()=>{
    try{
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 12 } })
      setScreenStream(stream)
      if(screenVideoRef.current){ screenVideoRef.current.srcObject = stream; await screenVideoRef.current.play() }
    }catch(e){ console.error(e) }
  },[])

  const stopScreenShare = useCallback(()=>{
    screenStream?.getTracks().forEach(t=>t.stop())
    setScreenStream(undefined)
  },[screenStream])

  const grabAndSendFrame = useCallback(async()=>{
    if(!screenVideoRef.current) return
    const video = screenVideoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth||1280
    canvas.height = video.videoHeight||720
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video,0,0,canvas.width,canvas.height)
    const blob:Blob = await new Promise(res=>canvas.toBlob(b=>res(b!), 'image/jpeg', 0.7)!)
    const note = 'Please analyze what is on my screen and advise next steps.'
    const r = await uploadFrame(blob, sessionId, note)
    if(!sessionId) setSessionId(r.session_id)
    setMessages(m=>[...m, { role:'user', text:'[Shared a screen frame]' }, { role:'ai', text:r.response }])
  },[sessionId])

  useEffect(()=>{
    const updateVoices = ()=>{
      const list = window.speechSynthesis?.getVoices?.() || []
      setVoices(list)
      if(list.length && !selectedVoice){
        const preferred = list.find(v=> v.lang.startsWith('en') && v.name.toLowerCase().includes('neural')) || list.find(v=> v.lang.startsWith('en')) || list[0]
        if(preferred) setSelectedVoice(preferred.voiceURI)
      }
    }
    updateVoices()
    window.speechSynthesis?.addEventListener?.('voiceschanged', updateVoices as any)
    return ()=> window.speechSynthesis?.removeEventListener?.('voiceschanged', updateVoices as any)
  },[selectedVoice])

  const speak = useCallback((text:string)=>{
    if(!('speechSynthesis' in window)) return
    if(speakingRef.current) window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const voice = voices.find(v=> v.voiceURI===selectedVoice)
    if(voice) u.voice = voice
    u.rate = 1
    u.pitch = 1
    speakingRef.current = true
    u.onend = ()=>{ speakingRef.current = false }
    window.speechSynthesis.speak(u)
  },[voices, selectedVoice])

  const sendText = useCallback(async(text:string)=>{
    if(!text.trim()) return
    setInput('')
    setMessages(m=>[...m,{ role:'user', text }])
    try{
      const r = await postChat(text, sessionId)
      if(!sessionId) setSessionId(r.session_id)
      setMessages(m=>[...m,{ role:'ai', text:r.response }])
      if(voiceMode) speak(r.response)
    }catch(e){
      setMessages(m=>[...m,{ role:'ai', text:'Sorry, there was an error.' }])
    }
  },[sessionId, voiceMode, speak])

  const scheduleAutoSend = useCallback(()=>{
    if(!autoSend) return
    if(voiceTimerRef.current){ window.clearTimeout(voiceTimerRef.current) }
    voiceTimerRef.current = window.setTimeout(()=>{
      const text = voiceBufferRef.current.trim()
      if(text){
        voiceBufferRef.current = ''
        setInput('')
        sendText(text)
      }
    }, 800)
  },[autoSend, sendText])

  const initRecognizer = useCallback(()=>{
    const SR:any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if(!SR) return null
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (e:any)=>{
      let finalText = ''
      let interimText = ''
      for(let i=e.resultIndex;i<e.results.length;i++){
        const r = e.results[i]
        if(r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      if(interimText){
        setInput(prev=> (prev? prev.split(' | ')[0] : '') + (interimText ? ` | ${interimText}` : ''))
      }
      if(finalText.trim()){
        voiceBufferRef.current = (voiceBufferRef.current + ' ' + finalText).trim()
        setInput(prev=>{
          const base = prev.includes(' | ') ? prev.split(' | ')[0] : prev
          return (base + ' ' + finalText).trim()
        })
        scheduleAutoSend()
      }
    }
    rec.onerror = ()=>{}
    rec.onend = ()=>{ if(voiceMode){ try{ rec.start() }catch{} } }
    return rec
  },[voiceMode, scheduleAutoSend])

  useEffect(()=>{
    if(voiceMode){
      if(!recRef.current){ recRef.current = initRecognizer() }
      try{ recRef.current?.start() }catch{}
    } else {
      try{ recRef.current?.stop() }catch{}
      if(voiceTimerRef.current){ window.clearTimeout(voiceTimerRef.current); voiceTimerRef.current=null }
      voiceBufferRef.current=''
    }
    return ()=>{ try{ recRef.current?.stop() }catch{} }
  },[voiceMode, initRecognizer])

  const send = useCallback(async()=>{
    if(!input.trim()) return
    const q = input.includes(' | ') ? input.split(' | ')[0] : input
    setInput('')
    setSending(true)
    try{
      const r = await postChat(q.trim(), sessionId)
      if(!sessionId) setSessionId(r.session_id)
      setMessages(m=>[...m,{ role:'user', text:q.trim() },{ role:'ai', text:r.response }])
      if(voiceMode) speak(r.response)
    }catch(e){
      setMessages(m=>[...m,{ role:'ai', text:'Sorry, there was an error.' }])
    }finally{ setSending(false) }
  },[input, sessionId, voiceMode, speak])

  return (
    <div className="container">
      <div className="header">
        <div className="brand"><div className="logo"></div><div className="title">ADK Multimodal Support</div></div>
        <div className="badge">Session: {sessionId?.slice(0,8)||'–'}</div>
      </div>

      <div className="grid">
        <div className="panel">
          <div className="head"><div>Voice & Devices</div></div>
          <div className="body">
            <div style={{display:'grid', gap:8}}>
              <label className="badge">Microphone</label>
              <select value={selectedMic} onChange={e=>setSelectedMic(e.target.value)}>
                {audioDevices.map(d=> <option key={d.deviceId} value={d.deviceId}>{d.label||'Microphone'}</option>)}
              </select>
              <div className="controls">
                {!micStream ? <button className="btn" onClick={startMic}>Start Mic</button> : <button className="btn" onClick={stopMic}>Stop Mic</button>}
                <button className={"btn "+(voiceMode? 'primary':'')} onClick={()=>setVoiceMode(v=>!v)}>{voiceMode? 'Voice On':'Voice Off'}</button>
                <button className={"btn "+(liveEnabled? 'primary':'')} onClick={()=>setLiveEnabled(v=>!v)}>{liveEnabled? 'Live On':'Live Off'}</button>
              </div>
              <label className="badge">Speaker (output)</label>
              <select value={selectedOutput} onChange={e=>setSelectedOutput(e.target.value)}>
                {outputDevices.map(d=> <option key={d.deviceId} value={d.deviceId}>{d.label||'Speaker'}</option>)}
              </select>
              <div className="controls">
                <button className="btn" onClick={()=> speak('This is your selected speaker.')}>Test Output</button>
              </div>
              <label className="badge">TTS Voice</label>
              <select value={selectedVoice} onChange={e=>setSelectedVoice(e.target.value)}>
                {voices.map(v=> <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
              </select>
              <div className="controls">
                <label className="badge" style={{marginRight:8}}>Auto-send on pause</label>
                <button className={"btn "+(autoSend? 'primary':'')} onClick={()=>setAutoSend(v=>!v)}>{autoSend? 'Enabled':'Disabled'}</button>
              </div>
              <div className="badge">Transcription uses your browser's Speech Recognition (if available). Live uses Vertex AI Live API.</div>
              <audio ref={remoteAudioRef} autoPlay playsInline hidden />
            </div>
            <div style={{height:14}} />
            <div style={{display:'grid', gap:8}}>
              <label className="badge">Screen Share</label>
              <div className="controls">
                {!screenStream ? <button className="btn" onClick={startScreenShare}>Start Share</button> : <button className="btn" onClick={stopScreenShare}>Stop Share</button>}
                {screenStream && <button className="btn primary" onClick={grabAndSendFrame}>Send Frame</button>}
              </div>
              <div className="videoWrap"><video ref={screenVideoRef} muted playsInline></video></div>
            </div>
          </div>
        </div>

        <div className="panel chat">
          <div className="head"><div>Customer Service Chat</div></div>
          <div className="body">
            <div className="messages">
              {messages.map((m,i)=> (
                <div key={i} className={"msg "+(m.role==='user'?'user':'ai')}>{m.text}</div>
              ))}
            </div>
            <div className="inputRow">
              <input className="input" placeholder="Type your message..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') send() }} />
              <button className="btn primary" disabled={sending} onClick={send}>{sending?'...':'Send'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
