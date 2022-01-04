# Voice recorder for discord.js (Experimental)
Voice recorder or more like a replay buffer for discord.js. Base functionality is "save last x minutes".
The output format can be determined to just be a single `.wav` file or a `.mkv` files that contains the full audio track and one audio track for each user. 

It's experimental and there may be some bugs.
Biggest issue here is that Node.Js is single threaded. It would be a perfect solution if each user stream is tracked in its own thread.

When I have the motivation I'll publish it. 

## Why is voice recording with discord.js such a big pain?
Because Discord just provides audio chunks (20ms per chunk I guess) when a user is speaking.
Problems are
1. We don't have a single track for a voice channel. Each user has its own stream.
2. We don't have the delay when a user stops and starts speaking again.

=> We have to manually sync the user streams and manually add the delays when a user is speaking.

The more users are speaking and the less powerful the system is that runs the bot the more incorrect will this solution be. 

## Environment variables
- MAX_RECORD_TIME_MINUTES: Keep last x minutes for recording. Older voice chunks will be deleted. Default 10.
- MAX_USER_STREAM_MB: Maximum size in MB a user stream can have. Default 100.
- SAMPLE_RATE: Target sample rate of the recorded stream. Default 16,000.
- CHANNEL_COUNT: Target channel count of the recorded stream. Default 2.


## Overview for calculation of skip time and delay time
```
------|----------------------|----------------|-------------------------------|-------
------|----------------------|----------------|-------------------------------|-------
     user1 Start      startRecordTime    user2 Start                        endTime
      |<-----skipTime------->|<---delayTime-->|

 delayTime = userStartTime - startRecordTime  // valid if > 0
 skipTime = startRecordTime - userStartTime   // valid if > 0
```
