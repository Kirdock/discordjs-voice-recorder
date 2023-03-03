import { AudioReceiveStream, EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg';
import { resolve } from 'path';
import { ReplayReadable } from './replay-readable';
import { AudioExportType, SocketServerConfig, UserStreams, RecordOptions, UserVolumesDict } from '../models/types';
import { PassThrough, Readable, Writable } from 'stream';
import { Server } from 'net';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import * as net from 'net';
import { Client } from 'discord.js';

export class VoiceRecorder {
    private readonly options: Omit<RecordOptions, 'recordDirectory'>;
    private static readonly PCM_FORMAT = 's16le';
    private writeStreams: {
        [guildId: string]: {
            userStreams: UserStreams,
            listener: (userId: string) => void;
        } | undefined
    } = {};

    /**
     *
     * @param options Record options
     * @param discordClient The client is used to translate the userId into the username. This is just important for .zip export. The filename contains the username, else it contains the userId
     */
    constructor(options: Partial<RecordOptions> = {}, private discordClient?: Client) {
        this.options = {
            maxUserRecordingLength: (options.maxUserRecordingLength ?? 100) * 1_024 * 1_024,
            maxRecordTimeMs: (options.maxRecordTimeMs ?? 10) * 60 * 1_000,
            sampleRate: (options.sampleRate ?? 16_000),
            channelCount: (options.channelCount ?? 2),
            userVolumes: options.userVolumes ?? {},
        };
    }

    public startRecording(connection: VoiceConnection): void {
        const guildId = connection.joinConfig.guildId;
        if (this.writeStreams[guildId]) {
            return;
        }
        const listener = (userId: string) => {
            const streams:  {source: AudioReceiveStream, out: ReplayReadable} | undefined = this.writeStreams[guildId]?.userStreams[userId];
            if(streams) {
                // already listening
                return;
            }
            this.startRecordStreamOfUser(guildId, userId, connection);
        }
        this.writeStreams[guildId] = {
            userStreams: {},
            listener,
        };
        connection.receiver.speaking.on('start', listener);
    }

    private startRecordStreamOfUser(guildId: string, userId: string, connection: VoiceConnection): void {
        const serverStream = this.writeStreams[guildId];
        if(!serverStream) {
            return;
        }

        const recordStream = new ReplayReadable(this.options.maxRecordTimeMs, this.options.sampleRate, this.options.channelCount, ()=>  connection.receiver.speaking.users.get(userId), {
            highWaterMark: this.options.maxUserRecordingLength,
            length: this.options.maxUserRecordingLength
        });
        const opusStream = connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: this.options.maxRecordTimeMs,
            },
        });

        opusStream.on('error', (error: Error) => {
            console.error(error, `Error while recording voice for user ${userId} in server: ${guildId}`);
        });

        opusStream.on('end', () => {
            this.stopUserRecording(guildId, userId);
        });

        opusStream.pipe(recordStream, {end: false});

        serverStream.userStreams[userId] = { out: recordStream, source: opusStream };
    }

    /**
     * Stops the voice recording for the specified voice connection
     * @param connection
     */
    public stopRecording(connection: VoiceConnection): void {
        const guildId = connection.joinConfig.guildId;
        const serverStreams = this.writeStreams[guildId];
        if(!serverStreams) {
            return;
        }
        connection.receiver.speaking.removeListener('start', serverStreams.listener);

        for (const userId in serverStreams.userStreams) {
            this.stopUserRecording(guildId, userId);
        }
        delete this.writeStreams[guildId];
    }

    private stopUserRecording(guildId: string, userId: string): void {
        const serverStreams = this.writeStreams[guildId];
        if(!serverStreams) {
            return;
        }
        const userStream = serverStreams.userStreams[userId];
        if(!userStream) {
            return;
        }
        userStream.source.destroy();
        userStream.out.destroy();
        delete serverStreams.userStreams[userId];
    }

    /**
     *
     * @param writeStream The write stream in that the mp3 or zip file has to be saved. e.g. the response object of express or simply fs.createWriteStream('myFile.mp3')
     * @param guildId Guild if of the server. Determines on which server the recording should be saved
     * @param exportType Export type of the recording. Can either be 'single' => .mp3 or 'separate' => .zip
     * @param minutes Determines how many minutes (max is options.maxRecordTimeMs/1_000/60)
     */
    public async getRecordedVoice<T extends Writable>(writeStream: T, guildId: string, exportType: AudioExportType = 'single', minutes: number = 10): Promise<boolean> {
        const serverStream = this.writeStreams[guildId];
        if (!serverStream) {
            console.warn(`server with id ${guildId} does not have any streams`, 'Record voice');
            return false;
        }
        const minStartTimeMs = this.getMinStartTime(guildId);

        if (!minStartTimeMs) {
            return false;
        }

        const recordDurationMs = Math.min(Math.abs(minutes) * 60 * 1_000, this.options.maxRecordTimeMs);
        const endTimeMs = Date.now();
        const maxRecordTime = endTimeMs - recordDurationMs;
        const startRecordTime = Math.max(minStartTimeMs, maxRecordTime);
        const recordMethod = (exportType === 'single' ? this.generateMergedRecording : this.generateSplitRecording).bind(this);
        const userVolumesOfServer = this.options.userVolumes[guildId];

        return recordMethod(serverStream.userStreams, startRecordTime, endTimeMs, writeStream, userVolumesOfServer);
    }

    private generateMergedRecording(userStreams: UserStreams, startRecordTime: number, endTime: number, writeStream: Writable, userVolumes?: UserVolumesDict): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const {command, openServers} = this.getFfmpegSpecs(userStreams, startRecordTime, endTime, userVolumes);
            if (!openServers.length) {
                return resolve(false);
            }
            command
                .on('end', () => {
                    openServers.forEach(server => server.close());
                    resolve(true);
                })
                .on('error', (error) => {
                    openServers.forEach(server => server.close());
                    reject(error);
                })
                .outputFormat('mp3')
                .pipe(writeStream, {end: true});
        });
    }

    private async generateSplitRecording(userStreams: UserStreams, startRecordTime: number, endTime: number, writeStream: Writable, userVolumes?: UserVolumesDict): Promise<boolean> {
        const archive = archiver('zip');
        const userIds = Object.keys(userStreams);
        if (!userIds.length) {
            return false;
        }
        for (const userId of userIds) {
            const passThroughStream = this.getUserRecordingStream(userStreams[userId]!.out.rewind(startRecordTime, endTime), userId, userVolumes);
            const username = await this.getUsername(userId);
            archive.append(passThroughStream, {
                name: `${username}.mp3`
            });
        }

        return new Promise((resolve, reject) => {
            archive
                .on('end', () => resolve(true))
                .on('error', reject)
                .pipe(writeStream);
            archive.finalize();
        });
    }

    private async getUsername(userId: string): Promise<string> {
        if (this.discordClient) {
            try {
                const {username} = await this.discordClient?.users.fetch(userId);
                return username;
            } catch (error) {
                console.error(`Username of userId: ${userId} can't be fetched!`, error);
            }
        }
        return userId;
    }

    private getUserRecordingStream(stream: Readable, userId: string, userVolumes?: UserVolumesDict): PassThrough {
        const passThroughStream = new PassThrough({allowHalfOpen: false});

        ffmpeg(stream)
            .inputOptions(this.getRecordInputOptions())
            .audioFilters([
                    {
                        filter: 'volume',
                        options: ((this.getUserVolume(userId, userVolumes)) / 100).toString(),
                    }
                ]
            )
            .outputFormat('mp3')
            .output(passThroughStream, {end: true})
            .run();
        return passThroughStream;
    }

    private getUserVolume(userId: string, userVolumes?: UserVolumesDict): number {
        return userVolumes?.[userId] ?? 100;
    }

    private getMinStartTime(guildId: string): number | undefined {
        let minStartTime: number | undefined;
        const userStreams: UserStreams = this.writeStreams[guildId]?.userStreams ?? {};

        for (const userId in userStreams) {
            const startTime = userStreams[userId]!.out.startTimeMs;

            if (!minStartTime || (startTime < minStartTime)) {
                minStartTime = startTime;
            }
        }
        return minStartTime;
    }

    private getFfmpegSpecs(streams: UserStreams, startRecordTime: number, endTimeMs: number, userVolumesDict?: UserVolumesDict): { command: FfmpegCommand, openServers: Server[] } {
        let ffmpegOptions = ffmpeg();
        let amixStrings = [];
        const volumeFilter = [];
        const openServers: Server[] = [];

        for (const userId in streams) {
            const stream = streams[userId]!.out;
            try {
                const output: string = `[s${volumeFilter.length}]`;
                const {server, url} = this.serveStream(stream, startRecordTime, endTimeMs);

                ffmpegOptions = ffmpegOptions
                    .addInput(url)
                    .inputOptions(this.getRecordInputOptions());

                volumeFilter.push({
                    filter: 'volume',
                    options: [(this.getUserVolume(userId, userVolumesDict) / 100).toString()],
                    inputs: `${volumeFilter.length}:0`,
                    outputs: output,
                });
                openServers.push(server);
                amixStrings.push(output);
            } catch (e) {
                console.error(e as Error, 'Error while saving user recording');
            }
        }

        return {
            command: ffmpegOptions.complexFilter([
                ...volumeFilter,
                {
                    filter: `amix=inputs=${volumeFilter.length}`,
                    inputs: amixStrings.join(''),
                }
            ]),
            openServers,
        }
    }

    private getRecordInputOptions(): string[] {
        return [`-f ${VoiceRecorder.PCM_FORMAT}`, `-ar ${this.options.sampleRate}`, `-ac ${this.options.channelCount}`];
    }

    private serveStream(stream: ReplayReadable, startRecordTime: number, endTimeMs: number): SocketServerConfig {
        const socketPath = resolve('/tmp/', randomUUID() + '.sock');
        const url = 'unix:' + socketPath;
        const server = net.createServer((socket) => stream.rewind(startRecordTime, endTimeMs).pipe(socket));
        server.listen(socketPath);
        // complex filters are probably reading the files several times. Therefore, the server can't be closed after the stream is read.
        return {
            url,
            server
        };
    }
}
