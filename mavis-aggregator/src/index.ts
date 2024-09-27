import {Hono} from 'hono'
import Redis from "ioredis";

const MAX_BODY_SIZE = 1e6; // 1MB in bytes
const MAX_REQUESTS_PER_SECOND = 100;
const FLUSH_INTERVAL = 1000; // 1 second in milliseconds

type Event = {
    type: string,
    data: Record<string, any>,
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

    let eventsToSend: Event[] = [];
    let currentSize = 0;

    while (true) {
        const nextEvent = await redis.lpop('event_queue');
        if (!nextEvent) break;
        const event = JSON.parse(nextEvent) as Event;
        const newSize = calculatePayloadSize([...eventsToSend, event]);
        if (newSize > MAX_BODY_SIZE) {
            // Re-add the event to the queue
            await redis.lpush('event_queue', nextEvent);
            break;
        }
        eventsToSend.push(event);
        currentSize = newSize;
    }

    if (eventsToSend.length > 0) {
        try {
            if (process.env.MAVIS_API_KEY === undefined) {
                console.error("MAVIS_API_KEY is not set");
                return;
            }
            if (process.env.MAVIS_API_URL === undefined) {
                console.error("MAVIS_API_URL is not set");
                return;
            }
            requestsInLastSecond++;
            console.log(`Flushing ${eventsToSend.length} events (${currentSize} bytes)`);
            const response = await fetch(process.env.MAVIS_API_URL!, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${btoa(process.env.MAVIS_API_KEY + ':')}`,
                },
                body: JSON.stringify({api_key: process.env.MAVIS_API_KEY, events: eventsToSend}),
            });
            console.log(`Flush response: ${response.status}`);
            console.log(await response.json());
            if (!response.ok) {
                console.error(`Failed to flush events: ${response.status} ${await response.text()}`);
            }
        } catch(e)
        {
            console.error("Error flushing events", e);
            // Re-add the events to the queue
            // @ts-ignore
            await redis.lpush('event_queue', ...eventsToSend.map(JSON.stringify));
        }
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
        // @ts-ignore
        await redis.rpush('event_queue', ...body.events.map(JSON.stringify));
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