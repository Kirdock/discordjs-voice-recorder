# Voice recorder for discord.js (merging of user streams included)
Voice recorder or more like a replay buffer for discord.js. Base functionality is "save last x minutes".
The output format can be determined to just be a single `.wav` file or a `.mkv` file that contains the full audio track and one audio track for each user. 

Up to now I haven't found any bugs.
Biggest issue here is that Node.js is single threaded. It would be a perfect solution if each user stream is tracked in its own thread.
So I guess this is the best possible solution for Node.js.

## Why is voice recording with discord.js such a big pain?
Because Discord just provides audio chunks (20ms per chunk I guess) when a user is speaking.
Problems are
1. We don't have a single track for a voice channel. Each user has its own stream.
2. We don't have the delay when a user stops and starts speaking again.

=> We have to manually sync the user streams and manually add the delays when a user is speaking.

The more users are speaking and the less powerful the system is that runs the bot the more incorrect will this solution be.

## Requirements
- `ffmpeg` has to be installed

## How to use

```ts
import { VoiceRecorder } from './voice-recorder';

const voiceRecorder = new VoiceRecorder();

// start recording on a specific connection
voiceRecorder.startRecording(myVoiceConnection);

// save last 5 minutes as .wav
voiceRecorder.getRecordedVoice(guildId, 'audio', 5);

// stop recording on a specific connection
voiceRecorder.stopRecording(myVoiceConnection);
```


## Overview for calculation of skip time and delay time
```
startRecordTime = endTime - (minutes /*record last x minutes*/) * 60 * 1000;

------|----------------------|----------------|-------------------------------|-------
------|----------------------|----------------|-------------------------------|-------
     user1 Start      startRecordTime    user2 Start                        endTime
      |<-----skipTime------->|<---delayTime-->|

 delayTime = userStartTime - startRecordTime  // valid if > 0
 skipTime = startRecordTime - userStartTime   // valid if > 0

each delay when user is silent:
  startTimeOfChunk = Date.now() - chunkTime;
  silentTimeMs = endDateOfLatestChunk - startTimeOfChunk - 40 // tolerance of 40ms. Node is single-threaded and other tasks distort it
  
  split into chunks with same length. Overflow will be incremented and used for next chunk.
```
