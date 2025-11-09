// Lightweight audio transcription helper using the ElevenLabs REST API.
// This avoids importing the official SDK (which pulls in Node-only modules)
// that break bundling in React Native.

const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
const ELEVENLABS_STT_URL = process.env.EXPO_PUBLIC_ELEVENLABS_STT_URL || 'https://api.elevenlabs.io/v1/speech-to-text';

export type RNFile = { uri: string; name?: string; type?: string };

export async function transcribeAudio(fileBlob: Blob | File | RNFile, timeoutMs = 60000): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured (EXPO_PUBLIC_ELEVENLABS_API_KEY)');
  }

  const form = new FormData();
  // Support two shapes: a RN-style file object { uri, name, type } or a Browser Blob/File
  if (fileBlob && typeof (fileBlob as any).uri === 'string') {
    const f = fileBlob as RNFile;
    form.append('file', {
      uri: f.uri,
      name: f.name || 'recording.m4a',
      type: f.type || 'audio/mp4',
    } as any);
  } else {
    // Browser-like Blob/File (for web) — append directly
    form.append('file', fileBlob as any);
  }
  // Use the same model id used previously in the codebase.
  // ElevenLabs expects `model_id` in the multipart body (422 occurs if missing).
  form.append('model_id', 'scribe_v1');

  // Helpful debug when server returns validation issues
  console.debug('Transcription request prepared:', { url: ELEVENLABS_STT_URL, model_id: 'scribe_v1' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: {
        // ElevenLabs uses xi-api-key for some endpoints; if your account requires
        // a different header (Authorization: Bearer ...), update accordingly.
        'xi-api-key': ELEVENLABS_API_KEY,
      } as Record<string,string>,
      body: form as any,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ElevenLabs STT request failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = await res.json().catch(() => null);

    if (!data) return 'No transcription returned from ElevenLabs.';

    // Try common keys where transcription text may appear
    if (typeof data === 'string') return data;
    if ('text' in data && typeof data.text === 'string') return data.text;
    if ('content' in data && typeof data.content === 'string') return data.content;
    if ('transcript' in data && typeof data.transcript === 'string') return data.transcript;
    if ('channels' in data && Array.isArray((data as any).channels)) {
      const texts = (data as any).channels.map((c: any) => c.content || c.text || c.transcript).filter(Boolean);
      if (texts.length) return texts.join(' ');
    }

    // Fallback: stringify for debugging
    return `Unexpected transcription response: ${JSON.stringify(data)}`;
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Transcription request timed out');
    throw err;
  }
}

export default transcribeAudio;
