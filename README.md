# Mavis App Tracking library
This is a client for the Mavis tracking API. This library uses the same Event modeling as described in the [Mavis API documentation](https://docs.skymavis.com/mavis/app-tracking/guides/tracking-api#events). 
## Getting Started

Initialise the `MavisTracking` instance
```typescript
import MavisTracking from "@kurorobeasts/mavis-app-tracking";
// This will start a session and send events to the server every 10 seconds by default.
// As long as this instance is alive, it will keep sending events to the server unless explicitely stopped.
const tracking = new MavisTracking(API_KEY);
```
Now you're ready to start sending events to the server. But first you need to identify the user in order to get proper Events data.
**Note:** If no `API_URL` is provided, the library will use the default Mavis tracking API URL.
### Identifying the user
```typescript
tracking.identify("user_id", "ronin_address", { key: "value" });
// you can also add a third parameter for platform properties
tracking.identify("user_id", "ronin_address", { key: "value" }, { platform_name: "web" });
````

### Sending events

```typescript
tracking.track("event_name", { key: "value" });
```
### Tracking screens
At the moment of writing this README, this library doesn't track screens automatically. You need to track screens manually.
```typescript
tracking.screen("screen_name", { key: "value" });
```
### Changing session
If you need to start a new session, you can reset the session and identify the user again.
```typescript
tracking.ResetSession();
tracking.identify("new_user_id", "new_user_ronin_address", { key: "value"});
```
**Note:** All previous session events will be sent to the server since they're already in the queue. New queued events will be linked to the new session.
### Gracefully stopping the tracking
If you need to stop the tracking, you can call the `shutdown` method. This will stop the interval that sends events to the server; all queued events will be sent to the server.
But remember, if you need to start tracking again, you need to create a new instance of `MavisTracking`.
```typescript
await tracking.shutdown();
```
To see some examples, check the tests.
## License

MIT
