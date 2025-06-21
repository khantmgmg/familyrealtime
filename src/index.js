// worker.js
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, 'name', { value, configurable: true });
// 1. IMPORTS AT THE VERY TOP
import { DurableObject } from 'cloudflare:workers'; // Crucial for explicit DO declaration

// 2. DURABLE OBJECT CLASS DEFINITION IMMEDIATELY AFTER IMPORTS
var ChatRoom = class extends DurableObject {
	// Explicitly extend DurableObject
	static {
		__name(this, 'ChatRoom');
	}
	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param state - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(state, env) {
		super(state, env); // Call the parent constructor
		this.env = env; // Access env for APP_ID, APP_TOKEN if needed by DO
		this.sessions = []; // Array of WebSocket sessions connected to this room DO
		// Store participant info: sessionId -> { ws (reference), trackInfo (array) }
		this.participants = new Map();
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @returns The greeting to be sent back to the Worker
	 */
	async fetch(request) {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/websocket': {
				// Upgrade the request to a WebSocket connection
				if (request.headers.get('Upgrade') !== 'websocket') {
					return new Response('Expected WebSocket', { status: 426 });
				}
				const webSocketPair = new WebSocketPair();
				const [client, server] = Object.values(webSocketPair);

				server.accept();
				this.handleWebSocket(server);

				return new Response(null, { status: 101, webSocket: client });
			}
			default:
				return new Response('Not Found', { status: 404 });
		}
	}

	async handleWebSocket(ws) {
		this.sessions.push(ws); // Add new WebSocket connection to room sessions
		console.log('DO: New WebSocket connected. Total sessions:', this.sessions.length);

		ws.addEventListener('message', async (event) => {
			const message = JSON.parse(event.data);
			console.log('DO received message:', message);

			if (message.type === 'joinRoom') {
				const { sessionId, userName, trackInfo } = message; // Added userName
				// Store participant info
				this.participants.set(sessionId, { ws, userName, trackInfo });
				console.log(`DO: Participant ${userName} (${sessionId.substring(0, 8)}...) joined.`);

				// Notify existing participants about the new one
				this.sessions.forEach((session) => {
					if (session !== ws && session.readyState === WebSocket.OPEN) {
						session.send(
							JSON.stringify({
								type: 'participantJoined',
								sessionId: sessionId,
								userName: userName,
								trackInfo: trackInfo,
							})
						);
					}
				});

				// Send existing participants info to the newly joined participant
				const existingParticipants = [];
				for (const [id, data] of this.participants.entries()) {
					if (id !== sessionId) {
						// Don't send self's info back to self as existing
						existingParticipants.push({
							sessionId: id,
							userName: data.userName,
							trackInfo: data.trackInfo,
						});
					}
				}
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: 'existingParticipants', participants: existingParticipants }));
					console.log(`DO: Sent existing participants to ${userName}.`);
				}
			}
			// You could add other message types here for advanced signaling
			// e.g., 'iceCandidate', 'sdpOffer', 'sdpAnswer' if you weren't fully relying on Calls renegotiation
		});

		ws.addEventListener('close', async (event) => {
			console.log('DO WebSocket closed:', event.code, event.reason);
			// Remove session from list
			this.sessions = this.sessions.filter((s) => s !== ws);

			// Find and remove participant from map
			let leavingSessionId;
			for (const [id, data] of this.participants.entries()) {
				if (data.ws === ws) {
					leavingSessionId = id;
					this.participants.delete(id);
					break;
				}
			}

			// Notify other participants that someone left
			if (leavingSessionId) {
				console.log(`DO: Participant ${leavingSessionId.substring(0, 8)}... left.`);
				this.sessions.forEach((session) => {
					if (session.readyState === WebSocket.OPEN) {
						session.send(JSON.stringify({ type: 'participantLeft', sessionId: leavingSessionId }));
					}
				});
			}
			console.log('DO: Current sessions:', this.sessions.length);
			console.log('DO: Current participants:', this.participants.size);
		});

		ws.addEventListener('error', (error) => {
			console.error('DO WebSocket error:', error);
		});
	}
};

// 3. HTML CONTENT STRING AFTER ALL TOP-LEVEL IMPORTS AND EXPORTS
const htmlContent = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script
      src="https://cdnjs.cloudflare.com/ajax/libs/webrtc-adapter/8.1.2/adapter.min.js"
      integrity="sha512-l40eBFtXx+ve5RryIELC3y6/OM6Nu89mLGQd7fg1C93tN6XrkC3supb+/YiD/Y+B8P37kdJjtG1MT1kOO2VzxA=="
      crossorigin="anonymous"
      referrerpolicy="no-referrer"
    ></script>
    <style>
      /* Styles are safe to ignore, just here for demo */

      html {
        color-scheme: light dark;
        font-family:
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          Roboto,
          Oxygen,
          Ubuntu,
          Cantarell,
          "Open Sans",
          "Helvetica Neue",
          sans-serif;
        background: white;
        color: black;
      }
      body,
      h1,
      h2 {
        margin: 0;
      }
      h1,
      h2 {
        font-weight: 400;
      }
      h1 {
        font-size: 1.5rem;
        grid-column: 1 / -1;
      }
      h2 {
        font-size: 1rem;
        margin-bottom: 0.5rem;
      }
      video {
        width: 100%;
        max-width: 400px; /* Limit video size */
        height: auto;
        background-color: #333; /* Placeholder background */
        border-radius: 8px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); /* Adjust for more videos */
        gap: 1rem;
        padding: 1rem;
      }
      .video-container {
        border: 1px solid #ccc;
        padding: 0.5rem;
        text-align: center;
        border-radius: 10px;
        box-shadow: 2px 2px 8px rgba(0,0,0,0.1);
        background-color: #f9f9f9;
      }

      @media (max-width: 500px) {
        .grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      input[type="text"], button {
        padding: 10px;
        margin: 5px;
        font-size: 1rem;
        border-radius: 5px;
        border: 1px solid #ddd;
      }
      button {
        background-color: #007bff;
        color: white;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      button:hover:not(:disabled) {
        background-color: #0056b3;
      }
      button:disabled {
        background-color: #cccccc;
        cursor: not-allowed;
      }
      #controls {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 1rem;
        align-items: center;
      }
    </style>
  </head>

  <body>
    <div class="grid">
      <div id="controls">
        <h1>Cloudflare Calls Group Chat</h1>
        <input type="text" id="userNameInput" placeholder="Your Name" value="Guest" />
        <input type="text" id="roomIdInput" placeholder="Room ID" value="myfamilyroom" />
        <button id="joinButton">Join Room</button>
        <button id="leaveButton" disabled>Leave Room</button>
      </div>

      <div class="video-container" id="localVideoContainer">
        <h2>Your Stream (<span id="localUserName"></span>)</h2>
        <video id="local" autoplay muted playsinline></video>
      </div>

      </div>

    <script type="module">
      const APP_ID = "__APP_ID__";
      const APP_TOKEN = "__APP_TOKEN__";

      const headers = {
        Authorization: 'Bearer ' + APP_TOKEN, // Changed to concatenation
      };
      const API_BASE = 'https://rtc.live.cloudflare.com/v1/apps/' + APP_ID; // Changed to concatenation

      const localVideo = document.querySelector("video#local");
      const localUserNameSpan = document.getElementById("localUserName");
      const userNameInput = document.getElementById("userNameInput");
      const roomIdInput = document.getElementById("roomIdInput");
      const joinButton = document.getElementById("joinButton");
      const leaveButton = document.getElementById("leaveButton");
      const gridContainer = document.querySelector(".grid"); // For adding remote videos

      if (!(localVideo instanceof HTMLVideoElement))
        throw new Error("Local video element not found");

      let ws; // WebSocket connection to the signaling server
      let localSessionId;
      let localPeerConnection;
      let localStream;
      let userName;
      let roomId;

      // Map to keep track of remote participants' video elements and streams
      const remoteParticipantsMap = new Map(); // sessionId -> { videoElement, mediaStream, peerConnection (if separate) }

      joinButton.addEventListener("click", joinRoom);
      leaveButton.addEventListener("click", leaveRoom);

      async function joinRoom() {
        userName = userNameInput.value.trim() || "Guest";
        roomId = roomIdInput.value.trim() || "default-room";

        if (!userName || !roomId) {
          alert("Please enter your name and a room ID.");
          return;
        }

        joinButton.disabled = true;
        leaveButton.disabled = false;
        userNameInput.disabled = true;
        roomIdInput.disabled = true;
        localUserNameSpan.textContent = userName;

        try {
          // 1. Get local media (camera/mic)
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          });
          localVideo.srcObject = localStream;
          console.log("Local media stream obtained.");

          // 2. Create local Calls session
          localSessionId = await createCallsSession();
          console.log("Cloudflare Calls local session created:", localSessionId);

          // 3. Create local RTCPeerConnection for sending our stream
          localPeerConnection = await createPeerConnection(); // This will also set up the ontrack listener
          console.log("Local RTCPeerConnection created.");

          // Add local tracks to our peer connection for sending (sendonly)
          // Store the transceiver objects themselves here
          const transceivers = localStream.getTracks().map((track) =>
            localPeerConnection.addTransceiver(track, {
              direction: "sendonly",
            }),
          );

          // --- IMPORTANT: These lines calculate localTracksInfo AFTER SDP is generated ---
          // Create and set local offer
          const localOffer = await localPeerConnection.createOffer();
          await localPeerConnection.setLocalDescription(localOffer);
          console.log("Local offer created and set.");

          // NOW, after setLocalDescription(), the transceiver.mid should be populated
          const localTracksInfo = transceivers.map(({ mid, sender }) => ({
            mid,
            trackName: sender.track?.id,
            kind: sender.track?.kind,
          }));
          console.log("Local tracks added to peer connection, MIDs populated:", localTracksInfo.map(t => t.mid)); // Added log to verify MIDs

          // Push our tracks to the Cloudflare Calls API
          const pushTracksResponse = await fetch(
            API_BASE + '/sessions/' + localSessionId + '/tracks/new',
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                sessionDescription: {
                  sdp: localOffer.sdp,
                  type: "offer",
                },
                tracks: localTracksInfo.map((t) => ({
                  location: "local",
                  mid: t.mid, // This will now have a value like "0" or "1"
                  trackName: t.trackName,
                })),
              }),
            },
          ).then((res) => res.json());

          // Handle the response from pushing tracks (this part stays the same)
          await localPeerConnection.setRemoteDescription(
            new RTCSessionDescription(pushTracksResponse.sessionDescription),
          );
          console.log("Pushed local tracks to Calls API and set remote description.");

          // 4. Connect to the WebSocket signaling server
          ws = new WebSocket('ws://' + location.host + '/websocket?room=' + roomId);

          ws.onopen = () => {
            console.log("WebSocket connected to signaling server!");
            // Send our session ID and track info to the signaling server
            ws.send(JSON.stringify({
              type: "joinRoom",
              sessionId: localSessionId,
              userName: userName,
              trackInfo: localTracksInfo,
            }));
            console.log("Sent 'joinRoom' message to signaling server.");
          };

          ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            console.log("Received WS message:", message.type, message);

            if (message.type === 'participantJoined') {
              const { sessionId: remoteSessionId, userName: remoteUserName, trackInfo: remoteTrackInfo } = message;
              console.log('New participant joined: ' + remoteUserName + ' (' + remoteSessionId.substring(0, 8) + '...)');
              await handleNewRemoteParticipant(remoteSessionId, remoteUserName, remoteTrackInfo);
            } else if (message.type === 'existingParticipants') {
              const { participants } = message;
              console.log('Received ' + participants.length + ' existing participants.');
              for (const participant of participants) {
                console.log('Existing participant: ' + participant.userName + ' (' + participant.sessionId.substring(0, 8) + '...)');
                await handleNewRemoteParticipant(participant.sessionId, participant.userName, participant.trackInfo);
              }
            } else if (message.type === 'participantLeft') {
              const { sessionId: leavingSessionId } = message;
              console.log('Participant left: ' + leavingSessionId.substring(0, 8) + '...');
              removeRemoteParticipant(leavingSessionId);
            }
          };

          ws.onclose = () => {
            console.log("WebSocket closed.");
            cleanupSession();
          };
          ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            cleanupSession();
          };

        } catch (error) {
          console.error("Error joining room:", error);
          alert("Failed to join room. Please check console for details.");
          cleanupSession();
        }
      }


      function leaveRoom() {
        if (ws) {
          ws.close();
        }
        cleanupSession();
      }

      function cleanupSession() {
        console.log("Cleaning up session...");
        joinButton.disabled = false;
        leaveButton.disabled = true;
        userNameInput.disabled = false;
        roomIdInput.disabled = false;
        localUserNameSpan.textContent = "";

        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
          localVideo.srcObject = null;
          console.log("Local stream stopped.");
        }
        if (localPeerConnection) {
          localPeerConnection.close();
          localPeerConnection = null;
          console.log("Local peer connection closed.");
        }
        localSessionId = null;

        // Remove all remote videos
        remoteParticipantsMap.forEach(participant => {
          if (participant.mediaStream) {
            participant.mediaStream.getTracks().forEach(track => track.stop());
          }
          if (participant.videoElement.parentElement) { // Check if it's still in the DOM
              participant.videoElement.parentElement.remove(); // Remove the entire container div
          }
        });
        remoteParticipantsMap.clear(); // Clear the map
        console.log("All remote streams and video elements removed.");
      }


      async function handleNewRemoteParticipant(remoteSessionId, remoteUserName, remoteTrackInfo) {
        // Prevent adding duplicate remote participants if message is received multiple times
        if (remoteParticipantsMap.has(remoteSessionId)) {
          console.log('Participant ' + remoteUserName + ' already handled, skipping.');
          return;
        }

        console.log('Handling new remote participant: ' + remoteUserName);

        // Create a new container and video element for this remote participant
        const remoteVideoContainer = document.createElement('div');
        remoteVideoContainer.className = 'video-container';
        remoteVideoContainer.id = 'container-' + remoteSessionId; // Unique ID for the container
        remoteVideoContainer.innerHTML = '<h2>' + remoteUserName + "'s Stream</h2>" +
                                          '<video id="remote-video-' + remoteSessionId + '" autoplay playsinline></video>';
        gridContainer.appendChild(remoteVideoContainer);

        const remoteVideoElement = document.getElementById('remote-video-' + remoteSessionId);
        const remoteMediaStream = new MediaStream();
        remoteVideoElement.srcObject = remoteMediaStream;

        remoteParticipantsMap.set(remoteSessionId, {
          videoElement: remoteVideoElement,
          mediaStream: remoteMediaStream,
        });

        // Pull tracks from the remote participant's session using our localSessionId
        const tracksToPull = remoteTrackInfo.map(t => ({
          location: "remote",
          trackName: t.trackName,
          sessionId: remoteSessionId, // This links to the other participant's session
        }));
        console.log('Requesting to pull ' + tracksToPull.length + ' tracks from ' + remoteUserName + '.');

        const pullResponse = await fetch(
          API_BASE + '/sessions/' + localSessionId + '/tracks/new', // Changed to concatenation
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              tracks: tracksToPull,
            }),
          },
        ).then((res) => res.json());

        // Handle renegotiation if required by Calls API for this pull
        if (pullResponse.requiresImmediateRenegotiation) {
          console.log("Renegotiation required for pulling tracks.");
          await localPeerConnection.setRemoteDescription(
            pullResponse.sessionDescription,
          );
          const localAnswer = await localPeerConnection.createAnswer();
          await localPeerConnection.setLocalDescription(localAnswer);

          const renegotiateResponse = await fetch(
            API_BASE + '/sessions/' + localSessionId + '/renegotiate', // Changed to concatenation
            {
              method: "PUT",
              headers,
              body: JSON.stringify({
                sessionDescription: {
                  sdp: localAnswer.sdp,
                  type: "answer",
                },
              }),
            },
          ).then((res) => res.json());
          if (renegotiateResponse.errorCode) {
            throw new Error(renegotiateResponse.errorDescription);
          }
          console.log("Renegotiation complete.");
        } else {
            console.log("No renegotiation required for pulling tracks.");
        }
      }

      function removeRemoteParticipant(sessionId) {
        console.log('Removing remote participant: ' + sessionId.substring(0, 8) + '...');
        const participantInfo = remoteParticipantsMap.get(sessionId);
        if (participantInfo) {
          // Stop all tracks in the stream to release camera/mic resources
          if (participantInfo.mediaStream) {
            participantInfo.mediaStream.getTracks().forEach(track => track.stop());
            console.log('Stopped media tracks for ' + sessionId.substring(0, 8) + '...');
          }
          // Remove the video element's parent container from the DOM
          if (participantInfo.videoElement.parentElement) {
            participantInfo.videoElement.parentElement.remove();
            console.log('Removed video element for ' + sessionId.substring(0, 8) + '...');
          }
          remoteParticipantsMap.delete(sessionId);
        }
      }

      /**
       * Creates a new Calls session
       */
      async function createCallsSession() {
        const sessionResponse = await fetch(
          API_BASE + '/sessions/new', // Changed to concatenation
          {
            method: "POST",
            headers,
          },
        ).then((res) => res.json());
        return sessionResponse.sessionId;
      }

      /**
       * Creates a peer connection with some default settings
       * and sets up the ontrack listener for all incoming remote tracks.
       */
      async function createPeerConnection() {
        const peerConnection = new RTCPeerConnection({
          iceServers: [
            {
              urls: "stun:stun.cloudflare.com:3478",
            },
          ],
          bundlePolicy: "max-bundle",
        });

        // This ontrack listener receives all incoming tracks from the Calls API
        // for ALL remote participants that we are pulling.
        peerConnection.ontrack = (event) => {
            console.log('Track received on localPeerConnection:', event.track.kind, event.track.id, 'from transceiver:', event.transceiver.mid);

            let trackAdded = false;
            // Iterate through your stored remote streams and find the one this track belongs to
            remoteParticipantsMap.forEach(participant => {
                // Check if the track is already part of this specific remote participant's stream
                if (!participant.mediaStream.getTrackById(event.track.id)) {
                    participant.mediaStream.addTrack(event.track);
                    console.log('Added track ' + event.track.id + ' to remote stream for ' + participant.videoElement.id + '.');
                    trackAdded = true;
                }
            });
            if (!trackAdded) {
                console.warn('Track ' + event.track.id + ' received but not added to any remote MediaStream (might be duplicate or unhandled).');
            }
        };

        return peerConnection;
      }
    </script>
  </body>
</html>
`;

// 4. DEFAULT WORKER EXPORT AFTER ALL OTHER TOP-LEVEL DECLARATIONS
var index_default = {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// Handle WebSocket connections for Durable Objects
		if (url.pathname === '/websocket') {
			const roomName = url.searchParams.get('room') || 'default-room';
			// Get or create DO instance for this room based on the roomName
			let id = env.CHAT_ROOM.idFromName(roomName);
			let stub = env.CHAT_ROOM.get(id);
			return stub.fetch(request); // Delegate the WebSocket request to the Durable Object
		} else if (url.pathname === '/') {
			// Serve the HTML page for the root path
			const finalHtml = htmlContent.replace(/__APP_ID__/g, env.APP_ID).replace(/__APP_TOKEN__/g, env.APP_TOKEN);

			return new Response(finalHtml, {
				headers: {
					'content-type': 'text/html;charset=UTF-8',
				},
			});
		} else {
			// Return 404 for any other undefined paths
			return new Response('Not Found', { status: 404 });
		}
	},
};

export { ChatRoom, index_default as default };
