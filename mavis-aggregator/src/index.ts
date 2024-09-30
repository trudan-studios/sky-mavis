import {Hono} from 'hono'
import {Event} from "./types";
import EventTracker from "./EventTracker";

type TrackEventBody = {
    api_key: string;
    events: Event[],
}
const app = new Hono();
const eventTracker = new EventTracker();

app.post('/track', async (c) => {
    const body = await c.req.json<TrackEventBody>();

    if (!Array.isArray(body.events) || body.events.length === 0) {
        return c.json({error: 'Invalid events format'}, 400);
    }

    try {
        console.log(`Received ${body.events.length} events for API key ${body.api_key.slice(0, 5)}...${body.api_key.slice(-5)}`);
        await eventTracker.startTracking(body.api_key, body.events);
        return c.json({success: true});
    } catch (e) {
        console.error(e);
        return c.json({error: 'Internal server error'}, 500);
    }
});

app.get("/health", (c) => {
    return c.json({status: "ok"});
});

eventTracker.startFlushInterval();

export default {
    port: process.env.PORT ?? 5775,
    fetch: app.fetch,
}