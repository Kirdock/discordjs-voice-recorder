export type AudioExportType = 'audio' | 'mkv';
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
}
