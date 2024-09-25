import {v4 as uuidv4} from 'uuid';

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
type MavisEventType = 'identify' | 'screen' | 'track';

interface EventBase {
    type?: MavisEventType;
    data: {
        uuid: string;
        ref: string;
        timestamp: string;
        session_id: string;
        offset: number;
        user_id?: string;
        type?: string;
        [key: string]: any;
    }
}

interface PlatformProperties {
    build_version?: string;
    device_name?: string;
    device_id?: string;
    platform_name: string;
    platform_version?: string;
    internet_type?: string;
}

export interface IdentifyEvent extends EventBase {
    data: EventBase["data"] & PlatformProperties & {
        ronin_address: string;
        user_properties?: {
            [key: string]: any;
        };
        [key: string]: any;
    }
    type: 'identify';
}

export interface ScreenEvent extends EventBase {
    data: EventBase["data"] & {
        screen: string;
        screen_properties?: Record<string, any>;
        [key: string]: any;
    }
    type: 'screen';
}

export interface TrackEvent extends EventBase {
    data: EventBase["data"] & {
        action: string;
        action_properties?: Record<string, any>;
        [key: string]: any;
    }
    type: 'track';
}

type Event = IdentifyEvent | ScreenEvent | TrackEvent;

export class MavisTracking {
    private apiKey: string;
    private apiUrl: string;
    private sessionId: string;
    private lastRef: string;
    private offset: number;
    private queue: Event[];
    private flushInterval: number;
    private flushTimeout: ReturnType<typeof setTimeout> | null;
    private userId: string | null;
    private roninAddress: string;

    constructor(apiKey: string, options: { apiUrl?: string, flushInterval?: number } = {}) {
        this.apiKey = apiKey;
        this.apiUrl = options.apiUrl || 'https://x.skymavis.com/track';
        this.sessionId = uuidv4();
        this.lastRef = 'root';
        this.offset = 0;
        this.queue = [];
        this.flushInterval = options.flushInterval || 10000; // 10 seconds default
        this.flushTimeout = null;
        this.userId = null;
        this.roninAddress = ADDRESS_ZERO;
    }

    private createBaseEvent(): EventBase {
        const event: EventBase = {
            data: {
                uuid: uuidv4(),
                ref: this.lastRef,
                timestamp: new Date().toISOString(),
                session_id: this.sessionId,
                offset: this.offset++,
                user_id: this.userId || undefined
            }
        };
        this.lastRef = event.data.uuid;
        return event;
    }

    private queueEvent(event: Event): void {
        this.queue.push(event);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimeout === null) {
            this.flushTimeout = setTimeout(() => this.flush(), this.flushInterval);
        }
    }

    private async flush(): Promise<void> {
        if (this.queue.length === 0) return;
        const events = [...this.queue];
        this.queue = [];
        this.flushTimeout = null;

        try {
            const headers = new Headers({
                'Content-Type': 'application/json',
                'Authorization': `Basic ${btoa(this.apiKey + ':')}`
            });

            const body = JSON.stringify({
                api_key: this.apiKey,
                events: events
            });
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: headers,
                body: body
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to send events:', error);
            // Re-queue failed events
            this.queue = [...events, ...this.queue];
        }
    }

    identify(userId: string,
             roninAddress: string,
             userProperties: IdentifyEvent["data"]["user_properties"],
             deviceProperties: PlatformProperties = { platform_name: "unknown" }
    ): void {
        this.userId = userId;
        this.roninAddress = roninAddress || ADDRESS_ZERO;

        const event: IdentifyEvent = {
            type: 'identify',
            data: {
                ...this.createBaseEvent().data,
                ...deviceProperties,
                ronin_address: this.roninAddress,
                user_properties: userProperties
            }
        };
        this.queueEvent(event);
    }

    screen(screenName: string, screenProperties?: ScreenEvent["data"]["screen_properties"]): void {
        const event: ScreenEvent = {
            ...this.createBaseEvent(),
            type: 'screen',
            data: {
                ...this.createBaseEvent().data,
                screen: screenName,
                screen_properties: screenProperties
            }
        };
        this.queueEvent(event);
    }

    track(action: string, actionProperties?: TrackEvent["data"]["action_properties"]): void {
        const event: TrackEvent = {
            ...this.createBaseEvent(),
            type: 'track',
            data: {
                ...this.createBaseEvent().data,
                action: action,
                action_properties: actionProperties
            }
        };
        this.queueEvent(event);
    }

    resetSession(): void {
        this.sessionId = uuidv4();
        this.lastRef = 'root';
        this.offset = 0;
        this.userId = null;
        this.roninAddress = ADDRESS_ZERO;
    }

    async shutdown(): Promise<void> {
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
        }
        await this.flush();
    }
}

export default MavisTracking;