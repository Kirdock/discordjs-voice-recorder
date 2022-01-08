import { EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import ffmpeg from 'fluent-ffmpeg';
import { ReadStream } from 'fs';
import { join } from 'path';
import { FileHelper } from './file-helper';
import { FileWriter } from 'wav';
import { ReplayReadable } from './replay-readable';
import { AudioExportType, RecordOptions } from '../models/types';

interface UserStreams {
    [userId: string]: {
        source: ReadStream,
        out: ReplayReadable,
    };
}

export class VoiceRecorder {
    private readonly fileHelper: FileHelper;
    private readonly options: Omit<RecordOptions, 'recordDirectory'>;
    private writeStreams: {
        [guildId: string]: {
            userStreams: UserStreams,
            listener: (userId: string) => void;
        }
    } = {};

    constructor(options: Partial<RecordOptions> = {}) {
        this.options = {
            maxUserRecordingLength: (options.maxUserRecordingLength ?? 100) * 1_024 * 1_024,
            maxRecordTimeMs: (options.maxRecordTimeMs ?? 10) * 60 * 1_000,
            sampleRate: (options.sampleRate ?? 16_000),
            channelCount: (options.channelCount ?? 2),
        };
        this.fileHelper = new FileHelper(options.recordDirectory);
    }

    /**
     * Starts listening to a given voice connection
     * @param connection
     */
    public startRecording(connection: VoiceConnection): void {
        const guildId = connection.joinConfig.guildId;
        if (!this.writeStreams[guildId]) {
            const listener = (userId: string) => {
                //check if already listening to user
                if (!this.writeStreams[guildId].userStreams[userId]) {
                    const out = new ReplayReadable(this.options.maxRecordTimeMs, this.options.sampleRate, this.options.channelCount, {highWaterMark: this.options.maxUserRecordingLength, length: this.options.maxUserRecordingLength});
                    const opusStream = connection.receiver.subscribe(userId, {
                        end: {
                            behavior: EndBehaviorType.AfterSilence,
                            duration: this.options.maxRecordTimeMs,
                        },
                    }) as unknown as ReadStream;


                    opusStream.on('end', () => {
                        delete this.writeStreams[guildId].userStreams[userId];
                    });
                    opusStream.on('error', (error: Error) => {
                        console.error(error, `Error while recording voice of user ${userId}`);
                        delete this.writeStreams[guildId].userStreams[userId];
                    });

                    opusStream.pipe(out);

                    this.writeStreams[guildId].userStreams[userId] = {
                        source: opusStream,
                        out
                    };
                }
            }
            this.writeStreams[guildId] = {
                userStreams: {},
                listener,
            };
            connection.receiver.speaking.on('start', listener);
        }
    }

    /**
     * Stops recording for a given voice connection
     * @param connection
     */
    public stopRecording(connection: VoiceConnection): void {
        const guildId = connection.joinConfig.guildId;
        const serverStreams = this.writeStreams[guildId];
        connection.receiver.speaking.removeListener('start', serverStreams.listener);

        for (const userId in serverStreams.userStreams) {
            const userStream = serverStreams.userStreams[userId];
            userStream.source.destroy();
            userStream.out.destroy();
        }
        delete this.writeStreams[guildId];
    }

    /**
     * Saves last x minutes of the recording
     * @param guildId id of the guild/server where the recording should be fetched
     * @param exportType save file either as wav or mkv
     * @param minutes timeframe for the recording. X last minutes
     * @returns the path to the created file
     */
    public async getRecordedVoice(guildId: string, exportType: AudioExportType = 'audio', minutes: number = 10): Promise<string | undefined> {
        if (!this.writeStreams[guildId]) {
            console.warn(`server with id ${guildId} does not have any streams`, 'Record voice');
            return;
        }
        const recordDurationMs = Math.min(Math.abs(minutes) * 60 * 1_000, this.options.maxRecordTimeMs)
        const endTime = Date.now();
        return new Promise(async (resolve, reject) => {
            const minStartTime = this.getMinStartTime(guildId);

            if (minStartTime) {
                const {command, createdFiles} = await this.getFfmpegSpecs(this.writeStreams[guildId].userStreams, minStartTime, endTime, recordDurationMs);
                if (createdFiles.length) {
                    const resultPath = join(this.fileHelper.baseDir, `${endTime}.wav`);
                    command
                        .on('end', async () => {
                            let path;
                            if (exportType === 'audio') {
                                path = resultPath;
                                await this.fileHelper.deleteFilesByPath(createdFiles);
                            } else {
                                const files = [resultPath, ...createdFiles];
                                path = await this.toMKV(files, endTime);
                                await this.fileHelper.deleteFilesByPath(files);
                            }
                            resolve(path);
                        })
                        .on('error', reject)
                        .saveToFile(resultPath);
                } else {
                    resolve(undefined);
                }
            } else {
                resolve(undefined);
            }
        });
    }

    private toMKV(files: string[], endTime: number): Promise<string> {
        return new Promise((resolve, reject) => {
            let options = ffmpeg();
            const outputOptions: string[] = [];
            const filePath = join(this.fileHelper.baseDir, `${endTime}.mkv`);
            for (let i = 0; i < files.length; ++i) {
                options = options.addInput(files[i]);
                outputOptions.push(`-map ${i}`);
            }
            options
                .outputOptions(outputOptions)
                .on('end', () => {
                    resolve(filePath);
                })
                .on('error', reject)
                .saveToFile(filePath);
        })
    }

    private getMinStartTime(guildId: string): number | undefined {
        let minStartTime: number | undefined;
        for (const userId in this.writeStreams[guildId].userStreams) {
            const startTime = this.writeStreams[guildId].userStreams[userId].out.startTime;

            if (!minStartTime || (startTime < minStartTime)) {
                minStartTime = startTime;
            }
        }
        return minStartTime;
    }

    private async getFfmpegSpecs(streams: UserStreams, minStartTime: number, endTime: number, recordDurationMs: number) {
        const maxRecordTime = endTime - recordDurationMs;
        const startRecordTime = Math.max(minStartTime, maxRecordTime);

        // length of the result recording would be endTime - startRecordTime
        let ffmpegOptions = ffmpeg();
        let amixStrings = [];
        const createdFiles: string[] = [];

        for (const userId in streams) {
            const stream = streams[userId].out;
            const filePath = join(this.fileHelper.baseDir, `${endTime}-${userId}.wav`);
            try {
                await this.saveFile(stream, filePath, startRecordTime, endTime);
                ffmpegOptions = ffmpegOptions.addInput(filePath);

                amixStrings.push(`[${createdFiles.length}:a]`);
                createdFiles.push(filePath);
            } catch (e) {
                console.error(e, 'Error while saving user recording');
            }
        }

        return {
            command: ffmpegOptions.complexFilter([
                {
                    filter: `amix=inputs=${createdFiles.length}[a]`,
                    inputs: amixStrings.join(''),
                }
            ]).map('[a]'),
            createdFiles
        }
    }

    private async saveFile(stream: ReplayReadable, filePath: string, startTime: number, endTime: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const writeStream = new FileWriter(filePath, {
                channels: this.options.channelCount,
                sampleRate: this.options.sampleRate
            });

            const readStream = stream.rewind(startTime, endTime);

            readStream.pipe(writeStream);

            writeStream.on('done', () => {
                resolve();
            });
            writeStream.on('error', (error: Error) => {
                console.error(error, 'Error while saving user recording');
                reject(error);
            });
        });
    }
}
