import WebSocket from 'ws'
import Twilio from 'twilio'

export function registerOutboundRoutes(fastify) {
  // Check for required environment variables
  const {
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER
  } = process.env

  if (
    !ELEVENLABS_API_KEY ||
    !ELEVENLABS_AGENT_ID ||
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    !TWILIO_PHONE_NUMBER
  ) {
    console.error('Missing required environment variables')
    throw new Error('Missing required environment variables')
  }

  // Initialize Twilio client
  const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

  // Helper function to get signed URL for authenticated conversations
  async function getSignedUrl() {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY
          }
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to get signed URL: ${response.statusText}`)
      }

      const data = await response.json()
      return data.signed_url
    } catch (error) {
      console.error('Error getting signed URL:', error)
      throw error
    }
  }

  // Route to initiate outbound calls
  fastify.post('/outbound-call', async (request, reply) => {
    const { number, user_name, user_email, user_id, current_date } =
      request.body

    if (!number) {
      return reply.code(400).send({ error: 'Phone number is required' })
    }

    try {
      const call = await twilioClient.calls.create({
        from: TWILIO_PHONE_NUMBER,
        to: number,
        url: `https://${
          request.headers.host
        }/outbound-call-twiml?user_name=${encodeURIComponent(
          user_name
        )}&user_email=${encodeURIComponent(
          user_email
        )}&user_id=${encodeURIComponent(
          user_id
        )}&current_date=${encodeURIComponent(current_date)}`,
        // Add AMD parameters
        machineDetection: 'Enable',
        asyncAmd: true,
        asyncAmdStatusCallback: `https://${request.headers.host}/amd-status-callback`
      })

      reply.send({
        success: true,
        message: 'Call initiated',
        callSid: call.sid
      })
    } catch (error) {
      console.error('Error initiating outbound call:', error)
      reply.code(500).send({
        success: false,
        error: 'Failed to initiate call'
      })
    }
  })

  // Add AMD status callback route
  fastify.post('/amd-status-callback', async (request, reply) => {
    const { CallSid, AnsweredBy } = request.body

    console.log('[AMD] Detection Result:', {
      callSid: CallSid,
      answeredBy: AnsweredBy
    })

    // End call if voicemail is detected
    if (
      AnsweredBy &&
      (AnsweredBy === 'machine_start' || AnsweredBy.startsWith('machine_end'))
    ) {
      console.log('[AMD] Voicemail detected, ending call:', CallSid)
      try {
        await twilioClient.calls(CallSid).update({ status: 'completed' })
      } catch (error) {
        console.error('[AMD] Error ending call:', error)
      }
    }

    reply.send({ success: true })
  })

  // TwiML route for outbound calls
  fastify.all('/outbound-call-twiml', async (request, reply) => {
    const user_name = request.query.user_name || ''
    const user_email = request.query.user_email || ''
    const user_id = request.query.user_id || ''
    const current_date = request.query.current_date || ''

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${request.headers.host}/outbound-media-stream">
            <Parameter name="user_name" value="${user_name}" />
            <Parameter name="user_email" value="${user_email}" />
            <Parameter name="user_id" value="${user_id}" />
            <Parameter name="current_date" value="${current_date}" />
            <Parameter name="call_sid" value="${request.query.CallSid || ''}" />
          </Stream>
        </Connect>
      </Response>`

    reply.type('text/xml').send(twimlResponse)
  })

  // WebSocket route for handling media streams
  fastify.register(async fastifyInstance => {
    fastifyInstance.get(
      '/outbound-media-stream',
      { websocket: true },
      (ws, req) => {
        console.info('[Server] Twilio connected to outbound media stream')

        // Variables to track the call
        let streamSid = null
        let callSid = null
        let elevenLabsWs = null
        let customParameters = null // Add this to store parameters

        // Handle WebSocket errors
        ws.on('error', console.error)

        // Set up ElevenLabs connection
        const setupElevenLabs = async () => {
          try {
            const signedUrl = await getSignedUrl()
            elevenLabsWs = new WebSocket(signedUrl)

            elevenLabsWs.on('open', () => {
              console.log('[ElevenLabs] Connected to Conversational AI')

              const initialConfig = {
                type: 'conversation_initiation_client_data',
                dynamic_variables: {
                  user_name: customParameters?.user_name || '',
                  user_email: customParameters?.user_email || '',
                  user_id: customParameters?.user_id || '',
                  current_date: customParameters?.current_date || '',
                  call_sid: customParameters?.call_sid || ''
                }
              }

              console.log(
                '[ElevenLabs] Sending initial config with variables:',
                initialConfig.dynamic_variables
              )

              elevenLabsWs.send(JSON.stringify(initialConfig))
            })

            elevenLabsWs.on('message', data => {
              try {
                const message = JSON.parse(data)

                switch (message.type) {
                  case 'conversation_initiation_metadata':
                    console.log('[ElevenLabs] Received initiation metadata')
                    break

                  case 'end_call':
                    console.log('[ElevenLabs] Agent requested to end call')
                    // Close ElevenLabs connection
                    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                      elevenLabsWs.close()
                    }
                    // Close Twilio connection
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.close()
                    }
                    break

                  case 'audio':
                    if (streamSid) {
                      if (message.audio?.chunk) {
                        const audioData = {
                          event: 'media',
                          streamSid,
                          media: {
                            payload: message.audio.chunk
                          }
                        }
                        ws.send(JSON.stringify(audioData))
                      } else if (message.audio_event?.audio_base_64) {
                        const audioData = {
                          event: 'media',
                          streamSid,
                          media: {
                            payload: message.audio_event.audio_base_64
                          }
                        }
                        ws.send(JSON.stringify(audioData))
                      }
                    } else {
                      console.log(
                        '[ElevenLabs] Received audio but no StreamSid yet'
                      )
                    }
                    break

                  case 'interruption':
                    if (streamSid) {
                      ws.send(
                        JSON.stringify({
                          event: 'clear',
                          streamSid
                        })
                      )
                    }
                    break

                  case 'ping':
                    if (message.ping_event?.event_id) {
                      elevenLabsWs.send(
                        JSON.stringify({
                          type: 'pong',
                          event_id: message.ping_event.event_id
                        })
                      )
                    }
                    break

                  case 'agent_response':
                    console.log('[ElevenLabs] Agent response:', message.text)
                    break

                  case 'agent_response_correction':
                    console.log('[ElevenLabs] Agent correction:', message.text)
                    break

                  case 'user_transcript':
                    console.log('[ElevenLabs] User transcript:', message.text)
                    break

                  default:
                    console.log(
                      `[ElevenLabs] Unhandled message type: ${message.type}`,
                      message
                    )
                }
              } catch (error) {
                console.error('[ElevenLabs] Error processing message:', error)
              }
            })

            elevenLabsWs.on('error', error => {
              console.error('[ElevenLabs] WebSocket error:', error)
            })

            elevenLabsWs.on('close', (code, reason) => {
              let disconnectReason = 'Unknown'
              let severity = 'info'

              switch (code) {
                case 1000:
                  disconnectReason = 'Normal closure (completed)'
                  severity = 'info'
                  break
                case 1001:
                  disconnectReason = 'Going away (endpoint shutting down)'
                  severity = 'warn'
                  break
                case 1002:
                  disconnectReason = 'Protocol error'
                  severity = 'error'
                  break
                case 1003:
                  disconnectReason = 'Unsupported data'
                  severity = 'error'
                  break
                case 1006:
                  disconnectReason =
                    'Abnormal closure (connection lost/user hung up)'
                  severity = 'warn'
                  break
                case 1007:
                  disconnectReason = 'Invalid frame payload data'
                  severity = 'error'
                  break
                case 1008:
                  disconnectReason = 'Policy violation'
                  severity = 'error'
                  break
                case 1009:
                  disconnectReason = 'Message too big'
                  severity = 'error'
                  break
                case 1011:
                  disconnectReason = 'Internal server error'
                  severity = 'error'
                  break
                case 3000:
                  disconnectReason = 'Twilio Media Timeout'
                  severity = 'warn'
                  break
                default:
                  disconnectReason = `Unknown code: ${code}`
                  severity = 'warn'
              }

              console.log('[ElevenLabs] Disconnected', {
                code,
                disconnectReason,
                severity,
                rawReason: reason || 'No reason provided',
                streamSid,
                callSid
              })

              // Close Twilio connection for ANY ElevenLabs WebSocket closure
              if (ws.readyState === WebSocket.OPEN) {
                console.log(
                  '[ElevenLabs] Closing Twilio connection due to ElevenLabs disconnection'
                )
                ws.close()
              }
            })
          } catch (error) {
            console.error('[ElevenLabs] Setup error:', error)
          }
        }

        // Set up ElevenLabs connection
        setupElevenLabs()

        // Handle messages from Twilio
        ws.on('message', message => {
          try {
            const msg = JSON.parse(message)
            console.log(`[Twilio] Received event: ${msg.event}`)

            switch (msg.event) {
              case 'start':
                streamSid = msg.start.streamSid
                callSid = msg.start.callSid
                customParameters = msg.start.customParameters // Store parameters
                console.log(
                  `[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`
                )
                console.log('[Twilio] Start parameters:', customParameters)
                break

              case 'media':
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  const audioMessage = {
                    user_audio_chunk: Buffer.from(
                      msg.media.payload,
                      'base64'
                    ).toString('base64')
                  }
                  elevenLabsWs.send(JSON.stringify(audioMessage))
                }
                break

              case 'stop':
                console.log(`[Twilio] Stream ${streamSid} ended`)
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                  elevenLabsWs.close()
                }
                break

              default:
                console.log(`[Twilio] Unhandled event: ${msg.event}`)
            }
          } catch (error) {
            console.error('[Twilio] Error processing message:', error)
          }
        })

        // Handle WebSocket closure
        ws.on('close', (code, reason) => {
          let disconnectReason = 'Unknown'

          switch (code) {
            case 1000:
              disconnectReason = 'Normal closure (user ended call)'
              break
            case 1006:
              disconnectReason =
                'Abnormal closure (connection lost/user hung up)'
              break
            case 3000:
              disconnectReason = 'Twilio Media Timeout'
              break
            default:
              disconnectReason = `Unknown code: ${code}`
          }

          console.log('[Twilio] Client disconnected', {
            code,
            disconnectReason,
            rawReason: reason || 'No reason provided',
            streamSid,
            callSid
          })

          if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            elevenLabsWs.close()
          }
        })
      }
    )
  })
}
