import { Server } from 'net';
import { ReplayReadable } from '../src/replay-readable';
import { AudioReceiveStream, SpeakingMap, VoiceReceiver } from '@discordjs/voice';
import { WritableOptions } from 'stream';

export type ReadWriteOptions = { length?: number } & WritableOptions;
export type AudioExportType = 'single' | 'separate';
export type UserVolumesDict = Record<string, number | undefined>;
export type RecordOptions = {
    /**
     * Keep last x minutes for recording. Older voice chunks will be deleted. Default 10.
     */
    maxUserRecordingLength: number;
    /**
     * Maximum size in MB a user stream can have. Default 100.
     */
    maxRecordTimeMs: number;
    /**
     * Target sample rate of the recorded stream. Default 16,000.
     */
    sampleRate: number;
    /**
     * Target channel count of the recorded stream. Default 2.
     */
    channelCount: number;
}

export interface ChunkArrayItem {
    chunk: Buffer;
    encoding: BufferEncoding
}

export interface BufferArrayElement {
    chunk: Buffer;
    encoding: BufferEncoding;
    startTime: number;
    stopTime: number
}

export interface EncodingOptions {
    chunkSize: number;
    sampleRate: number;
    numChannels: number;
    bytesPerElement: number;
}

export interface SocketServerConfig {
    url: string;
    server: Server;
}

export interface UserStreams {
    [userId: string]: {
        source: AudioReceiveStream,
        out: ReplayReadable,
    } | undefined;
}

export interface DiscordClientInterface {
    users: {
        fetch: (userId: string) => Promise<{username: string}>
    }
}

export interface VoiceConnectionBasic {
    receiver: {
        speaking: SpeakingMap;
        subscribe: VoiceReceiver['subscribe'];
    };
    joinConfig: {
        guildId: string;
    };
}
