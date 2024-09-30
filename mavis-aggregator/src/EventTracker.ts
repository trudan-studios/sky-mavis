import {Event} from "./types";
import ApiKeyTracker from "./ApiKeyTracker";
import {FLUSH_INTERVAL} from "./constants";

export default class EventTracker {
    private trackers: Map<string, ApiKeyTracker> = new Map();

    async startTracking(apiKey: string, events: Event[]) {
        let tracker = this.trackers.get(apiKey);
        if (!tracker) {
            tracker = new ApiKeyTracker(apiKey);
            this.trackers.set(apiKey, tracker);
        }

        tracker.queueEvents(events);
    }

    startFlushInterval() {
        setInterval(() => {
            // TODO: double check, we may want to make this parallel (Promise.allSettled)
            this.trackers.forEach(async (tracker) => {
                await tracker.flushEvents();
            });
        }, FLUSH_INTERVAL)
    }
}