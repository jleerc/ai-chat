export async function startLiveWithMic(stream: MediaStream){
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
  })

  stream.getAudioTracks().forEach(t=> pc.addTrack(t, stream))

  const offer = await pc.createOffer({ offerToReceiveAudio: true })
  await pc.setLocalDescription(offer)

  const res = await fetch('/api/live/sdp', { method:'POST', headers:{ 'Content-Type':'application/sdp' }, body: offer.sdp||'' })
  if(!res.ok){ throw new Error('failed to negotiate') }
  const answerSdp = await res.text()
  await pc.setRemoteDescription({ type:'answer', sdp: answerSdp })

  return pc
}
