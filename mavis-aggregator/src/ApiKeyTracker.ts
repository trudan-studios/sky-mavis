import {FLUSH_INTERVAL, MAVIS_API_URL, MAX_BODY_SIZE, MAX_REQUESTS_PER_SECOND} from "./constants";
import {Event} from "./types";

export default class ApiKeyTracker {
    private readonly apiKey: string;
    private readonly queue: Event[] = [];
    private requestsInLastSecond: number = 0;
    private lastRequestAt: number = Date.now();

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    queueEvents(queue: Event[]): void {
        this.queue.push(...queue);
    }

    async flushEvents(): Promise<void> {
        const now = Date.now();
        if (now - this.lastRequestAt >= FLUSH_INTERVAL) {
            this.requestsInLastSecond = 0;
            this.lastRequestAt = now;
        }

        if (this.requestsInLastSecond > MAX_REQUESTS_PER_SECOND) {
            console.log('Rate limit reached, deferring flush');
            return;
        }

        let eventsToSend: Event[] = [];
        let currentSize = 0;
        while (this.queue.length > 0) {
            const event = this.queue[0]; // Peek the next event
            const newSize = currentSize + (new TextEncoder().encode(JSON.stringify(event)).length);
            if (newSize > MAX_BODY_SIZE) break;
            eventsToSend.push(this.queue.shift()!);
            currentSize = newSize;
        }

        if (eventsToSend.length === 0) return;
        await this.sendEvents(eventsToSend, currentSize);
    }

    private async sendEvents(events: Event[], size: number): Promise<void> {
        try {
            this.requestsInLastSecond++;
            console.log(`Flushing ${events.length} events (${size} bytes) using API key ${this.apiKey.slice(0, 5)}...${this.apiKey.slice(-5)}`);
            const response = await fetch(MAVIS_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${btoa(this.apiKey + ':')}`,
                },
                body: JSON.stringify({api_key: this.apiKey, events}),
            });
            console.log(`Flush response: ${response.status}`);
            if (!response.ok) {
                console.error(`Failed to flush events: ${response.status} ${await response.text()}`);
            } else {
                console.log(await response.json());
            }
        } catch (e) {
            console.error('Error sending queue:', e);
            this.queue.unshift(...events); // Put the events back in the queue
        }
    }
}