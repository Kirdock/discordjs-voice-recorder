# Voice recorder for discord.js
Voice recorder or more like a replay buffer for discord.js. Base functionality is "save last x minutes".
The output format can be determined to just be a single `.mp3` file or a `.zip` file that contains one audio track per user.

[![npm version](https://img.shields.io/npm/v/%40kirdock%2Fdiscordjs-voice-recorder)](https://www.npmjs.com/package/@kirdock/discordjs-voice-recorder)

## Difference to other voice recording solutions
You get the track as you would hear it in the voice channel. It's not just the chunks when someone is talking. => The time when someone is not speaking is added.

## Requirements
- `ffmpeg` has to be installed

**Disclaimer**

I suggest not using Windows (or just use WSL). Reason: `sodium` is cumbersome to install.

## How to install
Simply run `npm install @kirdock/discordjs-voice-recorder` or `yarn add @kirdock/discordjs-voice-recorder`

## How to use

```ts
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';

const voiceRecorder = new VoiceRecorder();
// optionally provide your Discord client as second parameter in order to have ${username}.mp3 for .zip export rather than ${userId}.mp3


// start recording on a specific connection
voiceRecorder.startRecording(myVoiceConnection);

// save last 5 minutes as .mp3
await voiceRecorder.getRecordedVoice(yourWriteStream, guildId, 'single', 5);
// {yourWriteStream} can be any writeStream. E.g. response object of express or just fs.createWriteStream('myFile.mp3')

// save last 5 minutes as .zip
await voiceRecorder.getRecordedVoice(yourWriteStream, guildId, 'separate', 5);
// {yourWriteStream} can be any writeStream. E.g. response object of express or just fs.createWriteStream('myFile.zip')

// optionally you can provide a dict {[userId]: volume} to adjust the user volume of specific users
await voiceRecorder.getRecordedVoice(yourWriteStream, guildId, 'single', 5, {['1234567']: 80}); // 80%

// stop recording on a specific connection
voiceRecorder.stopRecording(myVoiceConnection);
```

# Implementation example
https://github.com/Kirdock/recordy

## Why is voice recording with discord.js such a big pain?
Because Discord just provides audio chunks (20ms per chunk I guess) when a user is speaking.
Problems are
1. We don't have a single track for a voice channel. Each user has its own stream.
2. We don't have the delay when a user stops and starts speaking again.

=> We have to manually sync the user streams and manually add the delays when a user is speaking.
