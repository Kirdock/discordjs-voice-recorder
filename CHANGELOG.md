# 1.0.5
- Fix: `maxRecordTimeMs` was actually taken as minutes instead of ms.
- Doc: The description for the record time and length were switched.

# 1.0.4
- Fix: Changed how user streams are served/merged during the ffmpeg process in Windows.

# 1.0.3
- Fix: There was a Windows permission error because an invalid temp path was taken.

# 1.0.2
- I'm just testing something here.

# 1.0.1
- Feature: You can now export the recording as stream (`getRecordedVoiceAsReadable`).
- Feature: You can now export the recording as buffer (`getRecordedVoiceAsBuffer`).
- Minor: Export some types.
- Minor: User volumes can now set on save rather than on init.