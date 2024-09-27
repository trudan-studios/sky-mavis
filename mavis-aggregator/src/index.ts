import {Hono} from 'hono'
import Redis from "ioredis";

const MAX_BODY_SIZE = 1e6; // 1MB in bytes
const MAX_REQUESTS_PER_SECOND = 100;
const FLUSH_INTERVAL = 1000; // 1 second in milliseconds
const MAVIS_API_URL = "https://x.skymavis.com/track";

type Event = {
    type: string,
    data: Record<string, any>,
}

type QueuedEvent = {
    api_key: string;
    event: Event,
}

type TrackEventBody = {
    api_key: string;
    events: Event[],
}

let requestsInLastSecond = 0;
let lastRequestTime = Date.now();
const redis = new Redis(Number(process.env.REDIS_PORT ?? 6379), process.env.REDIS_HOST!);

const app = new Hono();
const calculatePayloadSize = (events: Event[]): number => {
    return new TextEncoder().encode(JSON.stringify(events)).length;
}

const flushEvents = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastRequestTime >= FLUSH_INTERVAL) {
        requestsInLastSecond = 0;
        lastRequestTime = now;
    }

    if (requestsInLastSecond >= MAX_REQUESTS_PER_SECOND) {
        console.log('Rate limit reached, deferring flush');
        setTimeout(flushEvents, FLUSH_INTERVAL);
        return;
    }

    let eventsToSend: QueuedEvent[] = [];
    let currentSize = 0;

    while (true) {
        const nextEvent = await redis.lpop('event_queue');
        if (!nextEvent) break;
        const queuedEvent = JSON.parse(nextEvent) as QueuedEvent;
        const newSize = calculatePayloadSize([...eventsToSend.map(qe => qe.event), queuedEvent.event]);
        if (newSize > MAX_BODY_SIZE) {
            // Re-add the event to the queue
            await redis.lpush('event_queue', nextEvent);
            break;
        }
        eventsToSend.push(queuedEvent);

        currentSize = newSize;
    }

    if (eventsToSend.length > 0) {
        // Group events by API key in memory
        const groupedEvents: Record<string, Event[]> = {};
        for (const queuedEvent of eventsToSend) {
            if (!groupedEvents[queuedEvent.api_key]) {
                groupedEvents[queuedEvent.api_key] = [];
            }
            groupedEvents[queuedEvent.api_key].push(queuedEvent.event);
        }

        for (const apiKey in groupedEvents) {
            await sendEvents(apiKey, groupedEvents[apiKey], currentSize);
        }
    }
}
const sendEvents = async (apiKey: string, events: Event[], size: number): Promise<void> => {
    try {
        requestsInLastSecond++;
        console.log(`Flushing ${events.length} events (${size} bytes) using API key ${apiKey.slice(0, 5)}...${apiKey.slice(-5)}`);
        const response = await fetch(MAVIS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${btoa(apiKey + ':')}`,
            },
            body: JSON.stringify({api_key: apiKey, events}),
        });
        console.log(`Flush response: ${response.status}`);
        if (!response.ok) {
            console.error(`Failed to flush events: ${response.status} ${await response.text()}`);
        } else {
            console.log(await response.json());
        }
    } catch (e) {
        console.error("Error flushing events", e);
        await redis.lpush(
            'event_queue',
            ...events.map(event => JSON.stringify({api_key: apiKey, event}))
        );
    }
}

const startBackgroundFlushJob = () => {
    setInterval(async () => {
        await flushEvents();
    }, FLUSH_INTERVAL);
}

app.post('/track', async (c) => {
    const body = await c.req.json<TrackEventBody>();

    if (!Array.isArray(body.events) || body.events.length === 0) {
        return c.json({error: 'Invalid events format'}, 400);
    }

    try {
        await redis.rpush(
            'event_queue',
            ...body.events.map(event => JSON.stringify({api_key: body.api_key, event}))
        );
        return c.json({success: true});
    } catch (e) {
        console.error(e);
        return c.json({error: 'Internal server error'}, 500);
    }
});

startBackgroundFlushJob();

export default {
    port: process.env.PORT ?? 5775,
    fetch: app.fetch,
}