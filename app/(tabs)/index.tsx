import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import React, { useEffect, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import 'react-native-get-random-values';
import uuid from 'react-native-uuid';
import { transcribeAudio } from '../services/audioService';
import { notifyCivilianCallStarted, sendTranscript } from '../services/transcriptService';

// Define types for ElevenLabs API responses
type SingleChannelResponse = {
  content: string;
};

type MultiChannelResponse = {
  channels: Array<{ content: string }>;
};

type TranscriptionResponse = SingleChannelResponse | MultiChannelResponse;


// Key for storing device ID in AsyncStorage
const DEVICE_ID_KEY = '@vigilis_device_id';

// ElevenLabs SDK removed to avoid Node-only imports in the RN bundle.
// We use a lightweight REST helper in `app/services/audioService.ts` instead.

export default function App() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("Tap 'Start Recording' to begin...");
  const [isLoading, setIsLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [permissionResponse, requestPermission] = Audio.usePermissions();

  // Get or generate device ID on component mount
  useEffect(() => {
    const initDeviceId = async () => {
      try {
        let storedId = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (!storedId) {
          storedId = uuid.v4().toString();
          await AsyncStorage.setItem(DEVICE_ID_KEY, storedId);
        }
        setDeviceId(storedId);
      } catch (err) {
        console.error('Error initializing device ID:', err);
        setSendError('Failed to initialize device ID');
      }
    };
    
    initDeviceId();
  }, []);

  useEffect(() => {
    async function setupAudio() {
      try {
        if (Platform.OS !== 'web') {
          // For mobile, we need to ensure audio mode is set up first
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
          });
        }
        
        // Then request permissions
        if (!permissionResponse?.granted) {
          const { granted } = await requestPermission();
          if (!granted) {
            console.warn('Permission not granted for audio recording');
          }
        }
      } catch (err) {
        console.error('Error setting up audio:', err);
      }
    }

    setupAudio();
  }, []);

  async function startRecording() {
    try {
      // Double-check permissions
      if (!permissionResponse?.granted) {
        const { granted } = await requestPermission();
        if (!granted) {
          throw new Error('Microphone permission is required!');
        }
      }

      // For mobile platforms, ensure audio mode is set
      if (Platform.OS !== 'web') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        });
      }

      // Notify server that a civilian call has started
      if (deviceId) {
        notifyCivilianCallStarted(deviceId).catch((err) => {
          console.error('Failed to notify call started:', err);
        });
      }

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
      setTranscript('Recording...');
    } catch (err) {
      const error = err as Error;
      console.error('Failed to start recording', error);
      
      let errorMessage = 'Error starting recording: ';
      if (Platform.OS !== 'web' && error.message.includes('No media devices')) {
        errorMessage += 'Microphone not found or not accessible. Please ensure your device has a working microphone and the app has permission to use it.';
      } else {
        errorMessage += error.message;
      }
      
      setTranscript(errorMessage);
      setIsRecording(false);
    }
  }

  async function stopRecording() {
    if (!recording) return;
    
    setIsRecording(false);
    setIsLoading(true);
    setTranscript('Stopping recording and preparing for transcription...');

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (!uri) {
        throw new Error("Could not retrieve recorded audio URI.");
      }

      setTranscript('Uploading audio to ElevenLabs...');
      const transcribedText = await uploadAndTranscribe(uri);
      setTranscript(transcribedText);

  // Clear previous send status when a new transcript arrives
  setSendError(null);
  setSendSuccess(null);

    } catch (err) {
      const error = err as Error;
      console.error('Failed to stop recording or transcribe:', error);
      setTranscript(`Transcription failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }


async function uploadAndTranscribe(fileUri: string): Promise<string> {
  // Reads the local file URI into a Blob and forwards to our audioService.
  try {
    // In React Native (Expo) we can append the local file URI directly to FormData
    // by passing an object with { uri, name, type } to the helper.
    return await transcribeAudio({ uri: fileUri, name: 'recording.m4a', type: 'audio/mp4' });
  } catch (err) {
    const error = err as Error;
    console.error('Transcription Error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

  async function handleSend() {
    // Avoid sending placeholder text
    if (!transcript || transcript.startsWith('Recording') || transcript.startsWith('Tap')) {
      setSendError('No transcript to send');
      return;
    }

    // Check if we have a device ID
    if (!deviceId) {
      setSendError('Device ID not initialized');
      return;
    }

    setSendLoading(true);
    setSendError(null);
    setSendSuccess(null);

    try {
      // caller = 'civilian' for the main Caller tab
      const resp = await sendTranscript(transcript, deviceId, 15000, 'civilian');
      setSendSuccess(`Transcript sent successfully to incident ${resp.incident_id}`);
      console.log('sendTranscript response:', resp);
    } catch (err: any) {
      console.error('Failed to send transcript:', err);
      setSendError(err?.message ?? 'Failed to send transcript');
    } finally {
      setSendLoading(false);
    }
  }

  // NOTE: The actual API call function (uploadAndTranscribe) requires handling 
  // file-to-binary conversion and a multipart form data POST request, 
  // which is complex for a simple front-page example.
  // It would use 'fetch' with FormData to send the audio file and API key 
  // to the ELEVENLABS_API_URL.

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎤 Civilian</Text>
      <View style={styles.buttonContainer}>
        <Button
          title={isRecording ? 'Recording...' : 'Start Recording'}
          onPress={startRecording}
          disabled={isRecording || isLoading}
          color={isRecording ? 'red' : '#3C56DA'}
        />
        <Button
          title="Stop & Transcribe"
          onPress={stopRecording}
          disabled={!isRecording || isLoading}
          color="#3C56DA"
        />
      </View>
      
      <View style={styles.transcriptBox}>
        <Text style={styles.statusText}>{isLoading ? 'Processing...' : 'Transcription:'}</Text>
        <ScrollView style={styles.transcriptScroll}>
          <Text style={styles.transcriptText}>{transcript}</Text>
        </ScrollView>
      </View>

      <View style={{ marginBottom: 12 }}>
        <Button
          title={sendLoading ? 'Sending…' : 'Send Transcript'}
          onPress={handleSend}
          disabled={sendLoading || isLoading}
          color="#3C56DA"
        />
        {sendError ? <Text style={{ color: 'red', marginTop: 6 }}>{sendError}</Text> : null}
        {sendSuccess ? <Text style={{ color: 'green', marginTop: 6 }}>{sendSuccess}</Text> : null}
      </View>

      <Text style={styles.footerText}>
        {Platform.OS === 'ios' ? 'Microphone permission status: ' : 'Permission status: '}
        {permissionResponse?.status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#101010',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#FFFFFF',
    fontFamily: 'Exo',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 30,
  },
  transcriptBox: {
    backgroundColor: '#4e4e4e',
    borderRadius: 10,
    padding: 15,
    minHeight: 150,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    marginBottom: 20,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#666',
    paddingBottom: 5,
    fontFamily: 'Exo',
  },
  transcriptScroll: {
    maxHeight: 100, // Limit scroll view height
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
    fontFamily: 'Exo',
  },
  footerText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 10,
    fontFamily: 'Exo',
  }
});