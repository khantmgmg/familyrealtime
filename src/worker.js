// worker.js (Minimal Durable Object Test for Web Interface)

// IMPORTS AT THE VERY TOP
import { DurableObject } from "cloudflare:workers";

// DURABLE OBJECT CLASS DEFINITION
export class ChatRoom extends DurableObject {
  constructor(state, env) {
    super(state, env);
    console.log("ChatRoom Durable Object instance created or rehydrated.");
  }

  // The fetch method is the entry point for requests to this Durable Object instance
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/test-do-endpoint") {
      // This is a simple response from inside the Durable Object
      return new Response("Hello from the ChatRoom Durable Object!", { status: 200 });
    }
    return new Response("Request received by ChatRoom DO.", { status: 200 });
  }
}

// MAIN WORKER'S FETCH HANDLER (to invoke the Durable Object)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/invoke-do') {
      // Get a consistent Durable Object ID for testing (e.g., for a "test_room")
      // We need env.CHAT_ROOM here, which will be provided by the binding you create.
      // If you created a brand new worker for this test, you might not have APP_ID/APP_TOKEN set yet,
      // but that's okay for this minimal DO test.
      const durableObjectId = env.CHAT_ROOM.idFromName("test_room_id");

      // Get a stub (client) to interact with that specific Durable Object instance
      const durableObjectStub = env.CHAT_ROOM.get(durableObjectId);

      // Make a request to the Durable Object's fetch method
      // The URL (e.g., http://do/test-do-endpoint) is internal to the DO stub.
      // It specifies which path the DO's own fetch handler should process.
      const responseFromDO = await durableObjectStub.fetch(new Request("http://do/test-do-endpoint"));

      return responseFromDO; // Return the response received from the Durable Object
    } else {
      // Default response for other paths
      return new Response("Access /invoke-do to test the Durable Object. Current time is " + new Date().toISOString(), { status: 200 });
    }
  },
};