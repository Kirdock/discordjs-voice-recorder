# Voice recorder for discord.js
Voice recorder or more like a replay buffer for discord.js. Base functionality is "save last x minutes".
The output format can be determined to just be a single `.mp3` file or a `.zip` file that contains one audio track per user.

## Requirements
`ffmpeg` has to be installed

## How to install
Simply run `npm i @kirdock/discordjs-voice-recorder` or `yarn add @kirdock/discordjs-voice-recorder`

## How to use

```ts
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';

const voiceRecorder = new VoiceRecorder();

// start recording on a specific connection
voiceRecorder.startRecording(myVoiceConnection);

// save last 5 minutes as .mp3
await voiceRecorder.getRecordedVoice(yourWriteStream, guildId, 'single', 5);
// {yourWriteStream} can be any writeStream. E.g. response object of express or just fs.createWriteStream('myFile.mp3')

// save last 5 minutes as .zip
await voiceRecorder.getRecordedVoice(yourWriteStream, guildId, 'separate', 5);
// {yourWriteStream} can be any writeStream. E.g. response object of express or just fs.createWriteStream('myFile.zip')

// stop recording on a specific connection
voiceRecorder.stopRecording(myVoiceConnection);
```

## Why is voice recording with discord.js such a big pain?
Because Discord just provides audio chunks (20ms per chunk I guess) when a user is speaking.
Problems are
1. We don't have a single track for a voice channel. Each user has its own stream.
2. We don't have the delay when a user stops and starts speaking again.

=> We have to manually sync the user streams and manually add the delays when a user is speaking.


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
  silentTimeMs = endDateOfLatestChunk - startTimeOfChunk;
  
  split into chunks with same length.
```
