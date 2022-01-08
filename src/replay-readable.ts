import { Readable, Writable, WritableOptions } from 'stream';
import { OpusEncoder } from '@discordjs/opus';
import Timeout = NodeJS.Timeout;

type BufferArrayElement = [Buffer, BufferEncoding, number, number]; // chunk, encoding, startTime (time chunk received), endTime (time chunk pushed to array)
type ReadWriteOptions = { length?: number } & WritableOptions;

// adjusted version of https://github.com/scramjetorg/rereadable-stream
export class ReplayReadable extends Writable {
    private readonly _highWaterMark: number;
    public readonly _bufArr: BufferArrayElement[];
    private readonly _bufArrLength: number; // max _bufArr length
    private readonly fadeOutInterval: Timeout;
    private readonly numChannels: number;
    private readonly sampleRate: number;
    private readonly _encoder: OpusEncoder;
    private readonly chunkSize: number;
    private currentOffset: number;
    private readonly chunkTimeMs: number;

    // lifeTime in milliseconds
    constructor(lifeTime: number, sampleRate: number, numChannels: number, options?: ReadWriteOptions) {
        const adjustedOptions = Object.assign({
            length: 1048576, // 2^20 = 1 MB
            highWaterMark: 32,
            dropInterval: 1e3
        }, options) as WritableOptions & { length: number, highWaterMark: number, dropInterval: number };

        super(adjustedOptions);

        this.numChannels = numChannels;
        this.sampleRate = sampleRate;
        this._encoder = new OpusEncoder(this.sampleRate, this.numChannels);
        this.currentOffset = 0;
        this.chunkTimeMs = 20;
        this.chunkSize = (this.chunkTimeMs / 1000) * this.sampleRate * this.numChannels * Uint8Array.BYTES_PER_ELEMENT * 2; // 20ms per chunk; I don't know why times 2 but without it the time is not correct

        this._highWaterMark = adjustedOptions.highWaterMark ?? 32;
        this._bufArrLength = adjustedOptions.length;

        this._bufArr = [];
        this.fadeOutInterval = setInterval(() => {
            const newDate = Date.now();

            let dropped;
            for (dropped = 0; dropped < this._bufArr.length && (newDate - this._bufArr[dropped][2]) > lifeTime; ++dropped) {
            }
            if (dropped) {
                this._bufArr.splice(0, dropped);
                this.emit('drop', dropped);
            }
        }, 5_000); // check every 5 seconds if some chunks timed out
    }

    public get startTime(): number {
        return this._bufArr[0]?.[2] ?? Date.now();
    }

    public _destroy(error: Error | null, callback: (error?: (Error | null)) => void) {
        clearInterval(this.fadeOutInterval);
        super._destroy(error, callback);
    }

    public _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        // encoding is 'buffer'... whatever...
        const addTime = Date.now();

        chunk = this.decodeChunk(chunk); // always 1280 bytes; 40 ms or 20 ms for 16 kHz, 2 channels
        const startTimeOfChunk = this.getStartTimeOfChunk(chunk, addTime);

        const silentBuffers = this.getSilentBuffer(startTimeOfChunk);
        let endTimeBefore = this._bufArr[this._bufArr.length - 1]?.[3];
        for (const ch of silentBuffers) {
            // I sometimes had the issue that there was some noise. Probably related to missing bytes in a chunk.
            // That's why I chose to split the chunk more chunks with the size chunkSize.
            // Maybe can also be solved if we subtract (amountOfBytes - (amountOfBytes % chunkSize))
            this._bufArr.push([ch, encoding, endTimeBefore, Date.now()]);
            endTimeBefore += this.chunkTimeMs;
        }
        this._bufArr.push([chunk, encoding, startTimeOfChunk, Date.now()]);
        callback();
        this.emit('wrote');
    }

    public rewind(startTime: number, stopTime: number): Readable {
        const ret: Readable = new Readable({
            highWaterMark: this._highWaterMark,
            read: () => {
                let delayAdded = false;
                for (let i = 0; i < this._bufArr.length; ++i) {
                    const [chunk, encoding, chunkStartTime] = this._bufArr[i];

                    if (chunkStartTime < startTime) { // skipTime
                        continue;
                    } else if (!delayAdded) {
                        // add delay time till start time of user in order to sync all users
                        const delayTimeSec = (chunkStartTime - startTime) / 1_000;
                        if (delayTimeSec > 0) {
                            const buffers = this.getSilentBuffer(delayTimeSec, false, true);
                            for (const buffer of buffers) {
                                ret.push(buffer, this._bufArr[0][1]);
                            }
                        }
                        delayAdded = true;
                    }

                    if (chunkStartTime > stopTime) { // read everything till stopTime. Recording could increase till the last user stream is saved.
                        break;
                    }

                    const resp = ret.push(chunk, encoding); // push to readable
                    if (!resp) { // until there's not willing to read
                        break;
                    }
                }
                ret.push(null);
            }
        });

        return ret;
    }

    private getSilentBuffer(stopTime: number, isWriting = true, isSeconds = false): Buffer[] {
        const silentBytes = this.getSilentBytes(stopTime, isSeconds);
        const silentPerChunk = Math.floor(silentBytes / this.chunkSize);
        const buffers: Buffer[] = [];
        for (let i = 0; i < silentPerChunk; ++i) {
            buffers.push(Buffer.alloc(this.chunkSize))
        }
        if (isWriting) {
            this.currentOffset += silentBytes % this.chunkSize;
            if (buffers.length) {
                for (; this.currentOffset >= this.chunkSize; this.currentOffset -= this.chunkSize) {
                    buffers.push(Buffer.alloc(this.chunkSize));

                }
            }
        }
        return buffers;
    }

    /**
     *
     * @param stopTime Either the stopTime in ms or the amount of seconds
     * @param isSeconds
     * @private
     */
    private getSilentBytes(stopTime: number, isSeconds = false): number {
        const silenceTimeSec = isSeconds ? stopTime : this.getSilentSeconds(stopTime);
        if (silenceTimeSec) {
            const totalSamples = silenceTimeSec * this.sampleRate;
            return totalSamples * this.numChannels * Uint8Array.BYTES_PER_ELEMENT * 2; // I don't know why 2, but without it, we only have half of the silent bytes needed
        } else {
            return 0;
        }
    }

    private getSilentSeconds(stopTime: number) {
        const lastElement = this._bufArr[this._bufArr.length - 1];
        if (!lastElement) {
            return 0;
        }
        const endTimeBefore = lastElement[3];
        const silenceTimeSec = ((stopTime - endTimeBefore) / 1_000) - 0.04; // tolerance 40ms
        return silenceTimeSec < 0 ? 0 : silenceTimeSec;
    }

    private decodeChunk(chunk: Buffer): Buffer {
        return this._encoder.decode(chunk);
    }

    private getStartTimeOfChunk(chunk: Buffer, addTime: number): number {
        return addTime - this.getChunkTimeMs(chunk);
    }

    private getChunkTimeMs(chunk: Buffer): number {
        const bytesPerSample = Uint8Array.BYTES_PER_ELEMENT;
        const totalSamples = chunk.byteLength / bytesPerSample / this.numChannels;
        return (totalSamples / this.sampleRate / 2) * 1_000; // again, I don't know why 2
    }
}
