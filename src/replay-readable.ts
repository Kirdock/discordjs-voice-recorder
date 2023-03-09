import { OpusEncoder } from '@discordjs/opus';
import { Readable, Writable, WritableOptions } from 'stream';
import { getChunkTimeMs, getLastStopTime, secondsToBuffer, syncStream } from '../utils/replay-readable.utils';
import { BufferArrayElement, ChunkArrayItem, EncodingOptions, ReadWriteOptions } from '../models/types';
import Timeout = NodeJS.Timeout;

export class ReplayReadable extends Writable {
    private readonly _highWaterMark: number;
    private readonly _bufArr: BufferArrayElement[];
    private readonly _bufArrLength: number; // max _bufArr length
    private readonly _readableOptions: ReadWriteOptions;
    private _waiting: ((error?: Error | null) => void) | null;
    private readonly fadeOutInterval: Timeout;
    private readonly _encoder: OpusEncoder;
    private readonly encodingOptions: EncodingOptions;
    private _startTimeOfNextChunk?: number;
    private _startTimeOfChunkBefore?: number;

    /**
     *
     * @param lifeTimeMs max record time in milliseconds. Older chunks get deleted
     * @param sampleRate
     * @param numChannels
     * @param getUserSpeakingTime
     * @param options
     */
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore ignore that super() has to be called at the very top
    constructor(lifeTimeMs: number, sampleRate: number, numChannels: number, private getUserSpeakingTime: () => number | undefined, options?: ReadWriteOptions) {
        const adjustedOptions = Object.assign({
            length: 1048576, // 2^20 = 1 MB
            highWaterMark: 32,
            dropInterval: 1e3
        }, options) as WritableOptions & { length: number, highWaterMark: number, dropInterval: number };
        super(adjustedOptions);

        const chunkTimeMs = 20;
        const bytesPerElement = 2; // buffer is Uint8Array but the data inside is PCM 16-bit
        this._readableOptions = adjustedOptions;
        this._encoder = new OpusEncoder(sampleRate, numChannels);
        this.encodingOptions = {
            numChannels,
            sampleRate,
            chunkSize: (chunkTimeMs / 1000) * sampleRate * numChannels * Uint8Array.BYTES_PER_ELEMENT * bytesPerElement,
            bytesPerElement,
        }
        this._highWaterMark = adjustedOptions.highWaterMark;
        this._bufArrLength = adjustedOptions.length;
        this._bufArr = [];
        this._waiting = null;
        this.fadeOutInterval = setInterval(() => {
            this.fadeOutCheck(lifeTimeMs);
        }, 5_000); // check every 5 seconds if some chunks timed out
    }

    private get startTimeOfNextChunk(): undefined | number {
        return this._startTimeOfNextChunk;
    }

    private set startTimeOfNextChunk(time: number | undefined) {
        if (this._startTimeOfChunkBefore && time) {
            syncStream(this._bufArr, this._startTimeOfChunkBefore, time, this.encodingOptions)
        }
        this._startTimeOfNextChunk = this._startTimeOfChunkBefore = time;
    }

    public get startTimeMs(): number {
        return this._bufArr[0]?.startTime ?? Date.now();
    }

    public _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        // encoding is 'buffer'... whatever...

        const userStartedSpeaking =  this.getUserSpeakingTime();
        const userJustBeganSpeaking = userStartedSpeaking !== this._startTimeOfChunkBefore;
        if(userJustBeganSpeaking) {
            this.startTimeOfNextChunk = userStartedSpeaking;
        }

        // start time of the user in the speaking map is probably the real start time and not the time the chunk is received. So it's probably not startTime - chunkTime
        const addTime = this.getStartTimeOfNextChunk();

        chunk = this.decodeChunk(chunk); // always 1280 bytes; 20 ms
        const startTimeOfNewChunk = userJustBeganSpeaking ? addTime : getLastStopTime(this._bufArr) as number; // there must be an element because isCorrectStartTime is true before it starts recording

        this._bufArr.push({
            chunk,
            encoding,
            startTime: startTimeOfNewChunk,
            stopTime: startTimeOfNewChunk + getChunkTimeMs(chunk, this.encodingOptions.sampleRate, this.encodingOptions.numChannels, this.encodingOptions.bytesPerElement)
        });
        this.checkAndDrop(callback);
        this.emit('wrote');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public _writev(chunks: Array<ChunkArrayItem>, callback: (error?: Error | null) => void) {
        this.emit('wrote');
    }

    public _destroy(error: Error | null, callback: (error?: (Error | null)) => void) {
        clearInterval(this.fadeOutInterval);
        super._destroy(error, callback);
    }

    private drop(): void {
        if (this._bufArr.length > this._bufArrLength) {
            this.emit('drop', this._bufArr.splice(0, this._bufArr.length - this._bufArrLength).length);
        }
    }

    public rewind(startTime: number, stopTime: number): Readable {
        const ret: Readable = new Readable({
            highWaterMark: this._readableOptions.highWaterMark,
            read: () => {
                // continue to write the user stream within the time frame
                for (let i = this.writeSkipAndDelay(ret, startTime); i < this._bufArr.length && this._bufArr[i].startTime < stopTime; ++i) {
                    const element = this._bufArr[i];
                    const resp = ret.push(element.chunk, element.encoding);
                    if (!resp) { // until there's not willing to read
                        break;
                    }
                }

                ret.push(null); // null = end of stream
            }
        });

        return ret;
    }

    /**
     * Skips the user stream up to the start of the record time or adds a delay until the start time
     * @param ret
     * @param startTime
     * @private
     * @return index of the next buffer element that can be processed
     */
    private writeSkipAndDelay(ret: Readable, startTime: number): number {
        for (let i = 0; i < this._bufArr.length; ++i) {
            const element = this._bufArr[i];

            if (element.startTime >= startTime) {
                // add delay time till start time of user
                const delayTimeSec = (element.startTime - startTime) / 1_000;
                if (delayTimeSec > 0) {
                    const buffers = secondsToBuffer(delayTimeSec, this.encodingOptions);
                    for (const buffer of buffers) {
                        ret.push(buffer, this._bufArr[0].encoding);
                    }
                }
                return i;
            } // else skipTime
        }
        return this._bufArr.length;
    }

    private checkAndDrop(callback: (error?: Error | null) => void): void {
        if (this._bufArr.length > this._bufArrLength) {
            this._waiting = callback;
            this.drop();
        } else {
            callback();
        }
    }

    private getStartTimeOfNextChunk(): number {
        const time = this.startTimeOfNextChunk || getLastStopTime(this._bufArr) || Date.now();
        this._startTimeOfNextChunk = undefined;
        return time;
    }

    private decodeChunk(chunk: Buffer): Buffer {
        return this._encoder.decode(chunk);
    }

    private fadeOutCheck(lifeTime: number): void {
        const newDate = Date.now();
        let dropped = 0;
        while (dropped < this._bufArr.length && (newDate - this._bufArr[dropped].startTime) > lifeTime) {
            ++dropped
        }
        if (dropped) {
            this._bufArr.splice(0, dropped);
            this.emit('drop', dropped);
        }
    }
}
