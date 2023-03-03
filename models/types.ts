import { Server } from 'net';
import { ReplayReadable } from '../src/replay-readable';
import { AudioReceiveStream } from '@discordjs/voice';
import { WritableOptions } from 'stream';

export type ReadWriteOptions = { length?: number } & WritableOptions;
export type AudioExportType = 'single' | 'separate';
export type UserVolumesDict = Record<string, number | undefined>;
export type UserVolumesDictOfGuild = Record<string, UserVolumesDict | undefined>;
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
    /**
     * Target directory for saving recordings
     */
    recordDirectory?: string;
    userVolumes: UserVolumesDictOfGuild;
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
