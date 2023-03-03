import { BufferArrayElement, EncodingOptions } from '../models/types';

export function addSilentTime(bufArr: BufferArrayElement[], timeMs: number, encoding: BufferEncoding, options: EncodingOptions): void {
    let endTimeBefore = getLastStopTime(bufArr);
    if (timeMs <= 0 || !endTimeBefore) {
        return;
    }
    const silentBuffers = secondsToBuffer(timeMs / 1_000, options);
    if (!silentBuffers.length) {
        return;
    }
    const step = timeMs / silentBuffers.length;
    for (const chunk of silentBuffers) {
        bufArr.push({chunk, encoding, startTime: endTimeBefore, stopTime: endTimeBefore + step});
        endTimeBefore += step; // step instead of this.chunkTimeMs, just to be sure
    }
}

export function secondsToBuffer(seconds: number, options: EncodingOptions): Buffer[] {
    const bytes = secondsToBytes(seconds, options.sampleRate, options.numChannels);
    return bytesToBuffer(bytes, options.chunkSize);
}

/**
 * Silent padding will be added if the stream is missing time (if asynchronous or when the user didn't speak for a while). Then it will be synchronous again
 * @param bufArr
 * @param chunkStartTimeBefore
 * @param chunkStartTimeNew
 * @param encodingOptions
 */
export function syncStream(bufArr: BufferArrayElement[], chunkStartTimeBefore: number, chunkStartTimeNew: number, encodingOptions: EncodingOptions): void {
    const timeFromStartToStart = chunkStartTimeNew - chunkStartTimeBefore;
    const recordTime = getRecordTimeTillEnd(bufArr, chunkStartTimeBefore, encodingOptions.sampleRate, encodingOptions.numChannels);
    addSilentTime(bufArr, timeFromStartToStart - recordTime, 'buffer' as BufferEncoding, encodingOptions);
}

export function getLastStopTime(bufArr: BufferArrayElement[]): number | undefined {
    return bufArr[bufArr.length - 1]?.stopTime;
}

function bytesToBuffer(bytes: number, chunkSize: number): Buffer[] {
    const silentPerChunk = Math.floor(bytes / chunkSize);
    const buffers: Buffer[] = [];
    for (let i = 0; i < silentPerChunk; ++i) {
        buffers.push(Buffer.alloc(chunkSize));
    }

    return buffers;
}

function secondsToBytes(silenceTimeSec: number, sampleRate: number, numChannels: number): number {
    const totalSamples = silenceTimeSec * sampleRate;
    return totalSamples * numChannels * Uint8Array.BYTES_PER_ELEMENT * 2; // I don't know why 2, but without it, we only have half of the silent bytes needed
}

export function getChunkTimeMs(chunk: Buffer, sampleRate: number, numChannels: number): number {
    const bytesPerSample = Uint8Array.BYTES_PER_ELEMENT;
    const totalSamples = chunk.byteLength / bytesPerSample / numChannels;
    return (totalSamples / sampleRate / 2) * 1_000;
}

function getRecordTimeTillEnd(bufArr: BufferArrayElement[], startTime: number, sampleRate: number, numChannels: number): number {
    let i = 0, time = 0;
    if (!bufArr[i]?.startTime) {
        return 0;
    }
    // go till startTime
    while (bufArr[i].startTime < startTime) {
        ++i;
    }

    // after start time calculate time till end
    for (i; i < bufArr.length; ++i) {
        time += getChunkTimeMs(bufArr[i].chunk, sampleRate, numChannels);
    }
    return time;
}
