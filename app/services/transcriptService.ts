// Base URL for all API endpoints
const BASE_URL = 'https://vigilis.onrender.com';

type AddTranscriptResponse = {
  status: 'success';
  message: string;
  incident_id: string;
  caller: string;
};

/**
 * Sends a transcript to the server.
 * Creates a new incident if it doesn't exist, or appends to an existing one.
 */
export async function sendTranscript(
  transcript: string,
  sessionId: string,
  timeoutMs: number = 15000,
  caller: string = 'unknown'
): Promise<AddTranscriptResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      incident_id: sessionId, // Using sessionId as the incident_id
      transcript,
      caller,
    };

    const res = await fetch(`${BASE_URL}/incident/update_transcript`, {
      method: 'POST', // Matches the @app.post decorator
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      let errorBody = await res.text();
      throw new Error(`Failed to send transcript: ${res.status} ${errorBody}`);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out sending transcript');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Notifies the server that a civilian call has started.
 * @param {string} sessionId - The device/session/incident ID
 * @returns {Promise<Response>} The fetch response
 */
export async function notifyCivilianCallStarted(sessionId: string) {
  console.log("call started")
  const payload = {
    incident_id: sessionId,
    caller: 'civilian',
    timestamp: new Date().toISOString(),
  };
  const res = await fetch(`${BASE_URL}/incident/callStarted`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let errorBody = await res.text().catch(() => '');
    console.warn(`notifyCivilianCallStarted returned ${res.status}: ${errorBody}`);

    // If the endpoint doesn't exist (404), try a best-effort fallback: create an incident
    // by sending an empty transcript. This helps older server versions or different route names.
    if (res.status === 404) {
      try {
        console.log('Falling back to sendTranscript to initialize incident');
        await sendTranscript('', sessionId, 5000, 'civilian');
        return { ok: true, fallback: true } as any;
      } catch (fallbackErr) {
        let fe = fallbackErr as Error;
        throw new Error(`Failed to notify call started (404) and fallback failed: ${fe.message}`);
      }
    }

    throw new Error(`Failed to notify call started: ${res.status} ${errorBody}`);
  }
  return res;
}